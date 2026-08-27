# EZSL.js — Performance Benchmark Suite (Beta Deliverable)

Internal design doc for the "Performance benchmark suite (transpile time, runtime FPS parity vs. hand-written GLSL)" item under the v0.5.x–v0.7.x Beta "Deliverables" section of `ROADMAP.md`. Read `docs/architecture/integration-testing.md` first — this benchmark suite reuses that suite's Playwright-driven, real-browser methodology, applied to timing instead of correctness.

## What's actually being measured, and why in a real browser

Two independent measurements, both run in a real Chromium browser via Playwright (`tests/benchmark/run.mjs`), not Node's own timers:

1. **Transpile time**: how long `compileEzsl` + `generateFragmentShaderMapped` take, over many iterations, for a couple of representative `.ezsl` programs.
2. **Runtime FPS parity**: rendered frames-per-second for EZSL's generated GLSL vs. independently hand-written GLSL for the *same visual program*, on the same WebGL2 measurement code path.

A real browser is used for both, not just (2) — even transpile timing runs in the same Playwright/Chromium process as the FPS test, for one practical reason: `performance.now()` and the JIT/engine characteristics that matter for "how fast does this run in the environment users actually run it in" are the browser's, not Node's. This mirrors the project's standing rule that runtime-facing claims get validated in a real browser, not approximated.

## Transpile time: what's timed and how

`timeTranspile()` (`tests/benchmark/_harness/main.ts`) runs `compileEzsl(source)` → `generateFragmentShaderMapped(program)` — the exact pipeline `ezsl build`/`ezsl check` run (see `docs/architecture/cli.md`) — 500 times per shader, after a 50-iteration warmup pass (discarded, so the reported numbers reflect steady-state JIT-compiled performance, not first-call interpretation overhead — standard microbenchmark practice). Both mean and median are reported; median is more robust against the occasional GC-pause outlier a mean can be skewed by. Two representative shaders are covered: `gradient` (a single top-level expression, no control flow) and `raymarch` (a 64-iteration bounded `for` loop with a nested `if`, the most control-flow-heavy example in `examples/`) — chosen to bound the range from "trivial" to "compiler actually has real work to do."

## Runtime FPS parity: what's compared, and a real measurement bug found while building this

For each representative shader, EZSL's generated GLSL and an independently hand-written GLSL fragment shader for the same visual program (`tests/benchmark/_harness/handwritten.ts` — written from scratch to look like GLSL a human would actually write, not the generated text with whitespace changed) are both compiled and linked via `mountRawGlsl()` (`tests/benchmark/_harness/mountRawGlsl.ts`), a minimal WebGL2 compile/link/draw-loop that is **not** `src/runtime/bootstrap.ts`'s `mount()` — deliberately, so the hand-written side has zero EZSL involvement at all (a true baseline), and so both sides are driven through the *identical* measurement code path (same vertex shader, same fullscreen quad, same `countFrames` loop), leaving "which fragment shader text was compiled" as the only variable between the two measurements.

