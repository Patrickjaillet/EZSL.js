# EZSL.js: WebGL shaders without the boilerplate

Getting from "I want to make cool visuals in the browser" to a working WebGL shader today means learning vector math, the GPU pipeline, and raw GLSL syntax more or less all at once — before you've drawn a single gradient. That gap is what **EZSL.js** exists to close, and as of today it's a real, published 1.0: `npm install @patrickjaillet/ezsl`.

```js
import { compileEzsl, mount } from "@patrickjaillet/ezsl";

const program = compileEzsl(`color = [uv.x, uv.y, 0.5 + 0.5 * sin(time)]`);
mount(document.querySelector("canvas"), program);
```

That's a complete, animated fragment shader — five lines shorter than the `#version`, `precision`, uniform declarations, and `out vec4 fragColor` boilerplate it compiles to.

## What it actually is

EZSL.js is a DSL and transpiler: a simplified, beginner-friendly syntax that compiles down to clean, native GLSL ES 3.00. It's not a new language runtime and not a GLSL replacement — every EZSL construct maps to GLSL you could have written by hand, and there's no black box between what you write and what runs on the GPU. When EZSL's syntax doesn't cover something you need, an Escape Hatch (`glsl { ... }`) lets you drop into raw GLSL inline, in the same file.

```ezsl
fn falloff(d) {
  return 1.0 / (1.0 + d * d)
}

d = length(uv - [0.5, 0.5])
brightness = falloff(d)
color = [brightness, brightness, brightness]
```

Type inference is shape-based and works the way you'd expect: number literals are `float`, `[x, y, z]` infers a `vec3`, a `for`-loop counter is `int`. Assign a name once and it's declared; assign it again and it's a reassignment — that's how loop-accumulated state (raymarching, accumulation buffers) gets expressed without any extra syntax.

## The part that took the most work: errors that teach

A raw WebGL driver error is famously unhelpful — a wall of ANGLE-format text with no connection back to the line you actually wrote. EZSL.js parses that log, matches it against a structural dictionary (not literal string matching — the driver's phrasing varies), and reports it with a source snippet from your actual `.ezsl` file, a plain-English explanation, and — where the compiler has enough context — a "did you mean?" suggestion:

```
unknown function 'smoothstp' — did you mean 'smoothstep'?
```

The raw driver text is always still shown alongside, never hidden — the goal is to teach shader concepts, not paper over them.

## Built for real use, not just toy shaders

- **Shadertoy-style multi-pass rendering** — named buffer passes, `BufferName.sample(uv)`, automatic dependency ordering, real cycle detection before any WebGL context even exists, and ping-pong feedback buffers for accumulation effects.
- **Framework integrations** — a Three.js bridge (`createThreeMaterial`, with real vertex-stage EZSL authoring), a Babylon.js bridge (`createBabylonMaterial`, same vertex-stage authoring adapted to Babylon's own real builtin names and typed uniform-setter API), and Canvas2D compositing (`mountToCanvas2D`, for layering shader output with ordinary 2D drawing calls like `fillText`).
- **A full developer-tooling story** — a CLI (`ezsl build`/`check`/`watch`) for compiling outside the browser, a live-reload dev server (`ezsl dev`) that hot-swaps a newly compiled shader into an already-running WebGL2 context with no full page reload, real DevTools stack-trace integration, and a VS Code extension with syntax highlighting and inferred-type hover tooltips.
- **An experimental WebGPU/WGSL target** — a WGSL code generator sharing the same compiled program representation as the GLSL path. It's honestly labeled experimental: no real `GPUDevice` was available to validate against during development, so it's tested on generated-text structure only, not a real WebGPU compile.

## An ecosystem, not just a library

Two companion packages, each independently useful:

- **[ezsl-presets](https://github.com/Patrickjaillet/EZSL.js/tree/master/ezsl-presets)** — reusable noise fields, SDF primitives, color grading, and blur/bloom passes as pre-built functions, ready to drop into `compileEzsl`.
- **[ezsl-docs-site](https://github.com/Patrickjaillet/EZSL.js/tree/master/ezsl-docs-site)** — the unified documentation site: a progressive tutorial track with live-editable code blocks, a Shadertoy-style Playground (`#/playground`) with a 33-shader gallery and shareable URLs, and an EZSL vs GLSL vs Shadertoy vs WGSL comparison tier. Live now at **[patrickjaillet.github.io/EZSL.js](https://patrickjaillet.github.io/EZSL.js/)**.

## How this was actually validated

Every claim above is backed by more than "the tests pass." The full pipeline — and every one of the 41 example programs shipped in `examples/` — is confirmed to compile, link, and render correctly in real browser engines: Chromium, Firefox, WebKit, and Edge, via Playwright, not just Node-side assertions on generated GLSL text. The live-reload dev server's hot-swap, the DevTools stack-trace resolution, and the VS Code extension's hover tooltips were each confirmed in real running sessions, not just unit-tested in isolation. The transpiler core carries 97%+ statement coverage, a hand-rolled parser fuzzer found and fixed a real stack-overflow crash on deeply-nested input, and a manual security review found and fixed a real path-traversal vulnerability in the dev server's static-file route before this release. None of that is a claim you have to take on faith — `docs/architecture/` in the repository documents each one, including the bugs found along the way.

## Try it

```bash
npm install @patrickjaillet/ezsl
```

Or clone the repository and run any of the ~41 bundled examples locally — see the [README](https://github.com/Patrickjaillet/EZSL.js) for the full list. If you want a guided walkthrough of a specific integration, there are tutorials for [Three.js](https://github.com/Patrickjaillet/EZSL.js/blob/master/docs/tutorials/three-js-scene.md), [multi-pass/Shadertoy-style rendering](https://github.com/Patrickjaillet/EZSL.js/blob/master/docs/tutorials/multi-pass-shadertoy.md), and [Canvas2D compositing](https://github.com/Patrickjaillet/EZSL.js/blob/master/docs/tutorials/canvas2d-compositing.md).

---

**EZSL.js** — © 2026 Patrick JAILLET. Licensed under the [MIT License](../LICENSE.md).
