# Tutorial: A Babylon.js scene with an EZSL material

This tutorial builds a real, running Babylon.js scene — a sphere with an animated vertex displacement and a color gradient — using EZSL to author both the vertex and fragment shaders. It walks through the exact code in `examples/babylon-integration/`, which is compiled and linked in a real WebGL2 context on every `npm run test:integration` run (Chromium, Firefox, WebKit, and Edge), so everything here is running, tested code — not illustrative pseudocode.

For the full design rationale behind this integration (why Babylon's API needed real, structural adaptations beyond the Three.js integration, two real bugs found while building it), see `docs/architecture/babylon-integration.md`. This tutorial is task-oriented — it shows you how to build the scene — while that doc explains why the integration works the way it does. If you've already read `docs/tutorials/three-js-scene.md`, several steps below call out exactly where Babylon's real API diverges from Three's.

## What you'll build

A Babylon.js sphere whose surface visibly ripples (a sine-wave vertex displacement driven by time, its amplitude modulated by distance from the camera) and is shaded with an animated gradient — both written in EZSL, both compiling to real GLSL ES 3.00 that Babylon links directly.

## Prerequisites

- `npm install` at the repository root (this pulls in `@babylonjs/core` as a dev dependency, already used by `examples/babylon-integration/`).
- Basic familiarity with Babylon.js's own API (`Scene`, `Engine`, `ArcRotateCamera`, `Mesh`) — this tutorial doesn't re-teach Babylon.js itself.

## Step 1: two `.ezsl` files, not one

Same pattern as the Three.js integration (and the v0.5 multi-pass milestone before it) — a Babylon material needs **two** separate programs, a vertex shader and a fragment shader, each an ordinary, complete `.ezsl` file.

Create `vertex.ezsl`:

```ezsl
camDist = length(cameraPosition)
amplitude = 0.05 + 0.05 * (camDist - 3.0)
wave = sin(position.x * 4.0 + time * 2.0) * amplitude
displaced = position + normal * wave
glPosition = worldViewProjection * vec4(displaced, 1.0)
```

Babylon's vertex-stage builtin scope is genuinely different from Three's, not just renamed — confirmed against `@babylonjs/core`'s real source, not assumed:

- **`position`/`normal`/`uv`** are auto-injected `vec3`/`vec3`/`vec2` attributes — Babylon's own per-vertex mesh data, put in scope automatically by EZSL's vertex-stage compiler.
- **`worldViewProjection`** is Babylon's own combined transform uniform — notice there's no separate multiply the way Three's integration needs (`projectionMatrix * modelViewMatrix`); Babylon supplies the whole product directly. Other real Babylon uniforms available the same way: `world`, `worldView`, `view`, `projection`, `viewProjection`, and `cameraPosition` (a world-space `vec3` — used above to modulate the wave's amplitude by how far the camera is from the mesh, a real Babylon-specific capability with no Three.js equivalent in that integration).
- **The required output is still `glPosition`, not `color`** — same rule as the Three.js integration.

Create `fragment.ezsl`:

```ezsl
pulse = 0.5 + 0.5 * sin(time * 1.5)
color = [uv.x, uv.y, pulse]
```

An ordinary fragment-stage EZSL program — identical shape to any single-pass example, or to the Three.js integration's own fragment stage.

## Step 2: `createBabylonMaterial`

```typescript
import * as BABYLON from "@babylonjs/core";
import { createBabylonMaterial } from "@patrickjaillet/ezsl"; // or "../../src/index.js" inside this repo
import vertexSource from "./vertex.ezsl?raw";
import fragmentSource from "./fragment.ezsl?raw";

const { material, setUniform } = createBabylonMaterial(BABYLON.ShaderMaterial, {
  name: "ezsl-babylon-material",
  scene,
  vertexSource,
  fragmentSource,
});
```

Two details that differ from the Three.js integration's equivalent step:

- **No "raw" material choice to make.** Babylon has only one `ShaderMaterial` class — unlike Three.js, there's no `RawShaderMaterial`-vs-`ShaderMaterial` decision, and no `glslVersion`-style flag to pass. `createBabylonMaterial` handles Babylon's own shader-processing quirks internally (see `docs/architecture/babylon-integration.md` for the real compile error this required fixing).
- **`name` and `scene` are required options.** Babylon's real `ShaderMaterial` constructor is `new BABYLON.ShaderMaterial(name, scene, shaderPath, options)` — a different shape from Three's single-options-object constructor — so `createBabylonMaterial` needs both up front, not just the shader sources.

