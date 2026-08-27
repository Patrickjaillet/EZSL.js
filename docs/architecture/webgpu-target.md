# EZSL.js — WebGPU Predictive Compilation Target (v0.6, part 3)

Internal design doc for the "WebGPU predictive compilation target (experimental, feature-flagged)" part of v0.6.x "Framework Integrations". Read `docs/architecture/transpiler-pipeline.md` first (v0.1 core pipeline). This doc covers the WGSL code generator, its UBO layout pass, and the capability matrix — the three roadmap sub-items — plus the one scope decision that shapes all of it: **this milestone is validated by unit tests only, never against a real `GPUDevice`.**

**Scope note**: the Three.js bridge is `docs/architecture/three-integration.md`; Canvas2D interop is `docs/architecture/canvas2d-interop.md`. This doc covers WebGPU/WGSL only.

## Why unit-tests-only (not real GPU validation)

Every prior v0.5/v0.6 milestone in this project was validated end-to-end: a real WebGL2 context, a real browser, screenshots, pixel comparisons. The same bar was attempted here first — a Playwright check for `navigator.gpu` in this project's headless Chromium confirmed WebGPU is **not available** in this environment (no `GPUAdapter` can be requested, so no `GPUDevice`, so no real shader-module compilation, no real pipeline, no real pixel output). There is no way to render a single real WebGPU frame here.

