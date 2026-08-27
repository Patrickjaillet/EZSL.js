# Tutorial: Shadertoy-style multi-pass rendering with a feedback trail

This tutorial builds a real, running multi-pass shader — a glowing dot that leaves a fading trail behind it as it orbits — using EZSL's `createPipeline()` API. It walks through the exact code in `examples/multi-pass/`, confirmed to link and render correctly in Chromium, Firefox, and WebKit on every `npm run test:integration` run.

If you've used [Shadertoy](https://www.shadertoy.com/)'s Buffer A/B/Image model, this will look immediately familiar — EZSL's multi-pass system deliberately mirrors that mental model. For the full design (ping-pong buffering, dependency-graph topological sort, cycle detection, float-framebuffer capability detection), see `docs/architecture/multi-pass.md`. This tutorial is task-oriented; that doc explains the mechanics underneath.

## What you'll build

A single moving dot that, instead of just being redrawn fresh every frame, leaves a persistent, gradually-fading trail — the classic "feedback buffer" effect, achieved by having a buffer pass read its own previous frame.

## Prerequisites

- `npm install` at the repository root.
- No new packages — multi-pass rendering is core `ezsl` functionality (`createPipeline`, `src/runtime/pipeline.ts`), nothing extra to install.

## Step 1: the mental model — named passes, one canvas output

A multi-pass EZSL pipeline is a set of **named passes**, each an ordinary, complete `.ezsl` program — no new EZSL syntax exists for declaring "this is a buffer" (see `docs/architecture/multi-pass.md`'s "why multiple files, not new syntax" reasoning). Exactly one pass must be named `"Image"` — the one actually rendered to your canvas. Every other pass is an offscreen buffer, invisible on its own, whose most recent rendered output any pass (including itself) can sample.

For this tutorial you need two passes: `BufferA` (the buffer holding the accumulating trail) and `Image` (which just displays `BufferA`'s latest frame).

## Step 2: `BufferA.ezsl` — sampling your own previous frame

```ezsl
prevColor = BufferA.sample(uv)
faded = prevColor.rgb * 0.92

center = [0.5 + 0.3 * cos(time), 0.5 + 0.3 * sin(time)]
d = length(uv - center)
dot0 = 1.0 - smoothstep(0.03, 0.05, d)

trail = [faded.x + dot0, faded.y + dot0 * 0.4, faded.z + dot0 * 0.8]
color = trail
```

Two new things appear here that don't exist in a single-pass shader:

- **`BufferA.sample(uv)`** — a new kind of expression (a *method call*, `object.method(args)`, distinct from an ordinary member access like `prevColor.rgb`). It samples the named pass's most recently rendered frame at the given UV coordinate, compiling to GLSL's `texture(u_buffer_BufferA, uv)`. The pipeline auto-binds that `sampler2D` uniform for you — you never declare it.
- **`BufferA` sampling itself.** This pass is named `BufferA`, and it calls `BufferA.sample(uv)` — a *self-reference*. This is not treated as a compile-time cycle error (which a genuine same-frame dependency loop, e.g. two buffers each sampling the other, would be) — it's recognized as a **feedback buffer**, and rendered via ping-pong double-buffering under the hood: one render target is read from (last frame's contents) while a second is written to (this frame's contents), then the two swap roles next frame. This is what makes `faded = prevColor.rgb * 0.92` actually work as "95% of last frame, gradually darkening" rather than reading and writing the same texture in the same draw call, which is undefined behavior in WebGL.

The rest is ordinary EZSL: `smoothstep` draws a soft-edged dot at a time-driven orbiting position, and `dot0` is additively blended onto the faded previous frame — the accumulation that produces a visible trail.

## Step 3: `Image.ezsl` — the pass you actually see

```ezsl
trail = BufferA.sample(uv)
color = trail
```

`Image` doesn't do any drawing of its own here — it just displays `BufferA`'s latest output on the canvas. (You could composite multiple buffers, apply a post-process color grade, etc. here instead — `Image` is just an ordinary pass like any other, with the one special rule that it's the one that reaches the screen.)

## Step 4: wire it up with `createPipeline`

```typescript
import { createPipeline } from "@patrickjaillet/ezsl"; // or "../../src/index.js" inside this repo
import bufferASource from "./BufferA.ezsl?raw";
import imageSource from "./Image.ezsl?raw";

const canvas = document.getElementById("canvas") as HTMLCanvasElement;

function resize() {
  canvas.width = canvas.clientWidth;
  canvas.height = canvas.clientHeight;
}
resize();
window.addEventListener("resize", resize);

createPipeline(canvas, {
  passes: {
    BufferA: { source: bufferASource },
    Image: { source: imageSource },
  },
});
```

That's the entire runtime setup — `createPipeline` compiles both passes, discovers that `Image` depends on `BufferA` (by inspecting which `sampler2D` uniforms each pass's own compile actually produced, not a separate static AST scan), recognizes `BufferA`'s self-sample as a feedback buffer rather than a cycle, sets up the ping-pong render targets, and starts a real WebGL2 draw loop — all before you touch a single `gl.*` call yourself.

`createPipeline` returns an `EzslPipelineHandle` (`{ canvas, gl, stop(), setUniform(name, value) }`) — `setUniform` sets a uniform on *every* pass that declared it, useful if a value (say, a user-controlled parameter) needs to reach more than one pass.

## Step 5 (optional): a higher-precision buffer

By default, buffer passes render to an 8-bit-per-channel (`RGBA8`) target — fine for this tutorial's trail effect, but a buffer accumulating values outside the 0-1 range (common in more advanced feedback effects, e.g. HDR bloom accumulation) needs more precision:

```typescript
createPipeline(canvas, {
  passes: {
    BufferA: { source: bufferASource, format: "RGBA16F" },
    Image: { source: imageSource },
  },
});
```

`format` accepts `"RGBA8"` (default), `"RGBA16F"`, or `"RGBA32F"`. The two floating-point formats require the `EXT_color_buffer_float` WebGL2 extension; if it's unavailable on the user's device, the pipeline degrades to `RGBA8` automatically with a `console.warn`, rather than throwing — see `docs/architecture/multi-pass.md` for the (not-yet-verified-on-real-unsupported-hardware) details of that fallback path. `format` is ignored on the `Image` pass, which always renders straight to the canvas's own default framebuffer.

## Run it

```bash
npm run example:multi-pass
```

Open the printed URL — you'll see a single glowing dot orbiting the canvas, trailing a fading streak behind it.

## What you've learned

- A multi-pass pipeline is a set of named, ordinary `.ezsl` passes, exactly one of which (`"Image"`) reaches the canvas.
- `<PassName>.sample(uv)` samples another pass's latest frame — including the *same* pass, which is how you build a feedback/accumulation effect.
- A self-sample is automatically recognized as a feedback buffer (ping-pong double-buffered), not a compile-time cycle error — a real cross-pass cycle (A samples B, B samples A, same frame) still is one, and is caught before any WebGL context is even created.
- `createPipeline`'s dependency ordering is derived from each pass's actual compiled uniforms, not a separate static analysis pass — the two can never drift out of sync with each other.

See `docs/architecture/multi-pass.md` for the full design, including the real `texImage2D` internal-format/pixel-type bug found and fixed while building the floating-point-buffer support.
