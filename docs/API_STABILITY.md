# EZSL.js — API Stability Policy (v1.0.x)

This document is the v1.0.x "Freeze public API surface (documented breaking-change policy from this point forward)" and "Deprecation policy defined" roadmap deliverables. It defines exactly what's covered by EZSL.js's backward-compatibility guarantee starting at `v1.0.0`, what isn't, and what happens when something covered needs to change.

## What's covered: `src/index.ts`, and nothing else

**The stability guarantee covers every name exported from the package root (`import { ... } from "@patrickjaillet/ezsl"`, i.e. `src/index.ts`) as of `v1.0.0`.** Nothing else — not internal module paths (`ezsl/dist/compiler/compile.js`, `ezsl/dist/runtime/bootstrap.js`, etc.), not any file under `src/` or `dist/` that `src/index.ts` doesn't re-export, and not undocumented behavior of an exported function beyond what its own doc comment and the `docs/architecture/*.md` design docs actually promise. Reaching into an internal module path directly, or relying on behavior not documented anywhere, is unsupported and can change in any release, including a patch release.

This is a deliberate, narrow scope — see "Removed from the public surface before v1.0" below for two real internal-implementation-detail exports that leaked into `src/index.ts` and were removed specifically so this freeze wouldn't have to cover them.

### The frozen surface, by module

- **Codegen** (`src/codegen/glslGenerator.ts`, `src/codegen/types.ts`): `generateFragmentShader`, `generateFragmentShaderMapped`, `generateVertexShader`, `generateThreeVertexShaderMapped`, `generateBabylonVertexShaderMapped`; types `SourceMap`, `GeneratedFragmentShader`, `GeneratedHostVertexShader`, `Program`, `VertexProgram`, `Uniform`, `Expr`, `EzslType`, `FunctionSignature`, `SourceMappedLine`.
- **Runtime** (`src/runtime/bootstrap.ts`, `src/runtime/pipeline.ts`): `mount`, `mountToCanvas2D`, `createPipeline`, `PipelineError`; types `EzslRuntimeHandle`, `MountOptions`, `Canvas2DHandle`, `MountToCanvas2DOptions`, `PipelineOptions`, `PassSource`, `BufferFormat`, `EzslPipelineHandle`.
- **Compiler** (`src/compiler/index.ts`): `compileEzsl`, `compileEzslVertex`, `defineFunction`, `tokenize`, `parse`, `compile`, `LexError`, `ParseError`, `CompileError`, `collectVariableDeclarations`; types `CompileOptions`, `CustomFunction`, `VariableDeclaration`.
- **Three.js integration** (`src/integrations/three.ts`): `createThreeMaterial`; types `ThreeShaderMaterialLike`, `ThreeShaderMaterialConstructor`, `CreateThreeMaterialOptions`, `ThreeMaterialHandle`.
- **Babylon.js integration** (`src/integrations/babylon.ts`, added post-v1.0.0 — see `docs/architecture/babylon-integration.md`): `createBabylonMaterial`, `dispatchBabylonUniform`; types `BabylonShaderMaterialLike`, `BabylonShaderMaterialConstructor`, `CreateBabylonMaterialOptions`, `BabylonMaterialHandle`. Also added alongside it: `generateBabylonVertexShaderMapped` (codegen, listed with the other codegen exports above) and the `VertexTarget` type (`src/compiler/typeInference.ts`). All purely additive — every pre-existing export's signature is unaffected (`compileEzslVertex` gained a new optional third parameter; `CompileOptions` gained a new optional field), covered by the same breaking-change policy as every other export from this point forward.
- **Lexer/parser types** (`src/lexer/tokens.ts`, `src/parser/ast.ts`): `Token`, `TokenType` types; the `Ast` namespace (every AST node type — `export type * as Ast`).
- **Error translation** (`src/errors/translateShaderError.ts`): `translateShaderError`, `parseCompileLog`, `translateDiagnostic`, `formatDiagnostic`, `formatDiagnostics`; types `ParsedDiagnostic`, `TranslatedDiagnostic`.
- **Source maps** (`src/errors/generateSourceMap.ts`): `generateEzslSourceMap`, `sourceMapComment`; type `SourceMapV3`.

### Explicitly excluded from the stability guarantee, even though exported

- **`generateWgslFragmentShader`, `layoutUniformBuffer`, `wgslAlignmentFor`, and their associated types** (`WgslGenerationResult`, `WgslAlignment`, `LaidOutMember`, `UboLayout`) — the WebGPU/WGSL target is explicitly experimental (see `docs/architecture/webgpu-target.md`: never validated against a real `GPUDevice`, unit-tested on generated-text structure only). These names can change shape or behavior in a **minor** version without that counting as a breaking change, until the WGSL target itself graduates out of experimental status (tracked as a Post-1.0 item in `ROADMAP.md`). They're exported today for early adopters who want to experiment against them, not as a v1.0 commitment.

