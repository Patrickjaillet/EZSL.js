/**
 * A minimal, EZSL-independent WebGL2 compile/link/draw-loop — deliberately
 * NOT `src/runtime/bootstrap.ts`'s `mount()` (which only ever accepts a
 * compiled EZSL `Program`, and always renders GLSL text
 * `generateFragmentShaderMapped` produced). This function exists so the
 * "hand-written GLSL" side of the v0.7 performance benchmark has zero
 * EZSL involvement at all — a true baseline, not EZSL's own runtime
 * running EZSL-authored text. See docs/architecture/performance-benchmarks.md.
 */
export interface RawGlslHandle {
  gl: WebGL2RenderingContext;
  drawFrame(width: number, height: number, elapsedSeconds: number): void;
  stop(): void;
}

export function mountRawGlsl(canvas: HTMLCanvasElement, vertexSource: string, fragmentSource: string): RawGlslHandle {
  const gl = canvas.getContext("webgl2");
  if (!gl) throw new Error("benchmark harness: WebGL2 is not supported in this environment");

  function compile(type: number, source: string): WebGLShader {
    const shader = gl!.createShader(type)!;
    gl!.shaderSource(shader, source);
    gl!.compileShader(shader);
    if (!gl!.getShaderParameter(shader, gl!.COMPILE_STATUS)) {
      throw new Error(`benchmark harness: shader compile error: ${gl!.getShaderInfoLog(shader)}`);
    }
    return shader;
  }

  const vertexShader = compile(gl.VERTEX_SHADER, vertexSource);
  const fragmentShader = compile(gl.FRAGMENT_SHADER, fragmentSource);
  const glProgram = gl.createProgram()!;
  gl.attachShader(glProgram, vertexShader);
  gl.attachShader(glProgram, fragmentShader);
  gl.linkProgram(glProgram);
  if (!gl.getProgramParameter(glProgram, gl.LINK_STATUS)) {
    throw new Error(`benchmark harness: program link error: ${gl.getProgramInfoLog(glProgram)}`);
  }

  const quadVertices = new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]);
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const vertexBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, quadVertices, gl.STATIC_DRAW);
  const positionLoc = gl.getAttribLocation(glProgram, "a_position");
  gl.enableVertexAttribArray(positionLoc);
  gl.vertexAttribPointer(positionLoc, 2, gl.FLOAT, false, 0, 0);

  const uTimeLoc = gl.getUniformLocation(glProgram, "u_time");
  const uResolutionLoc = gl.getUniformLocation(glProgram, "u_resolution");

  return {
    gl,
    drawFrame(width, height, elapsedSeconds) {
      gl.viewport(0, 0, width, height);
      gl.useProgram(glProgram);
      gl.bindVertexArray(vao);
      gl.uniform1f(uTimeLoc, elapsedSeconds);
      gl.uniform2f(uResolutionLoc, width, height);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    },
    stop() {
      gl.deleteProgram(glProgram);
    },
  };
}
