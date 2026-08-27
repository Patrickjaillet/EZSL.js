# ezsl-presets

Reusable EZSL shader effect presets for [EZSL.js](../README.md) — noise fields, SDF primitives, color grading, and blur/bloom passes, each shipped as a `defineFunction`-built `CustomFunction`, ready to drop into `compileEzsl(source, { customFunctions: [...] })`.

## Install

```bash
npm install ezsl-presets @patrickjaillet/ezsl
```

## Usage

Every preset is a plain value — no registration step, no side effects — that you pass into `compileEzsl`'s `customFunctions` option:

```ts
import { compileEzsl, mount } from "@patrickjaillet/ezsl";
import { fbm2D } from "ezsl-presets/noise";

const program = compileEzsl(
  `n = fbm2D(uv * 3.0)
color = [n, n, n]`,
  { customFunctions: [fbm2D] },
);

mount(canvas, program);
```

Import from the barrel (`ezsl-presets`) or from an individual category subpath (`ezsl-presets/noise`, `ezsl-presets/sdf`, `ezsl-presets/colorGrading`, `ezsl-presets/blurBloom`) — both work, and both are tree-shakeable: a bundler only includes the presets you actually import, whichever path you use.

## What's included

### Noise (`ezsl-presets/noise`)

- **`hash2D(p)`** — a single-octave hash-based value noise, `vec2 -> float` in `[0,1)`. Cheap, visibly banded at low frequency — use it directly only when you specifically want raw per-pixel noise (dithering, stipple).
- **`fbm2D(p)`** — 4-octave fractal Brownian motion built on the same hash, `vec2 -> float`. The practical choice for anything meant to look organic (clouds, terrain, marble).

Both are the exact hash/accumulation formulas `examples/fbm-clouds/shader.ezsl` (in the main `ezsl` repo) already validates inline, factored into reusable functions.

### SDF primitives (`ezsl-presets/sdf`)

- **`sdfSphere(p, radius)`** — `vec3 -> float`, signed distance to a sphere at the origin.
- **`sdfBox(p, halfExtents)`** — `vec3, vec3 -> float`, signed distance to an axis-aligned box at the origin.
- **`sdfCircle2D(p, radius)`** / **`sdfBox2D(p, halfExtents)`** — the 2D analogues, for screen-space shapes.

Each takes a point already translated relative to the shape's own center (`p - shapeCenter`, computed by your own raymarch loop) — these are distance *functions*, not a whole raymarcher; pair them with your own accumulation loop, same as `examples/raymarch/shader.ezsl`/`examples/raymarch-box/shader.ezsl` do inline (the formulas here are lifted verbatim from those two validated examples).

### Color grading (`ezsl-presets/colorGrading`)

- **`cosinePalette(t)`** — `float -> vec3`, the classic cosine-palette technique for a smooth, perceptually pleasant color cycle from a single scalar input. (This is the same formula `examples/escape-hatch/shader.ezsl` uses under the name `hueShift`.)
- **`luminance(color)`** — `vec3 -> float`, Rec. 709 perceptual luminance.
- **`saturate(color, amount)`** — `vec3, float -> vec3`, adjusts saturation (`0.0` = grayscale, `1.0` = unchanged).
- **`contrast(color, amount)`** — `vec3, float -> vec3`, simple S-curve contrast around mid-gray.

### Blur / bloom (`ezsl-presets/blurBloom`)

These take a `sampler2D` — only meaningful inside a real [multi-pass pipeline](../docs/architecture/multi-pass.md), since a single-pass EZSL program has no texture input at all. EZSL's own `.sample(uv)` syntax has no way to pass a buffer as an ordinary function argument, so call these from a `glsl { ... }` Escape Hatch block, referencing the compiler-generated `u_buffer_<Name>` uniform directly:

```ts
import { createPipeline } from "@patrickjaillet/ezsl";
import { boxBlur9 } from "ezsl-presets/blurBloom";
```

```ezsl
// Image.ezsl — blurs BufferA's output
blurred = [0.0, 0.0, 0.0, 1.0]
glsl {
  blurred = boxBlur9(u_buffer_BufferA, uv, 1.0 / resolution);
}
color = blurred
```

```ts
createPipeline(canvas, {
  passes: {
    BufferA: { source: bufferASource },
    Image: { source: imageSource, customFunctions: [boxBlur9] },
  },
});
```

- **`boxBlur9(tex, uv, texelSize)`** — 9-tap box blur, cheap, visibly blocky at large radii.
- **`gaussianBlur13(tex, uv, texelSize)`** — 13-tap Gaussian-weighted blur, smoother than the box blur, still a single pass (not a true two-pass separable Gaussian).
- **`brightnessThreshold(tex, uv, threshold)`** — extracts pixels brighter than `threshold`, zeroing the rest — the usual first stage of a bloom effect, before blurring and additively compositing back onto the original image.

## Combining presets

Registering multiple presets from the same category together is safe — each preset that needs a private helper (e.g. `saturate`'s own internal luminance calculation) names it with a collision-avoiding suffix internally, so it won't clash with, say, also importing the standalone `luminance` preset in the same compile call. Every combination in this package is covered by a real compile-through-`compileEzsl` test — see `tests/presets.test.ts`.

## Development

```bash
npm install
npm run build      # tsc -> dist/
npm test           # real compileEzsl() calls against every preset, checked for collisions
```

`demo/` is a small Vite page (`npx vite ezsl-presets/demo`) rendering three presets (`fbm2D`, `sdfSphere` via a raymarch loop, `cosinePalette`) in real WebGL2 canvases — used to visually confirm the presets actually render correctly, not just compile, while building this package.
