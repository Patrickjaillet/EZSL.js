# Tutorial: A Three.js scene with an EZSL material

This tutorial builds a real, running Three.js scene — a rotating icosahedron with an animated vertex displacement and a color gradient — using EZSL to author both the vertex and fragment shaders. It walks through the exact code in `examples/three-integration/`, which is compiled and linked in a real WebGL2 context on every `npm run test:integration` run (Chromium, Firefox, and WebKit), so everything here is running, tested code — not illustrative pseudocode.

For the full design rationale behind this integration (why `RawShaderMaterial` only, what `compileEzslVertex` changes about the builtin scope, real bugs found while building it), see `docs/architecture/three-integration.md`. This tutorial is task-oriented — it shows you how to build the scene — while that doc explains why the integration works the way it does.

## What you'll build

A Three.js `IcosahedronGeometry` mesh whose surface visibly ripples (a sine-wave vertex displacement driven by time) and is shaded with an animated gradient — both written in EZSL, both compiling to real GLSL ES 3.00 that Three.js links directly, with zero runtime translation layer between "what you wrote" and "what the GPU runs."

## Prerequisites

- `npm install` at the repository root (this pulls in `three` as a dev dependency, already used by `examples/three-integration/`).
- Basic familiarity with Three.js's own API (`Scene`, `Camera`, `WebGLRenderer`, `Mesh`) — this tutorial doesn't re-teach Three.js itself.

## Step 1: two `.ezsl` files, not one

Unlike every single-pass example in `examples/` (a single `shader.ezsl` compiled via `compileEzsl`/`mount()`), a Three.js material needs **two** separate programs — a vertex shader and a fragment shader — because Three.js's rendering pipeline runs both stages, and they have genuinely different jobs: the vertex shader positions each mesh vertex in clip space; the fragment shader colors each pixel. This mirrors how the v0.5 multi-pass milestone represents each pass as its own complete `.ezsl` file rather than inventing new EZSL syntax for it — see `docs/architecture/multi-pass.md`'s "why multiple files" reasoning, which applies here too.

Create `vertex.ezsl`:

```ezsl
wave = sin(position.x * 4.0 + time * 2.0) * 0.15
displaced = position + normal * wave
glPosition = projectionMatrix * modelViewMatrix * vec4(displaced, 1.0)
```

Three things are different here from every fragment-stage EZSL program you may have written:

