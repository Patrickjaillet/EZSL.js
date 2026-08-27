# Tutorial: Compositing an EZSL shader with Canvas2D drawing

This tutorial builds a real, running composite scene — an animated EZSL gradient shader with text drawn on top of it, both rendered onto the *same* 2D canvas — using `mountToCanvas2D`. It walks through the exact code in `examples/canvas2d-interop/`, confirmed working (a real `readPixels`/`putImageData`/`onFrame` cycle, not just "compiles") across Chromium, Firefox, and WebKit on every `npm run test:integration` run, and separately confirmed in a real Chromium browser with two screenshots ~1.5 seconds apart showing the animation actually advancing.

For the full design (why this is called a "fallback" in the roadmap's own wording despite not actually being one, the `gl.readPixels` row-flip bug found while building it, the `fps`/`once` throttling), see `docs/architecture/canvas2d-interop.md`. This tutorial is task-oriented.

## An important clarification before you start

`mountToCanvas2D` does **not** run EZSL shaders without WebGL2. That's impossible — an EZSL fragment program is GLSL ES 3.00, and there's no way to execute GLSL without a real GPU shader pipeline, full stop. What `mountToCanvas2D` actually does: render the shader in a real, invisible, offscreen WebGL2 context (exactly like `mount()` does, just not attached to the DOM), then copy the rendered pixels into a visible 2D `<canvas>` via `gl.readPixels` + `CanvasRenderingContext2D.putImageData`. The real use case this unlocks is **compositing** — putting shader output on the *same* 2D canvas as ordinary Canvas2D drawing (`fillText`, `drawImage`, arbitrary shapes) — something `mount()`'s direct-to-WebGL-canvas rendering structurally cannot do, since a WebGL canvas and a 2D canvas are different context types that can't coexist on one `<canvas>` element.

## What you'll build

An animated gradient shader (the same one from the `gradient` example) rendered as the background, with a text label ("EZSL + Canvas2D") drawn on top of it every frame, using ordinary `CanvasRenderingContext2D` calls — proving the shader and the 2D drawing genuinely share one scene, not two overlaid elements.

## Prerequisites

- `npm install` at the repository root. No new packages — `mountToCanvas2D` is core `ezsl` functionality (`src/runtime/bootstrap.ts`).

## Step 1: an ordinary EZSL fragment shader — nothing new here

```ezsl
color = [uv.x, uv.y, 0.5 + 0.5 * sin(time)]
```

This is `shader.ezsl` — a plain, single-pass fragment program, compiled exactly the same way (`compileEzsl`) whether you mount it with `mount()` or `mountToCanvas2D()`. Nothing about the shader itself needs to know or care which one will render it.

## Step 2: `mountToCanvas2D` instead of `mount`

```typescript
import { compileEzsl, mountToCanvas2D } from "@patrickjaillet/ezsl"; // or "../../src/index.js" inside this repo
import shaderSource from "./shader.ezsl?raw";

const canvas = document.getElementById("canvas") as HTMLCanvasElement;
canvas.width = 400;
canvas.height = 300;

const program = compileEzsl(shaderSource);
const ctx2d = canvas.getContext("2d")!;

mountToCanvas2D(canvas, program, {
  fps: 24,
  onFrame() {
    ctx2d.font = "bold 28px sans-serif";
    ctx2d.fillStyle = "white";
    ctx2d.strokeStyle = "black";
    ctx2d.lineWidth = 3;
    ctx2d.textAlign = "center";
    ctx2d.strokeText("EZSL + Canvas2D", canvas.width / 2, 40);
    ctx2d.fillText("EZSL + Canvas2D", canvas.width / 2, 40);
  },
});
```

Compare this to how `mount()` is called elsewhere in `examples/` — `compileEzsl` is identical, but instead of `mount(canvas, program)`, you call `mountToCanvas2D(canvas, program, options)`, on the **same** `<canvas>` element you already have a `2d` context on. Under the hood, `mountToCanvas2D` creates its own separate, offscreen `<canvas>` (never attached to the DOM) to actually run the WebGL2 shader — your visible `canvas` never becomes a WebGL canvas at all; it stays a plain 2D canvas the whole time.

## Step 3: `onFrame` — where the actual compositing happens

`onFrame` is called after each shader frame has already been copied onto your canvas (via `putImageData`) but before the browser paints — the exact moment to layer ordinary `CanvasRenderingContext2D` drawing on top, using the *same* `ctx2d` you already had. This is the entire point of `mountToCanvas2D` over `mount()`: without it, drawing text over a WebGL canvas would require a second, absolutely-positioned `<canvas>` overlay element and manual DOM/CSS layering — here, it's just two calls into the same 2D context, one from the shader (via `putImageData`), one from you (via `fillText`), in the same synchronous tick.

## Step 4: `fps` — why it's lower than a typical 60fps loop

```typescript
mountToCanvas2D(canvas, program, {
  fps: 24,
  // ...
});
```

`gl.readPixels` (what copies the rendered shader frame back from the GPU into a buffer `putImageData` can use) is a synchronous GPU→CPU transfer — meaningfully more expensive than an ordinary `gl.drawArrays` call that just leaves pixels in the framebuffer for the browser's own compositor to display directly (which is all `mount()` needs to do). Running that readback on every single `requestAnimationFrame` tick (60fps) for a purely cosmetic composited overlay is often wasteful, so `MountToCanvas2DOptions.fps` throttles the readback loop via `setInterval` instead — the default is `30`; this tutorial uses `24` to match the real example. Pass `fps: Infinity` to opt back into an uncapped `requestAnimationFrame` loop if you do need it (e.g. for a genuinely high-motion composited animation), or `once: true` to render and copy exactly one frame and stop — useful for exporting a single static snapshot rather than running a loop at all.

## Run it

```bash
npm run example:canvas2d-interop
```

Open the printed URL — you'll see the animated gradient (correctly oriented, not vertically flipped — a real row-order bug between `gl.readPixels`' bottom-to-top convention and `ImageData`'s top-to-bottom convention was found and fixed while this module was built; see `docs/architecture/canvas2d-interop.md`) with the "EZSL + Canvas2D" label crisply overlaid, both visibly animating (the gradient's color shift) and staying in sync every frame.

## What you've learned

- `mountToCanvas2D` still requires a real WebGL2 context — it renders to an invisible offscreen canvas, then copies pixels into your visible 2D canvas; it doesn't make EZSL shaders work in a WebGL2-less environment (nothing can).
- The real use case is compositing: shader output plus ordinary Canvas2D drawing (`fillText`, `drawImage`, shapes) sharing one scene, which `mount()`'s direct WebGL canvas can't do.
- `onFrame` fires right after each shader frame lands via `putImageData` — the place to layer your own 2D drawing calls.
- `fps` (default 30) throttles the relatively expensive `readPixels` readback; `Infinity` uncaps it, `once: true` renders a single static frame.

See `docs/architecture/canvas2d-interop.md` for the full design, including the shared `setupWebglRenderer` helper `mount()` and `mountToCanvas2D()` both use (so `mount()`'s own behavior can never silently drift from this module's changes), and what this milestone deliberately doesn't implement (automatic canvas-resize handling, alpha-compositing tricks beyond ordinary RGBA).