**A real, reproducible measurement bug was found and fixed while building this.** The first version ran one long trial per side — 3 full seconds of EZSL's shader, stop, then 3 full seconds of the hand-written shader, sequentially, always in that order. For `gradient` this produced a clean 100% parity (both sides simply hit the 60fps vsync ceiling). For `raymarch` — genuinely compute-bound, below the vsync ceiling on both sides — it produced a striking, repeatable **~70% "parity"** (38fps EZSL vs. 54fps hand-written), which had no plausible explanation in the GLSL text itself: the two shaders differ only in cosmetic parenthesization and an unused intermediate `float time = u_time;` / `vec2 resolution = u_resolution;` local pair EZSL's boilerplate always emits (see `generateFragmentShaderMapped`'s `BOILERPLATE_PRELUDE` in `src/codegen/glslGenerator.ts`) — nothing a modern GLSL compiler wouldn't already constant-fold or dead-code-eliminate. The suspicious part: EZSL's shader *always ran first* in that version, and hand-written *always ran second*. Swapping the run order confirmed the hypothesis directly — whichever side ran first was consistently slower, regardless of which shader it was. This points at GPU/driver warm-up state (frequency scaling, shader-cache priming, or similar) biasing whichever measurement happens first, not a real per-shader-text cost difference.

**The fix**: `measureFps()` now runs `rounds` short trials (500ms each, 6 rounds = 3000ms total per side — same total measurement time as before) in strictly alternating order (EZSL, hand-written, EZSL, hand-written, ...), and additionally flips which side goes first on each successive round, so across the full run both sides spend an equal number of trials in the "runs first" and "runs second" position — a standard interleaving technique for canceling out exactly this kind of order-dependent bias. After the fix, `raymarch` reports ~100-107% parity, consistent with `gradient` and with the "EZSL transpiles to clean, native GLSL with no runtime overhead" design pillar this whole benchmark exists to verify. Re-running the suite multiple times after the fix shows both shaders consistently landing in the 95-110% parity range — noise-level variation, not a systematic gap in either direction.

## Suite structure

- `tests/benchmark/_harness/` — a Vite-served page (mirroring `examples/_harness/`'s pattern from the cross-browser integration suite): `main.ts` orchestrates both measurements and writes results to `window.__benchmarkResults`/`window.__benchmarkDone`; `handwritten.ts` holds the hand-written GLSL baselines; `mountRawGlsl.ts` is the EZSL-independent WebGL2 harness described above.
- `tests/benchmark/run.mjs` — starts the Vite server, launches Chromium via Playwright, waits for `__benchmarkDone`, prints formatted tables, and writes the full raw results to `tests/benchmark/last-results.json` (git-ignored — a point-in-time measurement, not a tracked fixture; re-run `npm run benchmark` for current numbers on the machine running it).
- `npm run benchmark` — the entry point.

## What this doesn't cover

- **Only two representative shaders.** Not every example in `examples/` has a hand-written GLSL counterpart — maintaining a parallel hand-written shader for all 24+ single-pass examples was judged not worth the ongoing maintenance cost for what this benchmark needs to demonstrate (that EZSL-generated GLSL has no structural overhead, not an exhaustive shader-by-shader audit).
- **No multi-pass/Three.js/Canvas2D/WGSL benchmarking.** Scoped to the single-pass `mount()`-equivalent path only, matching the CLI/dev-server's own established single-file scope (`docs/architecture/cli.md`, `docs/architecture/dev-server.md`).
- **No cross-machine/cross-GPU tracking over time.** Results are a snapshot (`last-results.json`, regenerated on each run, not committed) — there's no historical trend database or CI regression gate wired to this yet.
- **No WGSL/WebGPU-target benchmarking** — consistent with the WGSL target's own scope (unvalidated against a real `GPUDevice` — see `docs/architecture/webgpu-target.md`), there's no real WebGPU runtime to benchmark against yet.

## Sample results (one real run, this environment)

```
Transpile time (compileEzsl + codegen), 500 iterations each after warmup:
  shader     iterations   mean (ms)   median (ms)
  gradient          500      0.0462        0.0000
  raymarch          500      0.0930        0.1000

Runtime FPS: EZSL-generated GLSL vs. independently hand-written GLSL (same measurement loop, 3000ms each):
  shader     EZSL fps   hand-written fps   parity
  gradient       59.0                58.7   100.6%
  raymarch       59.3                55.3   107.2%
```

Transpile time is sub-millisecond even for the control-flow-heavy `raymarch` example — negligible next to a single WebGL2 shader compile/link round-trip (which itself typically costs low-single-digit milliseconds on real hardware, driver-dependent). FPS parity for both shaders lands within noise of 100%, confirming EZSL's generated GLSL carries no measurable runtime cost versus hand-written GLSL for the same logic.