- **`position` and `normal`** are auto-injected `vec3` attributes — Three.js supplies these for any `BufferGeometry` (every vertex's local-space position and surface normal), and EZSL's vertex-stage compiler (`compileEzslVertex`) puts them in scope automatically, the vertex-stage equivalent of `uv`/`time`/`resolution` for fragment shaders.
- **`projectionMatrix`/`modelViewMatrix`** are Three.js's own camera/model uniforms, also auto-injected under their real Three.js names (no `u_` prefix) — Three.js populates these itself every frame for any material; EZSL doesn't declare or manage them.
- **The required output is `glPosition`, not `color`.** A vertex shader has no fragment color to produce — its job is to say where the vertex ends up.

Create `fragment.ezsl`:

```ezsl
pulse = 0.5 + 0.5 * sin(time * 3.0)
color = [uv.x, uv.y, pulse]
```

This is an ordinary fragment-stage EZSL program — the same `uv`/`time`/`color` shape as any single-pass example.

## Step 2: `createThreeMaterial`

```typescript
import * as THREE from "three";
import { createThreeMaterial } from "@patrickjaillet/ezsl"; // or "../../src/index.js" inside this repo
import vertexSource from "./vertex.ezsl?raw";
import fragmentSource from "./fragment.ezsl?raw";

const { material, setUniform } = createThreeMaterial(THREE.RawShaderMaterial, {
  vertexSource,
  fragmentSource,
  materialOptions: { glslVersion: THREE.GLSL3 },
});
```

Two details matter here:

- **`THREE.RawShaderMaterial` is passed in as the first argument, not imported by `ezsl` itself.** `createThreeMaterial` takes your own material *constructor* (dependency injection) — `ezsl` has no hard dependency on the `three` package; you supply whichever `three` version your project already uses.
- **`RawShaderMaterial` specifically, not `ShaderMaterial`.** `ShaderMaterial` automatically injects its own GLSL boilerplate (attribute/uniform declarations, a `#version` line) into whatever shader source you give it — which collides with EZSL's own self-contained GLSL ES 3.00 output (duplicate declarations, or a `#version` line landing somewhere other than the true first line, which GLSL treats as a hard compile error). This isn't a guess — it was confirmed by an actual sequence of real Three.js compile failures while this integration was built; see `docs/architecture/three-integration.md`. `glslVersion: THREE.GLSL3` tells Three.js to expect (and not duplicate) the `#version 300 es` line EZSL's own codegen already emits.

`setUniform` is the handle you use every frame to update `time`/`resolution` — see Step 4.

## Step 3: build the scene

```typescript
const canvas = document.getElementById("canvas") as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(50, canvas.clientWidth / canvas.clientHeight, 0.1, 100);
camera.position.set(2, 1.5, 3);
camera.lookAt(0, 0, 0);

const geometry = new THREE.IcosahedronGeometry(1, 4);
const mesh = new THREE.Mesh(geometry, material);
scene.add(mesh);
```

Nothing here is EZSL-specific — this is ordinary Three.js scene setup, using `material` (the object `createThreeMaterial` returned) exactly like any other Three.js material.

## Step 4: the render loop, and why `setUniform("time", ...)` actually works

```typescript
const startTime = performance.now();
function frame() {
  const elapsed = (performance.now() - startTime) / 1000;
  setUniform("time", elapsed);
  mesh.rotation.y = elapsed * 0.4;
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
```

`setUniform("time", elapsed)` deserves a specific callout: `time` isn't a uniform *you* declared in either `.ezsl` file — it's one of EZSL's own auto-injected fragment builtins (like `uv`/`resolution`, always bound to `u_time` under the hood). A real bug was found while building this integration: `u_time`/`u_resolution` are compiler-injected, so they were never present in `program.uniforms` (the list `createThreeMaterial` normally derives its settable-uniform list from) — meaning `setUniform("time", ...)` always threw, despite this module's own intended usage pattern requiring exactly that call every frame. It's fixed now (both are seeded explicitly), which is why this line works as written — but it's worth knowing this wasn't always true, in case you're working against an older EZSL version.

## Step 5: handle resize

```typescript
function resize() {
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  setUniform("resolution", [width, height]);
}
window.addEventListener("resize", resize);
resize();
```

Same pattern as `time` — `resolution` is a fragment-stage auto-injected builtin, set the same way.

## Run it

From the repository root:

```bash
npm run example:three-integration
```

This starts a Vite dev server for `examples/three-integration/` — open the printed URL and you'll see the rippling, gradient-shaded icosahedron rotating in real time.

## What you've learned

- A Three.js material needs two `.ezsl` files (vertex + fragment), compiled via `compileEzslVertex`/`compileEzsl` respectively and combined by `createThreeMaterial`.
- Vertex-stage EZSL gets `position`/`normal`/Three.js's camera-matrix uniforms auto-injected, and must assign `glPosition` (not `color`).
- Only `THREE.RawShaderMaterial` works, with `glslVersion: THREE.GLSL3` — `ShaderMaterial` is incompatible with EZSL's self-contained output.
- `setUniform` on the returned handle is how you drive the auto-injected `time`/`resolution` builtins from your own render loop, exactly like any user-declared uniform.

See `docs/architecture/three-integration.md` for the full design doc, including what this integration doesn't yet support (varyings between vertex and fragment stages beyond the builtin scope, multiple materials sharing compiled functions).
