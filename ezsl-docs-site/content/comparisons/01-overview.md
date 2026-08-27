# EZSL vs GLSL vs Shadertoy vs WGSL

You'll see all four of these names throughout shader-programming content on the web, but they aren't four peers in the same category — mixing them up leads to real confusion. Before comparing any code, here's what each one actually *is*:

- **GLSL ES 3.00** — the real shading language WebGL2 runs. This is what EZSL compiles down to; every EZSL construct maps to GLSL you could have written by hand. Understanding GLSL is understanding what your EZSL code actually becomes on the GPU.
- **Shadertoy** — not a language. It's a website and a *convention*: plain GLSL with a specific preamble (a fixed set of uniforms like `iTime`/`iResolution`, and a `mainImage(out vec4 fragColor, in vec2 fragCoord)` entry point instead of a bare `main()`). A "Shadertoy shader" is GLSL written to that convention.
- **WGSL** — WebGPU's shading language, a genuinely different language from GLSL (different syntax, a stricter type system, its own uniform-binding model). EZSL.js has an experimental WGSL code generator — see the callout below.
- **EZSL** — the beginner-friendly syntax this whole site teaches, which compiles to GLSL ES 3.00 (and experimentally to WGSL).

<div class="badge badge-experimental">Experimental — unvalidated</div>

WGSL output is experimental: EZSL.js has never compiled or run this generated WGSL against a real `GPUDevice` — it is validated only by unit tests asserting the generated text's structure. Treat every WGSL example on this page as illustrative, not a proven-working shader. See `docs/architecture/webgpu-target.md` for the full validation-gap writeup.

## What this section covers

- [Syntax side-by-side](./02-syntax-side-by-side.md) — the same gradient shader, written all four ways.
- [Type systems compared](./03-type-systems-compared.md) — how each handles types and inference.
- [Uniforms and varyings compared](./04-uniforms-and-varyings-compared.md) — how data gets from JavaScript into your shader.
- [Multi-pass rendering compared](./05-multi-pass-compared.md) — buffers, feedback, and how each ecosystem wires multiple render passes together.
