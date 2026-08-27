# EZSL.js — Public Beta

> **Superseded.** This announcement describes the project's state at the end of v0.7.x, before the v1.0.x Stable Release. It's kept as-is for historical accuracy — do not edit it to reflect current state. As of `v1.0.0`, the package **is** published to npm: `npm install @patrickjaillet/ezsl` (the `npm install ezsl` command below no longer applies — the bare name was rejected by npm's registry as too similar to existing packages, so the package is scoped under `@patrickjaillet/ezsl`). See `README.md` for current install/usage instructions and `ROADMAP.md` for what's shipped since this was written.

**EZSL.js** — *Easy Shader Language for JavaScript* — is a DSL that compiles a simplified, beginner-friendly syntax down to clean, native GLSL, aimed at making WebGL shader programming approachable without limiting expert users. Today, with v0.7.x complete, it's ready for a public Beta: a full transpiler pipeline, three framework integrations, an experimental WebGPU target, and a complete developer-tooling story — CLI, live-reload dev server, DevTools source maps, and a VS Code extension.

## Why EZSL.js

Getting from "I want to make cool visuals in the browser" to a working WebGL shader today means learning vector math, the GPU pipeline, and raw GLSL syntax more or less all at once, before you can draw a single gradient. EZSL.js exists to close that gap — without asking expert users to give up a single bit of native GLSL power to get there. Every EZSL construct transpiles to clean, inspectable GLSL you could have written by hand; nothing about the output is a black box, and an Escape Hatch (`glsl { ... }`) lets you drop into raw GLSL inline whenever you need something EZSL doesn't express yet.

```ezsl
color = [uv.x, uv.y, 0.5 + 0.5 * sin(time)]
```

That's a complete, animated, running EZSL fragment shader — five lines shorter than the equivalent GLSL boilerplate (`#version`, `precision`, uniform declarations, `out vec4 fragColor`) it compiles to.

## What's in this Beta

- **A real, type-inferring transpiler**: tokenizer → parser → compiler → GLSL ES 3.00 codegen → WebGL2 runtime, with shape-based type inference (scalars, vectors, matrices, fixed-size arrays, structs), user-defined functions (`fn`), bounded `for` loops, `if`/`else`, and the `glsl { ... }` Escape Hatch for raw GLSL interop.
- **Errors that teach, not just fail**: a driver compile/link failure is parsed, matched against a structural dictionary, and reported with a `.ezsl`-relative source snippet, a plain-English explanation, and — where the compiler has enough context — a Levenshtein-distance "did you mean?" suggestion (`unknown function 'smoothstp' — did you mean 'smoothstep'?`).
- **Shadertoy-style multi-pass rendering**: named buffer passes, `BufferName.sample(uv)`, automatic dependency ordering, real cycle detection at pipeline-construction time (before any WebGL context exists), and ping-pong feedback buffers for accumulation effects.
- **Framework integrations**: a Three.js bridge (`createThreeMaterial`, real vertex-stage EZSL authoring) and Canvas2D compositing (`mountToCanvas2D`, for layering shader output with ordinary 2D drawing) — both real, both validated in real browsers, not just compiled-and-hoped.
- **An experimental WebGPU/WGSL target**: a WGSL code generator and UBO-layout auto-generator, sharing the same compiled program representation as the GLSL path. Explicitly experimental and validated by exhaustive unit tests on generated WGSL text structure only — no real `GPUDevice` was available to compile against in this environment, and that limitation is documented rather than glossed over.
- **A full developer-tooling story**:
  - `ezsl build`/`check`/`watch` — a CLI for compiling `.ezsl` files outside the browser, with the same beginner-friendly error formatting.
  - `ezsl dev` — a live-reload dev server that hot-swaps a newly compiled shader into an already-running WebGL2 context (no full page reload, no context-budget exhaustion from tearing down and remounting on every edit).
  - Real browser DevTools integration — a shader compile failure throws an `Error` whose stack trace resolves to a real, clickable `.ezsl` file and line, via the same convention V8/SpiderMonkey/JavaScriptCore use for dynamically-evaluated code.
  - A VS Code extension — syntax highlighting plus hover tooltips showing the real, compiler-inferred type of any local variable.

## What "Beta" means here, precisely

This is a source-available Beta, not an npm-published one yet — there is no `ezsl` package on the npm registry today; `npm install ezsl` doesn't work. If you want to try it, clone the repository and build from source (`npm install && npm run build`). We're calling it a Beta because the core transpiler, runtime, and every integration listed above are feature-complete and validated end-to-end — not because distribution is finished. Closing that gap (an actual npm publish, a versioned `1.0.0` API-stability commitment) is v1.0.x scope, tracked in `ROADMAP.md`.

Two things not to read into "Beta": the WebGPU target is explicitly experimental (see above — it's real code, unit-tested, but never compiled against a real GPU device), and there's no hosted online playground yet — that's a `ROADMAP.md` v1.0.x item, alongside the interactive documentation site and preset shader library.

## How we validated this, and why that matters here

Every claim above is backed by something more concrete than "the tests pass." The full transpiler pipeline — and every one of the 28 example programs in `examples/` — is confirmed to compile, link, and render correctly (or, for two deliberately-broken examples, to fail with a correctly translated error) in **three real browser engines**: Chromium, Firefox, and WebKit, via Playwright, not just Node-side unit tests asserting on generated GLSL *text*. The live-reload dev server's hot-swap was confirmed with real screenshots of a shader updating live in a browser tab, including a broken-edit error overlay and a clean recovery. The DevTools source-map integration was confirmed by triggering a genuine driver-level compile failure and reading the resulting stack trace's real, clickable file/line reference. The VS Code extension was confirmed in a real Extension Development Host, hovering real variables and reading the tooltip. The performance benchmark suite backing the "no runtime overhead" claim measures real rendered FPS in a real browser, comparing EZSL-generated GLSL against independently hand-written GLSL for the same program — and that suite's own methodology was corrected mid-development after a first version's results turned out to be a measurement artifact (GPU/driver warm-up bias from always running one side first), a mistake worth mentioning because catching it, not just the final numbers, is what makes the "~100% parity" claim trustworthy.

## Try it

```bash
git clone <repository-url>
cd EZSLjs
npm install
npm run example:gradient   # or any of ~28 examples — see README.md for the full list
```

Read `docs/tutorials/three-js-scene.md`, `docs/tutorials/multi-pass-shadertoy.md`, or `docs/tutorials/canvas2d-compositing.md` for a guided walkthrough of a real integration.

## What's next

v1.0.x is the commitment point: freezing the public API, an actual npm publish, a formal `EZSL Language Specification v1.0`, ≥90% test coverage on the transpiler core, and — the bigger ecosystem push — an online playground, an interactive documentation site, and a preset/shader library. See `ROADMAP.md` for the full, versioned plan.

---

**EZSL.js** — © 2026 Patrick JAILLET. Licensed under the [MIT License](../LICENSE.md).
