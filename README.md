# EZSL.js

**EZSL.js** — *Easy Shader Language for JavaScript* — is a DSL that compiles a simplified, beginner-friendly syntax down to clean, native GLSL, aimed at making WebGL shader programming approachable without limiting expert users.

```bash
npm install @patrickjaillet/ezsl
```

## Why EZSL.js

Getting from "I want to make cool visuals in the browser" to a working WebGL shader today means learning vector math, the GPU pipeline, and raw GLSL syntax more or less all at once, before you can draw a single gradient. EZSL.js exists to close that gap — without asking expert users to give up a single bit of native GLSL power to get there. Every EZSL construct transpiles to clean, inspectable GLSL you could have written by hand; nothing about the output is a black box, and an Escape Hatch (`glsl { ... }`) lets you drop into raw GLSL inline whenever you need something EZSL doesn't express yet.

```ezsl
color = [uv.x, uv.y, 0.5 + 0.5 * sin(time)]
```

That's a complete, animated, running EZSL fragment shader — five lines shorter than the equivalent GLSL boilerplate (`#version`, `precision`, uniform declarations, `out vec4 fragColor`) it compiles to.

```js
import { compileEzsl, mount } from "@patrickjaillet/ezsl";

const program = compileEzsl(`color = [uv.x, uv.y, 0.5 + 0.5 * sin(time)]`);
mount(document.querySelector("canvas"), program);
```

## What's included

- **A real, type-inferring transpiler**: tokenizer → parser → compiler → GLSL ES 3.00 codegen → WebGL2 runtime, with shape-based type inference (scalars, vectors, matrices, fixed-size arrays, structs), user-defined functions (`fn`), bounded `for` loops, `if`/`else`, and the `glsl { ... }` Escape Hatch for raw GLSL interop.
- **Errors that teach, not just fail**: a driver compile/link failure is parsed, matched against a structural dictionary, and reported with a `.ezsl`-relative source snippet, a plain-English explanation, and — where the compiler has enough context — a Levenshtein-distance "did you mean?" suggestion (`unknown function 'smoothstp' — did you mean 'smoothstep'?`).
- **Shadertoy-style multi-pass rendering**: named buffer passes, `BufferName.sample(uv)`, automatic dependency ordering, real cycle detection at pipeline-construction time (before any WebGL context exists), and ping-pong feedback buffers for accumulation effects.
- **Framework integrations**: a Three.js bridge (`createThreeMaterial`, real vertex-stage EZSL authoring) and Canvas2D compositing (`mountToCanvas2D`, for layering shader output with ordinary 2D drawing).
- **An experimental WebGPU/WGSL target**: a WGSL code generator and UBO-layout auto-generator, sharing the same compiled program representation as the GLSL path. Explicitly experimental — validated by exhaustive unit tests on generated WGSL text structure only, never compiled against a real `GPUDevice`.
- **A full developer-tooling story**:
  - `ezsl build`/`check`/`watch` — a CLI for compiling `.ezsl` files outside the browser, with the same beginner-friendly error formatting.
  - `ezsl dev` — a live-reload dev server that hot-swaps a newly compiled shader into an already-running WebGL2 context (no full page reload, no context-budget exhaustion from tearing down and remounting on every edit).
  - Real browser DevTools integration — a shader compile failure throws an `Error` whose stack trace resolves to a real, clickable `.ezsl` file and line.
  - A [VS Code extension](vscode-extension/) — syntax highlighting plus hover tooltips showing the real, compiler-inferred type of any local variable.

## Ecosystem

- [ezsl-presets](ezsl-presets/) — reusable noise/SDF/color-grading/blur-bloom shader presets as pre-built functions.
- [ezsl-playground](ezsl-playground/) — a browser-based editor with live GLSL output, a curated shader gallery, and shareable URLs.
- [ezsl-docs-site](ezsl-docs-site/) — an interactive documentation site with live-editable code blocks.

## Learn more

- `docs/ezsl-language-reference.md` — an informal tutorial covering the language.
- `docs/EZSL_LANGUAGE_SPECIFICATION_v1.0.md` — the normative language specification.
- `docs/tutorials/three-js-scene.md`, `docs/tutorials/multi-pass-shadertoy.md`, `docs/tutorials/canvas2d-compositing.md` — guided walkthroughs of each framework integration.
- `docs/API_STABILITY.md` — the frozen public API surface and this project's breaking-change/deprecation policy.

## Validation

Every claim above is backed by something more concrete than "the tests pass." The full transpiler pipeline — and every one of the 28 example programs in `examples/` — is confirmed to compile, link, and render correctly (or, for two deliberately-broken examples, to fail with a correctly translated error) in real browser engines (Chromium, Firefox, WebKit, Edge), not just Node-side unit tests asserting on generated GLSL text. 97%+ statement coverage on the transpiler core, a hand-rolled parser fuzzer, and a manual security review are also part of the v1.0.x quality bar — see `docs/architecture/` for the details and the bugs each one actually found.

## Contributing / developing locally

```bash
git clone <repository-url>
cd EZSLjs
npm install
npm run build
npm test
npm run example:gradient   # or any of ~28 examples: gradient, circle, plasma, noise, raymarch, and more
```

See `docs/architecture/` for design docs on each part of the pipeline, and `docs/ezsl-language-reference.md` for the language itself.

---

**EZSL.js** — © 2026 Patrick JAILLET. Licensed under the [MIT License](LICENSE.md).