`setUniform` works the same way conceptually as Three's — it's the handle you use every frame to update `time`/`resolution` (Step 4) — but dispatches internally to Babylon's own typed setter methods (`setFloat`, `setVector2`, etc.) rather than mutating a `.value` property, since that's what Babylon's real API actually expects.

## Step 3: build the scene

```typescript
const canvas = document.getElementById("canvas") as HTMLCanvasElement;
const engine = new BABYLON.Engine(canvas, true);
const scene = new BABYLON.Scene(engine);

const camera = new BABYLON.ArcRotateCamera("camera", Math.PI / 3, Math.PI / 3, 3, BABYLON.Vector3.Zero(), scene);
camera.attachControl(canvas, true);

const sphere = BABYLON.MeshBuilder.CreateSphere("sphere", { diameter: 1.5, segments: 32 }, scene);
sphere.material = material;
```

Nothing here is EZSL-specific — this is ordinary Babylon.js scene setup, assigning `material` (the object `createBabylonMaterial` returned) exactly like any other Babylon material. Note `scene` must exist before calling `createBabylonMaterial` in Step 2 (Babylon's constructor takes it directly), unlike Three's integration where the material can be created independently of any scene.

## Step 4: the render loop, and a real gotcha with `setUniform("resolution", ...)`

```typescript
function resize() {
  engine.resize();
  setUniform("resolution", { x: canvas.clientWidth, y: canvas.clientHeight });
}
window.addEventListener("resize", resize);
resize();

const startTime = performance.now();
scene.registerBeforeRender(() => {
  const elapsed = (performance.now() - startTime) / 1000;
  setUniform("time", elapsed);
});

engine.runRenderLoop(() => {
  scene.render();
});
```

Two things worth calling out explicitly, both found the hard way while building this integration (see `docs/architecture/babylon-integration.md`'s "real bugs found" section for the full story):

- **`setUniform("resolution", ...)` needs a real `{x, y}`-shaped value, not a plain `[width, height]` array.** This is a genuine difference from the Three.js tutorial's equivalent line, which passes a plain array — that works there because Three's `setUniform` just assigns to `.value` with no shape checking. Babylon's `setVector2` expects an object with real `.x`/`.y` properties (or a `BABYLON.Vector2`); passing an array silently fails (no error thrown — `u_resolution` ends up `undefined`/garbage, and the fragment shader's `uv` computation breaks, rendering as solid black even though the shader compiled correctly). Get the shape right and this isn't a problem — but it's an easy mistake to carry over if you're porting code from the Three.js integration.
- **Babylon drives its render loop differently from Three.js.** `time` is updated inside `scene.registerBeforeRender(...)`, and rendering itself happens inside `engine.runRenderLoop(...)` calling `scene.render()` — not a single `requestAnimationFrame` loop calling both, the way Three's tutorial does it.

## Run it

From the repository root:

```bash
npm run example:babylon-integration
```

This starts a Vite dev server for `examples/babylon-integration/` — open the printed URL and you'll see the rippling, gradient-shaded sphere, orbit-controllable with the mouse (`camera.attachControl`).

## What you've learned

- A Babylon material needs two `.ezsl` files (vertex + fragment), compiled via `compileEzslVertex(source, {}, "babylon")`/`compileEzsl` internally and combined by `createBabylonMaterial`.
- Vertex-stage EZSL gets `position`/`normal`/`uv`/Babylon's own transform-matrix and `cameraPosition` uniforms auto-injected, and must assign `glPosition` (not `color`) — same output rule as the Three.js integration, different builtin names.
- Babylon has no `RawShaderMaterial`-equivalent choice to make, but does require `name`/`scene` up front and real `{x, y}`-shaped values for vector uniforms (not plain arrays, unlike Three's `setUniform`).
- `setUniform` on the returned handle drives the auto-injected `time`/`resolution` builtins from your own render loop, dispatching to the correct typed Babylon setter method automatically based on each uniform's EZSL-inferred type.

See `docs/architecture/babylon-integration.md` for the full design doc, including what this integration doesn't yet support (varyings between vertex and fragment stages, a `normalMatrix`-equivalent — confirmed absent from Babylon's own API — and multi-pass/texture uniforms).