Given that constraint, the only two options were: defer this entire roadmap item, or build it validated by exhaustive unit tests on the *generated WGSL text's structure* only, with the limitation explicitly documented rather than glossed over. The roadmap itself already frames this item as "experimental, feature-flagged" — consistent with shipping something real but explicitly not production-validated. **This is the chosen scope.** Concretely: every function below has a full unit-test suite asserting the shape of its output (correct WGSL keywords, correct struct fields, correct offsets), but no test has ever compiled the output WGSL with a real `GPUDevice.createShaderModule`, and no visual output has ever been produced or compared. If a real GPU device becomes available in a future environment, the next step would be exactly that: compile the generated WGSL for real and catch anything a text-shape assertion can't (e.g. a WGSL keyword collision this design didn't anticipate).

This mirrors the project's established pattern of documenting validation gaps rather than hiding them — the same pattern used for the v0.4 non-ANGLE-driver gap (`docs/architecture/error-translation.md`) and the v0.5 missing-`EXT_color_buffer_float`-hardware gap (`docs/architecture/multi-pass.md`).

## Architecture: translate generated GLSL text, not a shared neutral IR

`ROADMAP.md`'s wording asks for a "WGSL code generator sharing the same AST as the GLSL generator." Taken strictly, that's already awkward: `compile()` (`src/compiler/compile.ts`) does not stop at a language-neutral IR — it emits GLSL text directly into `Program.body`/`Program.outColor`/`Program.topLevel` (see `src/codegen/types.ts`). There is no earlier IR checkpoint before GLSL-text exists.

Two ways to honor the spirit of "shared AST" were considered:

1. **Refactor `compile()` to emit a language-neutral IR**, with separate GLSL and WGSL text emitters consuming that IR. This is the "correct" architecture in the abstract, but `compile.ts` is 700+ lines and is the most heavily-tested, most load-bearing file in the project (every prior milestone's type inference, control flow, multi-pass sampling, and Three.js vertex support runs through it). Rewriting its emission target risked regressing the entire stable v0.1–v0.6 pipeline for an experimental, unvalidated (see above) feature.
2. **Translate the already-generated GLSL text to WGSL**, via a dedicated small module that knows the exact shapes `compile()`'s GLSL emission can produce (because that emission logic is fully known and stable) and rewrites just those shapes.

**Option 2 was chosen** (explicit user decision). The compiled `Program` — the same object `generateFragmentShaderMapped` consumes for GLSL — is the shared input; "shared AST" is satisfied at the *compiled-IR* level, not at the *text* level. This is a real architectural compromise, not a hidden one: it means the WGSL generator is only as correct as its GLSL-text-shape assumptions, and a future change to `compile.ts`'s GLSL emission could silently break WGSL translation without breaking any GLSL test. This risk is mitigated by `tests/generateWgsl.test.ts` compiling real `.ezsl` source through the real `compileEzsl()` (not hand-built `Program` fixtures) before translating — so any GLSL emission change that alters output shape will fail a WGSL test too, not go unnoticed.

## Module layout

- `src/codegen/wgsl/uboLayout.ts` — `wgslAlignmentFor(type)`, `layoutUniformBuffer(members)`
- `src/codegen/wgsl/translateGlslExpression.ts` — `translateGlslExpressionToWgsl(glsl)`, `translateGlslStatementToWgsl(glslLine)`
- `src/codegen/wgsl/generateWgsl.ts` — `generateWgslFragmentShader(program)`, the entry point

## The UBO alignment trap (the v0.6 roadmap callout)

WGSL's uniform-buffer layout rules are stricter than GLSL's default packing and are specified precisely (WGSL spec §"Memory Layout"), unlike GLSL where packing is implementation-defined absent `std140`/`std430` qualifiers. The trap `ROADMAP.md` calls out — "a `vec3` followed by a `float` ... must be re-ordered or padded automatically" — is real but its actual mechanics are subtler than "vec3 always needs padding after it," which is the `std140` intuition, not WGSL's rule:

| EZSL type | WGSL type | align | size |
|---|---|---|---|
| `float` | `f32` | 4 | 4 |
| `vec2` | `vec2<f32>` | 8 | 8 |
| `vec3` | `vec3<f32>` | **16** | **12** |
| `vec4` | `vec4<f32>` | 16 | 16 |
| `mat2` | `mat2x2<f32>` | 8 | 16 |
| `mat3` | `mat3x3<f32>` | 16 | 48 |
| `mat4` | `mat4x4<f32>` | 16 | 64 |

`vec3`'s align (16) exceeding its size (12) is the trap: a member is placed at the next offset that's a multiple of *its own* align, and the byte range `[offset, offset+size)` is claimed — nothing more. So `vec3` followed by `float`: the `float`'s align (4) already divides 12, so it lands at offset 12 with **no padding at all** — a naive "always pad after vec3 to a 16-byte boundary" implementation (correct for GLSL's `std140`, not WGSL) would insert 4 bytes of unnecessary padding here and silently shift every subsequent member's offset. `vec3` followed by `vec4`: `vec4`'s align (16) does *not* divide 12, so it's pushed to offset 16, leaving a real 4-byte gap. `layoutUniformBuffer` (`uboLayout.ts`) implements exactly this general rule — `offset = roundUpTo(cursor, member.align)` — rather than a `vec3`-specific special case, so it's correct for every type combination, not just the one the roadmap happened to name. Both cases (no padding needed vs. padding needed) are covered by dedicated contrasting tests in `tests/uboLayout.test.ts`, specifically because the "always pad after vec3" intuition is the easy mistake to make here.

Members are laid out in **declaration order**, never reordered for density — a deliberate choice so the generated WGSL `struct Uniforms { ... }` field order visually matches the `.ezsl` source's uniform declaration order, at the cost of potentially more padding than a density-optimal reordering would produce. `totalSize` is always rounded up to a multiple of 16 (WGSL's own struct-size rule for buffers). `sampler2D` has no uniform-buffer representation (`wgslAlignmentFor` returns `null`, `layoutUniformBuffer` throws if asked to lay one out) — sampler/texture bindings are separate WGSL bindings, not UBO members (see below).

Two builtin uniform-buffer members (`time: f32`, `resolution: vec2<f32>`) are always injected first, matching GLSL codegen's own `u_time`/`u_resolution` builtins (`docs/architecture/transpiler-pipeline.md`) — every generated WGSL program has at least these two members even if the `.ezsl` source references neither.

## GLSL-text → WGSL translation (`translateGlslExpression.ts`)

This is explicitly **not a GLSL parser** — it's targeted regex substitution, sound only because its input is always `compile.ts`'s own GLSL output, whose exact shapes are fully known and enumerated in the module's own comments, not arbitrary hand-written GLSL. Translations performed:

