import { compileEzsl } from "../compiler/index.js";
import type { CompileOptions, CustomFunction } from "../compiler/index.js";
import { generateFragmentShaderMapped, generateVertexShader } from "../codegen/glslGenerator.js";
import type { Program as CodegenProgram } from "../codegen/types.js";
import { translateShaderError } from "../errors/translateShaderError.js";

/** Framebuffer color format for a pipeline buffer — see docs/architecture/multi-pass.md. */
export type BufferFormat = "RGBA8" | "RGBA16F" | "RGBA32F";

export interface PassSource {
  /** The pass's `.ezsl` source text. */
  source: string;
  /**
   * Framebuffer format for a *buffer* pass (ignored for the `Image` pass,
   * which always renders to the default framebuffer / canvas). `RGBA16F`/
   * `RGBA32F` require the `EXT_color_buffer_float` extension; if it's
   * unavailable, the pipeline degrades to `RGBA8` and emits a console
   * warning rather than throwing — see docs/architecture/multi-pass.md's
   * v0.5 known trap.
   */
  format?: BufferFormat;
  customFunctions?: CustomFunction[];
}

export interface PipelineOptions {
  /**
   * Every pass keyed by name. Exactly one entry must be named `"Image"` —
   * the pass rendered to the canvas; every other entry is an offscreen
   * buffer, sampled by name (`<Name>.sample(uv)`) from any other pass,
   * including itself (a self-reference is a feedback buffer — see
   * docs/architecture/multi-pass.md's ping-pong section).
   */
  passes: Record<string, PassSource>;
}

export interface CompiledPass {
  name: string;
  source: string;
  format: BufferFormat;
  program: CodegenProgram;
  dependsOn: string[];
  isFeedback: boolean;
}

export class PipelineError extends Error {}

/**
 * Compiles every pass and discovers its buffer dependencies by inspecting
 * which `sampler2D` uniforms `compile()` actually produced — see
 * docs/architecture/multi-pass.md for why this avoids a separate
 * dependency-scanning pass over the AST (the compiler already does the
 * only discovery that matters: which `.sample()` calls survived
 * compilation).
 */
export function compilePasses(passes: Record<string, PassSource>): CompiledPass[] {
  const names = Object.keys(passes);
  if (!names.includes("Image")) {
    throw new PipelineError("createPipeline: exactly one pass must be named 'Image' (the pass rendered to the canvas)");
  }

  return names.map((name) => {
    const passSource = passes[name];
    const options: CompileOptions = {
      bufferNames: names,
      customFunctions: passSource.customFunctions,
    };
    let program: CodegenProgram;
    try {
      program = compileEzsl(passSource.source, options);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new PipelineError(`createPipeline: pass '${name}' failed to compile:\n${message}`);
    }
    const dependsOn = program.uniforms.filter((u) => u.type === "sampler2D").map((u) => u.name);
    return {
      name,
      source: passSource.source,
      format: passSource.format ?? "RGBA8",
      program,
      dependsOn,
      isFeedback: dependsOn.includes(name),
    };
  });
}

/**
 * Topologically sorts passes by dependency (a pass sampling `BufferA` must
 * run after `BufferA`'s own pass has rendered that frame) and detects
 * cycles at "compile" time — i.e. before any WebGL context or draw call
 * exists — rather than as a runtime freeze. A pass depending on itself
 * (`isFeedback`) is explicitly allowed and excluded from cycle detection:
 * it reads *last frame's* output of its own buffer, which is exactly what
 * ping-pong buffering (see `PingPongBuffer` below) is for, not a real
 * same-frame cycle.
 */
export function topologicalOrder(compiledPasses: CompiledPass[]): CompiledPass[] {
  const byName = new Map(compiledPasses.map((p) => [p.name, p]));
  const visited = new Set<string>();
  const inProgress = new Set<string>();
  const ordered: CompiledPass[] = [];

  function visit(name: string, path: string[]): void {
    if (visited.has(name)) return;
    if (inProgress.has(name)) {
      const cycle = [...path.slice(path.indexOf(name)), name].join(" -> ");
      throw new PipelineError(`createPipeline: cyclic buffer dependency detected: ${cycle}`);
    }
    const pass = byName.get(name);
    if (!pass) {
      throw new PipelineError(`createPipeline: pass '${name}' depends on undeclared buffer (this should be unreachable — compile() should have rejected it)`);
    }
    inProgress.add(name);
    for (const dep of pass.dependsOn) {
      if (dep === name) continue; // self-dependency is feedback, not a same-frame cycle — see isFeedback above
      visit(dep, [...path, name]);
    }
    inProgress.delete(name);
    visited.add(name);
    ordered.push(pass);
  }

  for (const pass of compiledPasses) visit(pass.name, []);
  return ordered;
}

function detectColorBufferFloatSupport(gl: WebGL2RenderingContext): boolean {
  return gl.getExtension("EXT_color_buffer_float") !== null;
}