### Removed from the public surface before v1.0

Two exports were removed from `src/index.ts` while preparing this freeze, specifically so the stability guarantee wouldn't have to cover code that was never meant to be public API:

- **`throwAtEzslLine`** (`src/errors/throwAtEzslLine.ts`) — the internal mechanism behind `MountOptions.ezslUrl`'s DevTools stack-frame attribution (see `docs/architecture/devtools-source-maps.md`). Consumed internally by `src/runtime/bootstrap.ts` via a direct relative import; no example or test ever imported it from the package root.
- **`encodeVlqSigned`, `encodeVlqSegment`** (`src/errors/vlq.ts`) — the hand-rolled Base64-VLQ encoder backing `generateEzslSourceMap`. A pure internal encoding detail; `generateEzslSourceMap` itself remains public and covered, but the encoder it happens to use internally is free to change.

Both remain fully usable *inside* the codebase (their own dedicated test files, `tests/throwAtEzslLine.test.ts` and `tests/vlq.test.ts`, still import them directly from their source files) — only their re-export from the package root was removed. If a real external need for either emerges post-1.0, they can be re-added deliberately, as a new minor-version addition — which is always backward-compatible — rather than needing to have been frozen from day one.

## The breaking-change policy

A **breaking change** is any of:
- Removing a name from the frozen surface listed above.
- Changing an exported function's parameter types, return type, or required/optional-ness in a way that would fail to compile against previously-valid calling code, or that changes its documented runtime behavior for previously-valid inputs.
- Changing an exported type's shape in a way that would fail to compile against code that previously matched it (removing a field, narrowing a union, widening a required field to include `undefined` without a default, etc.).
- Changing the shape or field names of `Program`/`VertexProgram`/`Uniform`/`Expr` (the codegen IR) — these are consumed directly by any tool built against `compile()`'s output, not just through `compileEzsl()`'s convenience wrapper, so they carry the same weight as any other frozen export.

**A breaking change to anything on the frozen surface requires a major version bump** (`v2.0.0`, per strict SemVer — see `ROADMAP.md`'s "Versioning & Documentation Conventions"), and — before that bump ships — the change must go through the deprecation process below rather than shipping as a surprise.

**Not a breaking change** (safe in a minor or patch release):
- Adding a new named export.
- Adding a new optional field to an options object (`CompileOptions`, `MountOptions`, etc.) or a new optional parameter with a default.
- Widening an accepted input type (e.g. a parameter that took `string` now also accepts `string | URL`).
- Fixing a genuine bug where the previous behavior contradicted its own documented behavior (a bug fix that happens to change output is not the same as a deliberate breaking API change — but see "bug-fix exception" below for how this is judged in practice).
- Anything to the WGSL-target exports listed above, per their explicit exclusion.
- Anything not on the frozen surface at all (internal module internals, undocumented behavior).

### The bug-fix exception, and how it's judged

Software has bugs; "we can never fix a bug because the buggy behavior is technically covered by the freeze" would make the freeze actively harmful. The test applied: if a change fixes behavior that contradicted the function's own documented contract (its doc comment, or a `docs/architecture/*.md` design doc), it ships as a patch/minor fix, not a major bump — even though observable output changes for the affected inputs. If the "buggy" behavior was never actually promised anywhere (i.e., a user relying on it was relying on undocumented behavior), the same applies. This project has real precedent for exactly this judgment call already: several bugs found and fixed during v0.1–v0.7 development (the matrix-swizzle rejection gap, the `length(vec3)` return-type bug, the `outColorLine` source-map gap, and others documented throughout `ROADMAP.md`) were all fixed as ordinary changes, not treated as breaking, because none of them were ever the *documented* contract in the first place.

## Deprecation policy

A frozen export that needs to be removed or changed in a breaking way follows this process, not an immediate removal:

1. **Mark it deprecated** in its doc comment (a `@deprecated` JSDoc tag with a one-line reason and, where applicable, the replacement to migrate to), and note it in `CHANGELOG.md` for the minor release that introduces the deprecation. The deprecated export keeps working exactly as before — deprecation is a signal, not a behavior change.
2. **Keep it working for a minimum of 2 minor versions** after the release that first marks it deprecated (e.g. deprecated in `v1.3.0` → earliest possible removal is `v1.5.0`, and only in a major version bump even then — deprecation warns ahead of a major bump, it doesn't bypass needing one).
3. **Remove it only in a major version release** (`v2.0.0`, etc.), per the breaking-change policy above — deprecation notice satisfies the "documented breaking-change policy" this whole document exists to define; it does not make the removal itself a non-breaking change.

## Semver enforcement

See `docs/architecture/api-diff-ci.md` for the automated CI check (`npm run check-api-diff`) that compares the current `src/index.ts` surface against the last-published version's, and fails the build if a change looks breaking without a corresponding major-version bump — the mechanical enforcement backing the promises made in this document, so "the API is frozen" isn't just a policy nobody actually checks.