- **Type constructors**: GLSL's bare `vec3(...)`/`mat4(...)`/`float(x)` → WGSL's explicitly-typed `vec3<f32>(...)`/`mat4x4<f32>(...)`/`f32(x)`. WGSL has no implicit element type on constructors.
- **`texture()` → `textureSample()`**: GLSL ES 3.00's combined-sampler `texture(u_buffer_X, uv)` becomes WGSL's split-binding `textureSample(u_buffer_X, u_buffer_X_sampler, uv)` — WGSL has no combined sampler type; every `sampler2D` uniform becomes a `texture_2d<f32>` binding plus a paired `sampler` binding (see below), and this rewrite assumes exactly that `_sampler`-suffixed naming convention, which the WGSL binding emitter is responsible for actually declaring.
- **Local declarations**: GLSL's `float d = expr;` → WGSL's `var d: f32 = expr;` (WGSL requires the `var`/`let` keyword and a `: type` annotation rather than a bare type prefix). Only matches a first-assignment declaration shape — a bare re-assignment (`d = expr;`) has no type prefix in GLSL either and needs no structural change, only its RHS translated.
- **`mod(a, b)`**: WGSL has no `mod` builtin. Rewritten to `(a - b * floor(a / b))`, GLSL's own `mod` semantics (matches for all real inputs including negative `a`). This is the one confirmed real name/signature mismatch found among EZSL's builtin surface — `sin`, `cos`, `length`, `normalize`, `mix`, `clamp`, `abs`, `floor`, `pow`, `exp`, `cross`, `reflect`, `step`, `smoothstep`, `dot`, `sqrt`, `atan`, `tan`, `fract` are all identically named and ordered in WGSL and left untouched.
- **`for` loop headers**: handled separately, in `generateWgsl.ts`, not this module — GLSL's `for (int i = 0; i < 4; i++) {` becomes WGSL's `for (var i: i32 = 0; i < 4; i++) {`. This is its own regex rather than falling out of the general statement translator, since a `for` header isn't a `<type> <name> = <expr>;` declaration shape.
- **Left unchanged**: `if`/`else` headers and closing braces (already valid WGSL as GLSL emits them), swizzles, arithmetic, plain identifiers.

## `generateWgslFragmentShader(program)` — the entry point

Given a compiled `Program` (the same object `generateFragmentShaderMapped` takes for GLSL output), produces:

```wgsl
struct Uniforms {
  time: f32,
  resolution: vec2<f32>,
  u_speed: f32,
  // ... one field per non-sampler uniform, in uboLayout.members order
};
@group(0) @binding(0) var<uniform> u: Uniforms;
@group(0) @binding(1) var u_buffer_BufferA: texture_2d<f32>;
@group(0) @binding(2) var u_buffer_BufferA_sampler: sampler;
// ... one texture_2d + sampler pair per sampler2D uniform

@fragment
fn main(@builtin(position) fragCoord: vec4<f32>) -> @location(0) vec4<f32> {
  var uv: vec2<f32> = fragCoord.xy / u.resolution;
  uv.y = 1.0 - uv.y;
  let time: f32 = u.time;
  let resolution: vec2<f32> = u.resolution;
  // ... translated program.body lines
  return /* translated program.outColor */;
}
```

The `uv.y = 1.0 - uv.y;` line mirrors GLSL codegen's own Y-flip (`docs/architecture/transpiler-pipeline.md`'s bottom-left-origin trap) — kept identical so a shader's visual output would match between targets if it were ever rendered on both. `program.topLevel` (struct declarations, `defineFunction`/Escape Hatch `glsl { ... }` raw text) is emitted **untranslated, verbatim**, and flagged in the result's `unsupportedFeatures` array — see the capability matrix below for why.

Returns `{ source, uboLayout, unsupportedFeatures }` — `uboLayout` is exposed so a future WebGPU runtime could use it to size and populate an actual `GPUBuffer` without re-deriving the layout; `unsupportedFeatures` is a plain string array (not a hard error) so a caller can inspect and decide, since this is explicitly a best-effort experimental target, not a strict compiler that refuses partial input.

## Capability matrix: GLSL-only vs. dual-target