/** GLenum internal format + matching pixel-transfer type for `texImage2D` — these must agree (e.g. RGBA16F's storage is a float format, so the transfer type must be gl.FLOAT, not gl.UNSIGNED_BYTE) or the driver rejects the call. */
function glFormatAndType(gl: WebGL2RenderingContext, format: BufferFormat): { internalFormat: number; type: number } {
  if (format === "RGBA16F") return { internalFormat: gl.RGBA16F, type: gl.FLOAT };
  if (format === "RGBA32F") return { internalFormat: gl.RGBA32F, type: gl.FLOAT };
  return { internalFormat: gl.RGBA8, type: gl.UNSIGNED_BYTE };
}

/** One render target — a texture + the framebuffer that draws into it. */
interface RenderTarget {
  texture: WebGLTexture;
  framebuffer: WebGLFramebuffer;
}

function createRenderTarget(gl: WebGL2RenderingContext, width: number, height: number, format: BufferFormat): RenderTarget {
  const { internalFormat, type } = glFormatAndType(gl, format);
  const texture = gl.createTexture();
  if (!texture) throw new Error("EZSL runtime: failed to create buffer texture");
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, width, height, 0, gl.RGBA, type, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  const framebuffer = gl.createFramebuffer();
  if (!framebuffer) throw new Error("EZSL runtime: failed to create framebuffer");
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);

  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.bindTexture(gl.TEXTURE_2D, null);

  return { texture, framebuffer };
}

/**
 * A double-buffered render target for a feedback buffer (a pass that
 * samples its own previous frame). Rendering writes to `back` while
 * `front` (last frame's completed output) is bound for sampling; `swap()`
 * exchanges them after each frame. A non-feedback buffer just uses a
 * single `RenderTarget` directly and never calls `swap()` — see
 * docs/architecture/multi-pass.md.
 */
class PingPongBuffer {
  private a: RenderTarget;
  private b: RenderTarget;
  private frontIsA = true;

  constructor(gl: WebGL2RenderingContext, width: number, height: number, format: BufferFormat) {
    this.a = createRenderTarget(gl, width, height, format);
    this.b = createRenderTarget(gl, width, height, format);
  }

  get front(): RenderTarget {
    return this.frontIsA ? this.a : this.b;
  }

  get back(): RenderTarget {
    return this.frontIsA ? this.b : this.a;
  }

  swap(): void {
    this.frontIsA = !this.frontIsA;
  }
}

export interface EzslPipelineHandle {
  canvas: HTMLCanvasElement;
  gl: WebGL2RenderingContext;
  stop(): void;
  /** Sets a uniform on every pass that declared it (a uniform used across multiple passes is set on all of them). */
  setUniform(name: string, value: number | [number, number] | [number, number, number] | [number, number, number, number]): void;
}

interface RuntimePass {
  compiled: CompiledPass;
  glProgram: WebGLProgram;
  target: RenderTarget | PingPongBuffer | null; // null only for the Image pass, which renders to the canvas
  uniformLocs: Map<string, WebGLUniformLocation | null>;
  bufferUniformLocs: Map<string, WebGLUniformLocation | null>; // sampler2D locations, keyed by the buffer name they sample
  uTimeLoc: WebGLUniformLocation | null;
  uResolutionLoc: WebGLUniformLocation | null;
}

function compileAndLink(gl: WebGL2RenderingContext, vertexSource: string, pass: CompiledPass): WebGLProgram {
  const { source: fragmentSource, sourceMap } = generateFragmentShaderMapped(pass.program);
  const knownNames = pass.program.uniforms.map((u) => u.name);
  const translate = (rawLog: string) => translateShaderError(rawLog, pass.source, sourceMap, knownNames);

  function compileShader(type: number, glslSource: string): WebGLShader {
    const shader = gl.createShader(type);
    if (!shader) throw new Error("EZSL runtime: failed to create shader object");
    gl.shaderSource(shader, glslSource);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(shader) ?? "";
      gl.deleteShader(shader);
      const message = type === gl.FRAGMENT_SHADER ? translate(log) : log;
      throw new PipelineError(`createPipeline: pass '${pass.name}' shader compile error:\n${message}`);
    }
    return shader;
  }

  const vertexShader = compileShader(gl.VERTEX_SHADER, vertexSource);
  const fragmentShader = compileShader(gl.FRAGMENT_SHADER, fragmentSource);
  const glProgram = gl.createProgram();
  if (!glProgram) throw new Error("EZSL runtime: failed to create program object");
  gl.attachShader(glProgram, vertexShader);
  gl.attachShader(glProgram, fragmentShader);
  gl.linkProgram(glProgram);
  if (!gl.getProgramParameter(glProgram, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(glProgram) ?? "";
    throw new PipelineError(`createPipeline: pass '${pass.name}' program link error:\n${translate(log)}`);
  }
  return glProgram;
}

/**
 * Bootstraps a multi-pass (Shadertoy-style) EZSL pipeline: one or more
 * offscreen buffer passes plus a final `Image` pass rendered to the
 * canvas, with automatic dependency ordering, ping-pong feedback buffers,
 * and cycle detection. See docs/architecture/multi-pass.md.
 */
