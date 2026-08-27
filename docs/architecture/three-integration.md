# EZSL.js — Three.js Integration (v0.6, part 1)

Internal design doc for the "Three.js integration module" part of v0.6.x "Framework Integrations". Read `docs/architecture/transpiler-pipeline.md` (v0.1 core) first — this doc covers what's genuinely new: a second compiled shader *stage* (vertex), which nothing before v0.6 needed.

**Scope note:** this doc covers the Three.js bridge only. The other two v0.6 items — Canvas2D fallback/interop and the experimental WebGPU target — are separate, larger pieces of work and are not covered here; see `ROADMAP.md` for their status.

## Why vertex authoring needed a real design decision

Every EZSL program before v0.6 compiled to exactly one thing: a fullscreen-quad fragment shader (`docs/architecture/transpiler-pipeline.md` Stage 5). Three.js integration fundamentally can't work that way — a `THREE.Mesh` has real 3D geometry, and without vertex-stage control there's no way to place, deform, or skin it; a fragment-only bridge would only cover post-processing-style full-screen effects, which Three.js already has other tools for. So this milestone had to add authoring for a second shader stage, not just a JS-side bridge around the existing one.

**Two files, not new syntax.** Consistent with the v0.5 multi-pass precedent (`docs/architecture/multi-pass.md`) of "each render unit is its own ordinary `.ezsl` file, wired together by a JS orchestrator" rather than inventing in-language block syntax: a vertex program and a fragment program are two separate `.ezsl` source strings, compiled by two separate functions (`compileEzsl` for fragment, the new `compileEzslVertex` for vertex) and combined by a new JS function, `createThreeMaterial`. Neither EZSL's grammar nor its parser changed at all for this — see `docs/architecture/ezsl-grammar.ebnf.md`, unmodified by this milestone.

## `compileEzslVertex` and the `stage` option

