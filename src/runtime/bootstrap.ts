import { generateFragmentShaderMapped, generateVertexShader } from "../codegen/glslGenerator.js";
import type { Program } from "../codegen/types.js";
import { translateShaderError } from "../errors/translateShaderError.js";
import { parseCompileLog } from "../errors/parseCompileLog.js";
import { throwAtEzslLine } from "../errors/throwAtEzslLine.js";
import { generateEzslSourceMap, sourceMapComment } from "../errors/generateSourceMap.js";

export interface EzslRuntimeHandle {
  canvas: HTMLCanvasElement;
  gl: WebGL2RenderingContext;
  program: WebGLProgram;
  /** Stops the draw loop. */
  stop(): void;
  /** Sets a uniform value by its EZSL name (as declared in Program.uniforms). */
  setUniform(name: string, value: number | [number, number] | [number, number, number] | [number, number, number, number]): void;
  /**
   * Compiles and links `newProgram` into the **same** WebGL2 context/canvas
   * this handle already owns, and switches the running draw loop to render
   * it from the next frame on — the "hot shader swapping" primitive behind
   * `ezsl dev`'s live-reload (v0.7 — see docs/architecture/dev-server.md).
   * Deliberately does not tear down or recreate the canvas/context/quad —
   * only compiles a new program and re-fetches its uniform locations, so
   * repeated swaps across an editing session don't consume additional
   * WebGL context slots (a real, limited browser resource — typically
   * 8-16 live contexts per page) the way calling `mount()` again on the
   * same canvas would. `.program`/`.setUniform` on this handle reflect
   * whichever program was most recently swapped in (or the original, if
   * never called). Throws (via the same v0.4 error-translation path as
   * the initial `mount()` call) if `newProgram` fails to compile/link —
   * the **previous** program keeps rendering uninterrupted in that case,
   * so a syntax error mid-edit doesn't blank the canvas.
   */
  swapProgram(newProgram: Program, options?: MountOptions): void;
}

export interface MountOptions {
  /**
   * The original `.ezsl` source text `program` was compiled from. When
   * given, a shader compile/link failure is translated (v0.4 error
   * translation layer — see docs/architecture/error-translation.md) into a
   * beginner-friendly message with a `.ezsl`-relative source snippet,
   * thrown instead of the raw driver log. Omit this if `program` wasn't
   * produced from `.ezsl` source (e.g. hand-built codegen IR) — the raw
   * driver log is thrown as before.
   */
  ezslSource?: string;
  /**
   * The `.ezsl` file's real, network-resolvable URL (e.g. `new
   * URL("./shader.ezsl", import.meta.url).href` under Vite, which serves
   * `?raw`-imported files at a real dev-server path) — v0.7 DevTools
   * source-map support, see docs/architecture/devtools-source-maps.md.
   * When given (requires `ezslSource` too — a URL alone can't be resolved
   * to a line without the source-mapped compile), a shader compile
   * failure is thrown as an `Error` whose stack trace's top frame points
   * at this URL and the real `.ezsl` line the driver's diagnostic maps
   * back to, via the `//# sourceURL=` convention browser DevTools resolve
   * into a real, clickable link — not just a plain-text message. Ignored
   * (silently) if the driver log's first diagnostic can't be resolved to
   * an `.ezsl` line (e.g. it falls inside unmapped boilerplate) or if
   * `ezslSource` is omitted; the v0.4 translated-text throw is always the
   * fallback.
   */
  ezslUrl?: string;
}

function compileShader(
  gl: WebGL2RenderingContext,
  type: number,
  source: string,
  translate: ((rawLog: string) => string) | null,
  throwLocated: ((rawLog: string) => void) | null,
): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error("EZSL runtime: failed to create shader object");

  gl.shaderSource(shader, source);
  gl.compileShader(shader);

  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader) ?? "";
    gl.deleteShader(shader);
    // May throw (a real, clickable <ezslUrl>:<line> stack frame — see
    // MountOptions.ezslUrl) — if it returns instead (no diagnostic could
    // be resolved to a real .ezsl line), fall through to the plain/v0.4
    // translated throw below rather than silently swallowing the error.
    if (throwLocated) throwLocated(log);
    const message = translate ? translate(log) : `${log}\n\nSource:\n${source}`;
    throw new Error(`EZSL runtime: shader compile error:\n${message}`);
  }

  return shader;
}