| EZSL feature | GLSL (WebGL2) | WGSL (this module) |
|---|---|---|
| Scalar/vector/matrix expressions, arithmetic, swizzles | ✅ | ✅ translated |
| `time`, `resolution`, `uv` builtins | ✅ | ✅ translated (same Y-flip semantics) |
| User uniforms (`float`/`vec2`/`vec3`/`vec4`/`mat2`/`mat3`/`mat4`) | ✅ | ✅ translated, laid out via `layoutUniformBuffer` |
| `if`/`else` | ✅ | ✅ (already valid WGSL syntax, passthrough) |
| `for i in a..b` loops | ✅ | ✅ translated (dedicated header rewrite) |
| Buffer sampling (`BufferName.sample(uv)`) | ✅ | ✅ translated to split `texture_2d`+`sampler` bindings |
| Builtin functions (`sin`, `length`, `mix`, `clamp`, etc.) | ✅ | ✅ (identical names/signatures in WGSL, passthrough) |
| `mod(a, b)` | ✅ | ✅ translated to an equivalent expression (no WGSL builtin) |
| `struct` declarations | ✅ | ⚠️ emitted verbatim as GLSL text — **not translated**, flagged via `unsupportedFeatures` |
| `defineFunction` (custom GLSL function injection) | ✅ | ⚠️ emitted verbatim as GLSL text — **not translated** |
| Escape Hatch `glsl { ... }` raw blocks | ✅ | ⚠️ emitted verbatim as GLSL text — **not translated**, and may not even be valid WGSL syntax at all (it's raw author-supplied GLSL, unconstrained) |
| Three.js vertex/fragment dual-shader authoring | ✅ | ❌ not attempted — WGSL vertex stage generation doesn't exist |
| Multi-pass pipeline (`createPipeline`) runtime wiring | ✅ | ❌ `generateWgslFragmentShader` produces text only; no WebGPU runtime (`GPUDevice`/pipeline/bind-group creation) exists to actually run it |
| Real `GPUDevice` compilation/execution | N/A | ❌ never attempted in this environment — see "Why unit-tests-only" above |

The three `topLevel`-sourced features (struct, `defineFunction`, Escape Hatch) share one root cause: they're either raw GLSL text the author wrote directly, or GLSL text `compile.ts` emits without going through the same expression/statement paths the translator understands (see `translateGlslExpression.ts`'s own comments on why it only handles known shapes). Translating them would require either a real GLSL parser or hand-writing WGSL equivalents for arbitrary user GLSL — both out of scope for an experimental milestone. A program using any of these still produces WGSL output (nothing throws), but that output is not guaranteed valid WGSL; `unsupportedFeatures` exists precisely to surface this rather than silently claim full support.

## What this milestone does not implement

- **No WebGPU runtime.** No `GPUDevice`/`GPUAdapter` acquisition, no `GPUShaderModule`/`GPURenderPipeline`/`GPUBindGroup` creation, no `mount()`-equivalent for WebGPU. This module produces WGSL **source text** and a **layout description** only — the same relationship `generateFragmentShaderMapped` has to GLSL, minus the runtime (`bootstrap.ts`) half that exists for GLSL.
- **No real-GPU validation.** See "Why unit-tests-only" above.
- **No vertex-stage WGSL.** Only `generateWgslFragmentShader` (fragment) exists; the Three.js vertex-shader work (`docs/architecture/three-integration.md`) has no WGSL counterpart.
- **Not exposed as a feature flag at runtime** — there is no runtime to flag. The "feature-flagged" part of the roadmap's own framing will apply once a WebGPU runtime exists to gate.
- **Not wired into `mount()`, `createPipeline()`, or `createThreeMaterial()`.**

## Tests

- `tests/uboLayout.test.ts` (19 cases) — every `EzslType`'s alignment/size row, `sampler2D` rejection, declaration-order preservation, `totalSize % 16 === 0`, and the padding-vs-no-padding contrast pair described above.
- `tests/translateGlslExpression.test.ts` (14 cases) — every constructor type, `texture()`→`textureSample()`, `mod()` rewrite, unchanged-builtin passthrough, local declaration translation (scalar and vector), indentation preservation, control-flow passthrough.
- `tests/generateWgsl.test.ts` (14 cases) — end-to-end through real `compileEzsl()` output: struct/binding declaration shape, builtin uniform injection, user uniform inclusion and UBO member ordering, constructor/declaration/`for`/`if`/`mod()` translation in a real compiled body, sampler binding pair + `texture()` rewrite via `bufferNames`, `unsupportedFeatures` flagging for a `struct`-containing program and its absence otherwise, uv Y-flip parity with GLSL codegen.

All 47 new tests pass. No existing test, file, or runtime code path was modified to build this milestone — `uboLayout.ts`, `translateGlslExpression.ts`, and `generateWgsl.ts` are purely additive new modules under `src/codegen/wgsl/`.