export function createPipeline(canvas: HTMLCanvasElement, options: PipelineOptions): EzslPipelineHandle {
  const glContext = canvas.getContext("webgl2");
  if (!glContext) throw new Error("EZSL runtime: WebGL2 is not supported in this environment");
  const gl: WebGL2RenderingContext = glContext;

  const compiledPasses = compilePasses(options.passes);
  const order = topologicalOrder(compiledPasses);

  const supportsFloat = detectColorBufferFloatSupport(gl);

  const quadVertices = new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]);
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const vertexBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, quadVertices, gl.STATIC_DRAW);

  const vertexSource = generateVertexShader();

  const runtimePasses = new Map<string, RuntimePass>();
  for (const compiled of order) {
    let effectiveFormat = compiled.format;
    if ((effectiveFormat === "RGBA16F" || effectiveFormat === "RGBA32F") && !supportsFloat) {
      console.warn(
        `EZSL runtime: pass '${compiled.name}' requested ${effectiveFormat} but EXT_color_buffer_float is unavailable on this device — falling back to RGBA8`,
      );
      effectiveFormat = "RGBA8";
    }

    const glProgram = compileAndLink(gl, vertexSource, compiled);

    const target =
      compiled.name === "Image"
        ? null
        : compiled.isFeedback
          ? new PingPongBuffer(gl, canvas.width || 1, canvas.height || 1, effectiveFormat)
          : createRenderTarget(gl, canvas.width || 1, canvas.height || 1, effectiveFormat);

    const uniformLocs = new Map<string, WebGLUniformLocation | null>();
    for (const u of compiled.program.uniforms) {
      if (u.type === "sampler2D") continue;
      uniformLocs.set(u.name, gl.getUniformLocation(glProgram, u.glslName));
    }
    const bufferUniformLocs = new Map<string, WebGLUniformLocation | null>();
    for (const u of compiled.program.uniforms) {
      if (u.type !== "sampler2D") continue;
      bufferUniformLocs.set(u.name, gl.getUniformLocation(glProgram, u.glslName));
    }

    runtimePasses.set(compiled.name, {
      compiled,
      glProgram,
      target,
      uniformLocs,
      bufferUniformLocs,
      uTimeLoc: gl.getUniformLocation(glProgram, "u_time"),
      uResolutionLoc: gl.getUniformLocation(glProgram, "u_resolution"),
    });
  }

  const userUniformValues = new Map<string, number[]>();
  const startTime = performance.now();
  let rafId = 0;

  function bindQuad(glProgram: WebGLProgram) {
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
    const positionLoc = gl.getAttribLocation(glProgram, "a_position");
    gl.enableVertexAttribArray(positionLoc);
    gl.vertexAttribPointer(positionLoc, 2, gl.FLOAT, false, 0, 0);
  }

  function frame() {
    const elapsedSeconds = (performance.now() - startTime) / 1000;

    for (const compiled of order) {
      const rp = runtimePasses.get(compiled.name)!;
      const writeTarget = rp.target instanceof PingPongBuffer ? rp.target.back : rp.target;

      gl.bindFramebuffer(gl.FRAMEBUFFER, writeTarget ? writeTarget.framebuffer : null);
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.useProgram(rp.glProgram);
      bindQuad(rp.glProgram);

      gl.uniform1f(rp.uTimeLoc, elapsedSeconds);
      gl.uniform2f(rp.uResolutionLoc, canvas.width, canvas.height);

      for (const u of compiled.program.uniforms) {
        if (u.type === "sampler2D") continue;
        const loc = rp.uniformLocs.get(u.name);
        const value = userUniformValues.get(u.name);
        if (!loc || !value) continue;
        if (value.length === 1) gl.uniform1f(loc, value[0]);
        else if (value.length === 2) gl.uniform2f(loc, value[0], value[1]);
        else if (value.length === 3) gl.uniform3f(loc, value[0], value[1], value[2]);
        else if (value.length === 4) gl.uniform4f(loc, value[0], value[1], value[2], value[3]);
      }

      let textureUnit = 0;
      for (const [bufferName, loc] of rp.bufferUniformLocs) {
        const sourcePass = runtimePasses.get(bufferName)!;
        const sourceTarget = sourcePass.target instanceof PingPongBuffer ? sourcePass.target.front : sourcePass.target;
        gl.activeTexture(gl.TEXTURE0 + textureUnit);
        gl.bindTexture(gl.TEXTURE_2D, sourceTarget ? sourceTarget.texture : null);
        gl.uniform1i(loc, textureUnit);
        textureUnit++;
      }

      gl.drawArrays(gl.TRIANGLES, 0, 6);

      if (rp.target instanceof PingPongBuffer) rp.target.swap();
    }

    rafId = requestAnimationFrame(frame);
  }

  rafId = requestAnimationFrame(frame);

  return {
    canvas,
    gl,
    stop() {
      cancelAnimationFrame(rafId);
    },
    setUniform(name, value) {
      userUniformValues.set(name, Array.isArray(value) ? value : [value]);
    },
  };
}