`compile()` (`src/compiler/compile.ts`) gained two new, `internal`-flavored `CompileOptions` fields: `stage: "fragment" | "vertex"` (default `"fragment"`, so every pre-v0.6 call site is unaffected) and `outputName` (default `"color"`). Vertex compilation is `compile()` called with `stage: "vertex"`, `outputName: "glPosition"` — same expression-compilation engine (`emitInScope`, all the type-inference rules from `docs/architecture/type-system.md`), just a different builtin scope and required output name. `compileEzslVertex` (`src/compiler/index.ts`) is a thin public wrapper that sets those two options and remaps the result from the (fragment-shaped) codegen `Program` into a new, separate `VertexProgram` type (`src/codegen/types.ts`) — `{ uniforms, body, outPosition }`, no `topLevel` (vertex-stage `fn`/`defineFunction`/structs aren't exercised by this milestone, though nothing in principle blocks adding them later the same way fragment got them in v0.2/v0.3).

**Why two result types instead of one shared shape**: a fragment `Program` and a vertex `VertexProgram` would need most fields to be conditionally meaningful ("`outColor` if fragment, `outPosition` if vertex", "`topLevel` only sometimes populated") — two small concrete types are clearer than one type whose shape depends on a runtime tag. `stage`/`outputName` stay internal to `CompileOptions` (not meant for direct external use) specifically because external callers need the *type-safe* result remapping `compileEzslVertex` does, not just the raw compile-time behavior change.

### Vertex builtin scope

```
position         vec3   — per-vertex attribute, always supplied for any THREE.BufferGeometry
normal           vec3   — per-vertex attribute, ditto
modelMatrix      mat4   — Three.js's own uniform, real name, no u_ prefix
modelViewMatrix  mat4   — ditto
projectionMatrix mat4   — ditto
normalMatrix     mat3   — ditto
```

(`VERTEX_BUILTIN_SCOPE` in `src/compiler/typeInference.ts`, parallel to `FRAGMENT_BUILTIN_SCOPE`'s `uv`/`time`/`resolution`.) The four matrices are auto-mapped under their *actual* Three.js names, not EZSL-uniform-style `u_`-prefixed ones — they aren't EZSL-declared uniforms the compiler invents; they're uniforms Three.js itself populates every frame for any `ShaderMaterial`/`RawShaderMaterial`, exactly as hand-written Three.js GLSL would reference them. Any other free identifier (e.g. `amplitude` in a displacement shader) still becomes an implicit EZSL `u_`-prefixed uniform exactly as in fragment source — that inference rule is stage-agnostic.

### A real type-inference bug this exposed: `matN * vecN`

Writing the first real vertex example (`projectionMatrix * modelViewMatrix * vec4(position, 1.0)`) immediately hit a latent bug in `BinaryExpression`'s result-type rule, present since v0.3's `mat2/3/4` addition but never triggered by any earlier example: the old rule computed `resultType = leftType === "float" ? rightType : leftType` — which for `mat4 * vec4` returns `mat4` (the *left* operand's type), when GLSL's actual rule is "a matrix transforming a vector yields a vector" (`vec4`), regardless of operand order. This silently mistyped the vertex position expression as a `mat4`, which would have gone on to either fail confusingly downstream or (worse) silently wrap the already-correct `vec4` output in another `vec4(..., 1.0)` coercion. Fixed by special-casing `matN * vecN` (but not `vecN * matN`, where the old "left wins" rule was already correct — GLSL agrees `vecN * matN -> vecN`) before falling through to the general "left wins" default. Regression-tested in `tests/vertexCompile.test.ts` and `tests/typeInference.test.ts`.

## Codegen: `generateThreeVertexShaderMapped`

A new function in `src/codegen/glslGenerator.ts`, parallel to `generateFragmentShaderMapped` but for `VertexProgram`: declares `in vec3 position;`/`in vec3 normal;`, then only the Three.js matrix uniforms actually *referenced* in the compiled GLSL (found by regex-scanning the generated body/output text, since `program.uniforms` only ever holds EZSL-declared user uniforms — Three.js builtins never appear there by design, see above), then user uniforms, then the `main()` body ending in `gl_Position = <outPosition>;`.

### The `includeVersionDirective` fix (found via real browser validation, not by inspection)

Both `generateFragmentShaderMapped` and `generateThreeVertexShaderMapped` gained a second parameter, `includeVersionDirective` (default `true`, so every existing call site is unaffected). This exists because of a genuine, non-obvious Three.js integration hazard, found by actually running the integration in a browser rather than by reading Three.js's docs:

1. `THREE.ShaderMaterial` injects its own attribute/uniform declarations and shader chunks *before* the given source — this duplicates EZSL's own `position`/`normal`/matrix declarations (a hard "redefinition" GLSL error) and, worse, pushes EZSL's `#version 300 es` line out of the mandatory first position (`#version` must be the literal first thing in the file, only preceded by whitespace/comments — a hard error otherwise). **Fix: use `THREE.RawShaderMaterial` instead**, which injects nothing.
2. Even `RawShaderMaterial` prepends two `#define` lines (`SHADER_TYPE`, `SHADER_NAME`) *unless* `glslVersion: THREE.GLSL3` is passed in the material's constructor options — without it, GLSL ES 1.00 is assumed and EZSL's ES 3.00 syntax (`in`/`out` qualifiers, `texture()` instead of `texture2D()`) fails outright.
3. **Even with `glslVersion: THREE.GLSL3`**, Three.js supplies its *own* `#version 300 es` as the true first line — so EZSL's generator must not also emit one, or the *second* `#version` line (anywhere but literal line 1) is itself the hard error. This is what `includeVersionDirective: false` is for.

All three of these were caught in sequence by actually compiling and linking a real `THREE.RawShaderMaterial` in a real browser (Chromium via Playwright) while building `examples/three-integration/`, not by reading Three.js source or documentation speculatively — each fix was driven by an actual driver error message, and each one only revealed the next problem once the prior one was fixed. `src/integrations/three.ts`'s `createThreeMaterial` bakes in fixes #3 (calls both generators with `includeVersionDirective: false`) and documents #1/#2 as required caller-side setup (`THREE.RawShaderMaterial` + `materialOptions: { glslVersion: THREE.GLSL3 }`) in its own doc comment, since those two are choices only the caller (which constructor to use) or Three.js itself (nothing EZSL's codegen can compensate for) can make.

## `createThreeMaterial` (`src/integrations/three.ts`)

```ts
const { material, setUniform } = createThreeMaterial(THREE.RawShaderMaterial, {
  vertexSource, fragmentSource,
  materialOptions: { glslVersion: THREE.GLSL3 },
});
```

No dependency on the `three` package: `MaterialCtor` is the caller's own `THREE.RawShaderMaterial` class, passed in, not imported by `ezsl` itself — `ThreeShaderMaterialLike`/`ThreeShaderMaterialConstructor` are small structural interfaces covering only the slice of Three.js's actual API surface this module touches (`{ uniforms }` on the instance; a constructor taking `{ vertexShader, fragmentShader, uniforms, ...anything else }`). A real `THREE.ShaderMaterial`/`RawShaderMaterial` satisfies these structurally with no cast needed on the caller's side.

### The `u_time`/`u_resolution` registration gap (a second real bug, caught by tests before it ever reached a browser)

`Program.uniforms` (the fragment codegen IR) only ever contains *EZSL-declared* user uniforms — `time`/`resolution` are compiler-injected builtins (see `docs/architecture/transpiler-pipeline.md`), so they never appear in that list. An early version of `createThreeMaterial` built its Three.js `uniforms` object and its EZSL-name-to-GLSL-name lookup map purely by iterating `program.uniforms` — which meant `setUniform("time", elapsedSeconds)` (exactly the call this module's own doc comment tells callers to make every frame, since Three.js has no equivalent of EZSL's own `mount()` `requestAnimationFrame` loop to hook into automatically) would always throw "not a uniform declared in either stage," because `u_time` was never registered at all. Fixed by explicitly seeding `u_time`/`u_resolution` into both the uniforms object and the name-lookup map before the EZSL-uniforms loop runs. Caught by `tests/threeIntegration.test.ts` (`"setUniform('time', ...) actually updates u_time on the material"`) before it was ever run against a real browser — a case where the unit test suite, not the browser-validation step, found the bug.

## What this milestone deliberately doesn't implement

- **Varyings / inter-stage data passing.** A vertex program and its paired fragment program are compiled completely independently — there's no EZSL mechanism to compute something in the vertex shader (e.g. a world-space normal, for lighting) and pass it to the fragment shader as an interpolated varying. `examples/three-integration/`'s fragment shader deliberately only uses `uv` (from `gl_FragCoord`, unrelated to the mesh's actual UV/vertex data) rather than pretending to consume vertex output it can't actually receive — this is a real, current limitation, not just an unexercised example. Adding varyings would need real EZSL grammar/semantics work (a way to declare and reference a named inter-stage value) and is a natural v0.6-or-later follow-up, not attempted here.
- **Vertex-stage `fn`/`defineFunction`/structs/arrays.** `VertexProgram` has no `topLevel` field; nothing currently prevents `compile()` from producing one for vertex the same way it does for fragment, but the plumbing (`compileEzslVertex`'s result remapping, `generateThreeVertexShaderMapped`) doesn't thread it through yet, and no example exercises it.
- **Auto-mapping beyond the four listed matrices.** Three.js's full built-in uniform set is much larger (e.g. `cameraPosition`, various lighting uniforms depending on material features) — only the four most fundamental transform matrices are wired up. Extending `VERTEX_BUILTIN_SCOPE` with more names is mechanical if/when a real use case needs them.
- **`THREE.ShaderMaterial` support.** Deliberately unsupported, not just untested — see the `includeVersionDirective`/`RawShaderMaterial` section above; `ShaderMaterial`'s automatic boilerplate injection is fundamentally incompatible with EZSL's fully-self-contained GLSL ES 3.00 output.

## Validated example

`examples/three-integration/` (`vertex.ezsl` + `fragment.ezsl`, wired together via `createThreeMaterial(THREE.RawShaderMaterial, ...)`) displaces an icosahedron's vertices along their normals with a `sin(position.x * 4.0 + time * 2.0)` wave, and colors it with an animated fragment gradient. Confirmed in a real Chromium browser (via Playwright), across two screenshots ~1 second apart: the mesh renders as a visibly non-spherical, rippled shape (proof the vertex displacement is actually running, not just compiling) with clearly different coloring between the two captures (proof `setUniform("time", ...)` is actually reaching the shader every frame) and a visible rotation between frames (proof the render loop itself is running). Run with `npm run example:three-integration`.