function linkProgram(
  gl: WebGL2RenderingContext,
  vertexSource: string,
  fragmentSource: string,
  translate: ((rawLog: string) => string) | null,
  throwLocated: ((rawLog: string) => void) | null,
): WebGLProgram {
  const vertexShader = compileShader(gl, gl.VERTEX_SHADER, vertexSource, null, null);
  const fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource, translate, throwLocated);

  const program = gl.createProgram();
  if (!program) throw new Error("EZSL runtime: failed to create program object");

  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program) ?? "";
    if (throwLocated) throwLocated(log);
    const message = translate ? translate(log) : log;
    throw new Error(`EZSL runtime: program link error:\n${message}`);
  }

  return program;
}

interface WebglRenderer {
  gl: WebGL2RenderingContext;
  glProgram: WebGLProgram;
  startTime: number;
  /** Draws one frame at the given canvas size, using whatever uniform values are currently set. */
  drawFrame(width: number, height: number): void;
  setUniform(name: string, value: number | [number, number] | [number, number, number] | [number, number, number, number]): void;
  /**
   * Compiles and links `newProgram` in place of the currently-rendering one,
   * reusing this renderer's existing VAO/vertex buffer (the fullscreen quad
   * geometry never changes between EZSL programs — only what fragment
   * shader draws it does) — see `EzslRuntimeHandle.swapProgram`'s doc
   * comment for why this exists (v0.7 `ezsl dev` hot swapping) and why it
   * deliberately doesn't recreate the VAO/buffer. `a_position`'s attribute
   * location is **not** guaranteed to stay the same across two separately
   * linked programs (the GLSL linker is free to assign it differently even
   * for textually-identical vertex source), so `vertexAttribPointer`/
   * `enableVertexAttribArray` are re-run against the new program's own
   * location after every swap — reusing the old location would silently
   * feed position data into the wrong (or a disabled) attribute slot on a
   * driver that happens to reassign it. On a compile/link failure, throws
   * (same translated-error path as initial setup) and leaves the previous
   * `glProgram`/uniform locations untouched, so the caller can catch and
   * keep the previous frame rendering.
   */
  swapProgram(newProgram: Program, options: MountOptions): void;
}

/**
 * Compiles, links, and prepares everything a single-pass EZSL fragment
 * program needs to render a fullscreen quad — shared by `mount()` (renders
 * directly to a visible canvas) and `mountToCanvas2D()` (renders to an
 * offscreen canvas and copies pixels to a 2D canvas — see
 * docs/architecture/canvas2d-interop.md). Factored out specifically so the
 * two entry points can't drift on shader compilation, uniform binding, or
 * the quad setup — only what happens with the rendered frame differs.
 */
