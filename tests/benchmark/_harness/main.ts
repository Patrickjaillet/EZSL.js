import { compileEzsl } from "../../../src/index.js";
import { generateFragmentShaderMapped, generateVertexShader } from "../../../src/codegen/glslGenerator.js";
import gradientSource from "../../../examples/gradient/shader.ezsl?raw";
import raymarchSource from "../../../examples/raymarch/shader.ezsl?raw";
import { GRADIENT_HANDWRITTEN, RAYMARCH_HANDWRITTEN, FULLSCREEN_QUAD_VERTEX } from "./handwritten.js";
import { mountRawGlsl } from "./mountRawGlsl.js";

interface TranspileTimingResult {
  name: string;
  iterations: number;
  totalMs: number;
  meanMs: number;
  medianMs: number;
}

interface FpsResult {
  name: string;
  durationMs: number;
  ezslFrames: number;
  ezslFps: number;
  handwrittenFrames: number;
  handwrittenFps: number;
  /** (ezslFps / handwrittenFps) * 100 — 100 means identical throughput; this is the "runtime FPS parity" the roadmap item asks for. */
  parityPercent: number;
}

/**
 * Times `tokenize -> parse -> compile -> codegen` (the full transpile
 * pipeline, matching what `ezsl build`/`ezsl check` actually run — see
 * docs/architecture/cli.md) over many iterations, reporting mean and
 * median milliseconds. A single call is normally sub-millisecond and too
 * noisy to trust in isolation (GC pauses, JIT warmup, timer resolution),
 * hence the iteration count and reporting both mean and median (median is
 * more robust against the occasional GC-pause outlier).
 */
function timeTranspile(name: string, source: string, iterations: number): TranspileTimingResult {
  // Warm up the JIT before measuring, so the reported numbers reflect
  // steady-state performance, not first-call interpretation/compilation
  // overhead — the same reason any serious microbenchmark discards a
  // warmup phase.
  for (let i = 0; i < Math.min(50, iterations); i++) {
    generateFragmentShaderMapped(compileEzsl(source));
  }

  const samples: number[] = [];
  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    generateFragmentShaderMapped(compileEzsl(source));
    samples.push(performance.now() - start);
  }

  const totalMs = samples.reduce((a, b) => a + b, 0);
  const sorted = [...samples].sort((a, b) => a - b);
  const medianMs = sorted[Math.floor(sorted.length / 2)];

  return { name, iterations, totalMs, meanMs: totalMs / iterations, medianMs };
}

/** Renders on a real requestAnimationFrame loop for `durationMs` and counts completed frames. */
function countFrames(drawFrame: (elapsedSeconds: number) => void, durationMs: number): Promise<number> {
  return new Promise((resolve) => {
    let frames = 0;
    const start = performance.now();
    function frame() {
      const elapsed = performance.now() - start;
      if (elapsed >= durationMs) {
        resolve(frames);
        return;
      }
      drawFrame(elapsed / 1000);
      frames++;
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  });
}

/**
 * Measures rendered FPS for the EZSL-generated GLSL vs. the hand-written
 * GLSL for the same visual program, driving *both* through the identical
 * `mountRawGlsl` + `countFrames` code path (same vertex shader, same quad,
 * same measurement loop) so the only variable between the two
 * measurements is which fragment shader text was compiled — not which
 * runtime drove it. `mount()` (EZSL's own runtime) is intentionally not
 * used for this measurement: it and `mountRawGlsl` would drive the exact
 * same GL draw calls anyway (the whole point of "no runtime overhead" —
 * see docs/architecture/performance-benchmarks.md), so routing the EZSL
 * side through `mount()`'s own rAF loop while the hand-written side used
 * a different loop would risk measuring a driver-loop difference instead
 * of a GLSL-shader-cost difference.
 *
 * Runs `rounds` short interleaved trials (EZSL, hand-written, EZSL,
 * hand-written, ...) rather than one long trial per side, and averages
 * each side's FPS across its rounds — a real, measured bias was found
 * while building this: always running EZSL first and hand-written second
 * (one long trial each) produced a large, reproducible gap (raymarch:
 * 38fps vs 54fps, ~70% "parity") that had no plausible explanation in the
 * GLSL text itself (the two shaders differ only in cosmetic parenthesization
 * and an unused intermediate `time`/`resolution` local EZSL always emits —
 * nothing a modern GLSL compiler wouldn't already optimize away). Swapping
 * which side ran first moved the gap to the other side, confirming it was
 * a run-order artifact (GPU/driver warm-up state, not a real per-shader
 * cost difference) rather than anything about EZSL's generated code.
 * Interleaving cancels that bias out, since each side gets an equal number
 * of "goes first" and "goes second" trials.
 */
async function measureFps(name: string, ezslSource: string, handwrittenFragment: string, roundMs: number, rounds: number): Promise<FpsResult> {
  const width = 512;
  const height = 512;

  const program = compileEzsl(ezslSource);
  const { source: ezslGlsl } = generateFragmentShaderMapped(program);

  const ezslCanvas = document.createElement("canvas");
  ezslCanvas.width = width;
  ezslCanvas.height = height;
  const handwrittenCanvas = document.createElement("canvas");
  handwrittenCanvas.width = width;
  handwrittenCanvas.height = height;

  const ezslHandle = mountRawGlsl(ezslCanvas, generateVertexShader(), ezslGlsl);
  const handwrittenHandle = mountRawGlsl(handwrittenCanvas, FULLSCREEN_QUAD_VERTEX, handwrittenFragment);

  let ezslFrames = 0;
  let handwrittenFrames = 0;

  for (let round = 0; round < rounds; round++) {
    // Alternate which side goes first each round, so across all rounds
    // both sides spend an equal number of trials in the "goes first" and
    // "goes second" position.
    if (round % 2 === 0) {
      ezslFrames += await countFrames((t) => ezslHandle.drawFrame(width, height, t), roundMs);
      handwrittenFrames += await countFrames((t) => handwrittenHandle.drawFrame(width, height, t), roundMs);
    } else {
      handwrittenFrames += await countFrames((t) => handwrittenHandle.drawFrame(width, height, t), roundMs);
      ezslFrames += await countFrames((t) => ezslHandle.drawFrame(width, height, t), roundMs);
    }
  }

  ezslHandle.stop();
  handwrittenHandle.stop();

  const totalMs = roundMs * rounds;
  const ezslFps = (ezslFrames / totalMs) * 1000;
  const handwrittenFps = (handwrittenFrames / totalMs) * 1000;

  return {
    name,
    durationMs: totalMs,
    ezslFrames,
    ezslFps,
    handwrittenFrames,
    handwrittenFps,
    parityPercent: (ezslFps / handwrittenFps) * 100,
  };
}

async function main() {
  const transpileResults: TranspileTimingResult[] = [
    timeTranspile("gradient", gradientSource, 500),
    timeTranspile("raymarch", raymarchSource, 500),
  ];

  const fpsResults: FpsResult[] = [
    await measureFps("gradient", gradientSource, GRADIENT_HANDWRITTEN, 500, 6),
    await measureFps("raymarch", raymarchSource, RAYMARCH_HANDWRITTEN, 500, 6),
  ];

  (window as unknown as { __benchmarkResults: { transpile: TranspileTimingResult[]; fps: FpsResult[] } }).__benchmarkResults = {
    transpile: transpileResults,
    fps: fpsResults,
  };
  (window as unknown as { __benchmarkDone: boolean }).__benchmarkDone = true;
}

main();