function setupWebglRenderer(gl: WebGL2RenderingContext, initialProgram: Program, initialOptions: MountOptions): WebglRenderer {
  // Fullscreen quad: two triangles covering clip space [-1, 1]. Created once
  // and reused across any later swapProgram() call — only the linked
  // program (and the uniform/attribute locations it hands out) changes.
  const quadVertices = new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]);
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);

  const vertexBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, quadVertices, gl.STATIC_DRAW);

  let glProgram!: WebGLProgram;
  let program = initialProgram;
  let uTimeLoc: WebGLUniformLocation | null = null;
  let uResolutionLoc: WebGLUniformLocation | null = null;
  let userUniformLocs = new Map<string, WebGLUniformLocation | null>();
  const userUniformValues = new Map<string, number[]>();

  function linkAndBind(newProgram: Program, options: MountOptions): void {
    const vertexSource = generateVertexShader();
    const { source: fragmentSourceRaw, sourceMap } = generateFragmentShaderMapped(newProgram);

    // v0.7 DevTools source-map support: append a standard Source Map v3
    // `sourceMappingURL` comment to the generated GLSL text itself when
    // both ezslUrl/ezslSource are given — this is the *other* consumer of
    // the mapping (a tool that inspects the GLSL source as a mapped
    // asset, e.g. a browser extension reading shader source via WebGL
    // inspection), distinct from throwLocated's JS-stack-frame mechanism
    // below. Harmless if nothing ever reads it — GLSL treats `//` as a
    // line comment, so this is valid, inert GLSL either way. See
    // docs/architecture/devtools-source-maps.md.
    const fragmentSource =
      options.ezslSource !== undefined && options.ezslUrl !== undefined
        ? `${fragmentSourceRaw}\n${sourceMapComment(generateEzslSourceMap(sourceMap, options.ezslUrl, options.ezslSource))}\n`
        : fragmentSourceRaw;

    const translate =
      options.ezslSource !== undefined
        ? (rawLog: string) =>
            translateShaderError(
              rawLog,
              options.ezslSource!,
              sourceMap,
              newProgram.uniforms.map((u) => u.name),
            )
        : null;

    // v0.7 DevTools source-map support: when both ezslSource and ezslUrl
    // are given, try to throw a located error (a real, clickable
    // <ezslUrl>:<line> stack frame) instead of the v0.4 translated-text
    // Error — see MountOptions.ezslUrl's doc comment and
    // docs/architecture/devtools-source-maps.md. This only ever *replaces*
    // the throw, never suppresses it: if no diagnostic resolves to a real
    // .ezsl line (e.g. it's inside unmapped boilerplate), throwLocated
    // returns normally instead of throwing, and the translate/plain-Error
    // fallback below still fires.
    const throwLocated =
      options.ezslSource !== undefined && options.ezslUrl !== undefined
        ? (rawLog: string) => {
            const diagnostics = parseCompileLog(rawLog);
            const first = diagnostics[0];
            if (!first || first.glslLine === null) return;
            const ezslLine = sourceMap.get(first.glslLine);
            if (ezslLine === null || ezslLine === undefined) return;
            throwAtEzslLine(first.message, options.ezslUrl!, ezslLine);
          }
        : null;

    const linked = linkProgram(gl, vertexSource, fragmentSource, translate, throwLocated);

    gl.bindVertexArray(vao);
    const positionLoc = gl.getAttribLocation(linked, "a_position");
    gl.enableVertexAttribArray(positionLoc);
    gl.vertexAttribPointer(positionLoc, 2, gl.FLOAT, false, 0, 0);

    glProgram = linked;
    program = newProgram;
    uTimeLoc = gl.getUniformLocation(glProgram, "u_time");
    uResolutionLoc = gl.getUniformLocation(glProgram, "u_resolution");
    userUniformLocs = new Map(newProgram.uniforms.map((u) => [u.name, gl.getUniformLocation(glProgram, u.glslName)]));
  }

  linkAndBind(initialProgram, initialOptions);

  const startTime = performance.now();

  return {
    gl,
    get glProgram() {
      return glProgram;
    },
    startTime,
    drawFrame(width, height) {
      const elapsedSeconds = (performance.now() - startTime) / 1000;

      gl.viewport(0, 0, width, height);
      gl.useProgram(glProgram);
      gl.bindVertexArray(vao);

      gl.uniform1f(uTimeLoc, elapsedSeconds);
      gl.uniform2f(uResolutionLoc, width, height);

      for (const u of program.uniforms) {
        const loc = userUniformLocs.get(u.name);
        const value = userUniformValues.get(u.name);
        if (!loc || !value) continue;
        if (value.length === 1) gl.uniform1f(loc, value[0]);
        else if (value.length === 2) gl.uniform2f(loc, value[0], value[1]);
        else if (value.length === 3) gl.uniform3f(loc, value[0], value[1], value[2]);
        else if (value.length === 4) gl.uniform4f(loc, value[0], value[1], value[2], value[3]);
      }

      gl.drawArrays(gl.TRIANGLES, 0, 6);
    },
    setUniform(name, value) {
      userUniformValues.set(name, Array.isArray(value) ? value : [value]);
    },
    swapProgram(newProgram, options) {
      linkAndBind(newProgram, options);
    },
  };
}

/**
 * Bootstraps a minimal WebGL2 context rendering a single fullscreen-quad
 * fragment shader compiled from an EZSL Program AST (v0.1 scope). Pass
 * `options.ezslSource` to get translated, `.ezsl`-relative compile errors
 * (v0.4 error translation layer) instead of a raw driver log.
 */
export function mount(canvas: HTMLCanvasElement, program: Program, options: MountOptions = {}): EzslRuntimeHandle {
  const glContext = canvas.getContext("webgl2");
  if (!glContext) throw new Error("EZSL runtime: WebGL2 is not supported in this environment");
  const gl: WebGL2RenderingContext = glContext;

  const renderer = setupWebglRenderer(gl, program, options);
  let rafId = 0;

  function frame() {
    renderer.drawFrame(canvas.width, canvas.height);
    rafId = requestAnimationFrame(frame);
  }
  rafId = requestAnimationFrame(frame);

  return {
    canvas,
    gl,
    get program() {
      return renderer.glProgram;
    },
    stop() {
      cancelAnimationFrame(rafId);
    },
    setUniform: renderer.setUniform,
    swapProgram(newProgram, swapOptions = {}) {
      renderer.swapProgram(newProgram, swapOptions);
    },
  };
}

export interface Canvas2DHandle {
  /** The offscreen WebGL2 canvas actually rendering the shader — not attached to the DOM. */
  offscreenCanvas: HTMLCanvasElement;
  gl: WebGL2RenderingContext;
  /** Stops the draw loop. */
  stop(): void;
  setUniform(name: string, value: number | [number, number] | [number, number, number] | [number, number, number, number]): void;
}

export interface MountToCanvas2DOptions extends MountOptions {
  /**
   * Frames per second to re-render and copy to the 2D canvas. Defaults to
   * 30 — deliberately lower than a typical 60fps WebGL loop, since
   * `gl.readPixels` (a GPU-to-CPU synchronous readback) is meaningfully
   * more expensive than a normal draw call; see
   * docs/architecture/canvas2d-interop.md. Pass `Infinity` to redraw as
   * fast as `requestAnimationFrame` allows (not recommended except for a
   * single static snapshot — see `once`).
   */
  fps?: number;
  /**
   * Render and copy exactly one frame, then stop — for a static snapshot
   * (e.g. exporting an image, or a non-animated shader) rather than a
   * running loop. When set, `fps` is ignored.
   */
  once?: boolean;
  /**
   * Called after each shader frame has been copied onto `canvas2d` (i.e.
   * after `putImageData`) but before the browser paints — the natural
   * place to layer ordinary Canvas2D drawing (`fillText`, `drawImage`,
   * shapes) on top of the shader's output using the *same* 2D context,
   * which is the actual point of `mountToCanvas2D` over plain `mount()`.
   */
  onFrame?: () => void;
}

/**
 * Renders an EZSL fragment program in an offscreen WebGL2 context and
 * copies each rendered frame's pixels into a visible 2D canvas via
 * `gl.readPixels` + `CanvasRenderingContext2D.putImageData` (v0.6 Canvas2D
 * interop — see docs/architecture/canvas2d-interop.md). Use this to
 * composite an EZSL shader's output with ordinary Canvas2D drawing
 * (`fillText`, `drawImage`, other shapes) in the same 2D scene, or to
 * export a shader frame as a static image — not as a way to run EZSL
 * shaders in an environment that actually lacks WebGL2 (nothing can do
 * that; the shader still requires a real, if offscreen and invisible,
 * WebGL2 context to render at all — see the design doc for why "fallback"
 * in the roadmap's wording doesn't mean what it might first suggest).
 */
export function mountToCanvas2D(
  canvas2d: HTMLCanvasElement,
  program: Program,
  options: MountToCanvas2DOptions = {},
): Canvas2DHandle {
  const context2d = canvas2d.getContext("2d");
  if (!context2d) throw new Error("EZSL runtime: failed to acquire a 2D rendering context on the given canvas");
  const ctx2d: CanvasRenderingContext2D = context2d;

  const offscreenCanvas = document.createElement("canvas");
  offscreenCanvas.width = canvas2d.width;
  offscreenCanvas.height = canvas2d.height;

  const glContext = offscreenCanvas.getContext("webgl2", { preserveDrawingBuffer: true });
  if (!glContext) throw new Error("EZSL runtime: WebGL2 is not supported in this environment (mountToCanvas2D still requires a real, offscreen WebGL2 context to render the shader — see docs/architecture/canvas2d-interop.md)");
  const gl: WebGL2RenderingContext = glContext;

  const renderer = setupWebglRenderer(gl, program, options);

  const width = offscreenCanvas.width;
  const height = offscreenCanvas.height;
  const pixels = new Uint8Array(width * height * 4);

  function copyFrameToCanvas2D() {
    renderer.drawFrame(width, height);
    // gl.readPixels reads bottom-to-top (GL's origin is bottom-left); ImageData
    // is top-to-bottom, so rows must be flipped during the copy, not just
    // read directly — reading directly into an ImageData buffer without this
    // flip renders the shader upside down (caught by comparing a readback
    // snapshot against the same shader's direct-to-canvas mount() output
    // while building this feature — see docs/architecture/canvas2d-interop.md).
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    const imageData = ctx2d.createImageData(width, height);
    const rowBytes = width * 4;
    for (let y = 0; y < height; y++) {
      const srcStart = (height - 1 - y) * rowBytes;
      const destStart = y * rowBytes;
      imageData.data.set(pixels.subarray(srcStart, srcStart + rowBytes), destStart);
    }
    ctx2d.putImageData(imageData, 0, 0);
    options.onFrame?.();
  }

  let rafId = 0;
  let intervalId: ReturnType<typeof setInterval> | undefined;

  if (options.once) {
    copyFrameToCanvas2D();
  } else {
    const fps = options.fps ?? 30;
    if (fps === Infinity) {
      const loop = () => {
        copyFrameToCanvas2D();
        rafId = requestAnimationFrame(loop);
      };
      rafId = requestAnimationFrame(loop);
    } else {
      intervalId = setInterval(copyFrameToCanvas2D, 1000 / fps);
    }
  }

  return {
    offscreenCanvas,
    gl,
    stop() {
      if (rafId) cancelAnimationFrame(rafId);
      if (intervalId !== undefined) clearInterval(intervalId);
    },
    setUniform: renderer.setUniform,
  };
}
