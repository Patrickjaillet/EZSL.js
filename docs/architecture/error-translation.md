# EZSL.js — Error Translation Layer (v0.4)

Internal design doc for the v0.4.x "Error Translation Layer" milestone: turning a raw WebGL driver compile/link log into a beginner-friendly message pointing at the actual `.ezsl` source line. Read `docs/architecture/transpiler-pipeline.md` (v0.1 core) first — this doc covers what sits downstream of `generateFragmentShader`.

## Pipeline

```
WebGL driver log (gl.getShaderInfoLog / gl.getProgramInfoLog)
  |
  |  src/errors/parseCompileLog.ts — parseCompileLog()
  v
ParsedDiagnostic[]  { glslLine, token, message, severity, raw }
  |
  |  src/errors/dictionary.ts — translateDiagnostic()
  v
TranslatedDiagnostic  { original, explanation, suggestion }
  |
  |  GLSL line -> .ezsl line, via the codegen source map (see below)
  |  src/errors/printer.ts — formatDiagnostic() / formatDiagnostics()
  v
Pretty-printed console string (source snippet + caret + explanation + suggestion + raw driver text)
```

`src/errors/translateShaderError.ts` chains the whole thing: `translateShaderError(rawLog, ezslSource, sourceMap)` → the final formatted string. `src/runtime/bootstrap.ts`'s `mount(canvas, program, { ezslSource })` uses this automatically — passing `ezslSource` switches a shader compile/link failure from throwing the raw driver log to throwing the translated message.

## The GLSL-line → `.ezsl`-line source map (built in v0.3, consumed here)

Before this milestone, `Program.body` (`src/codegen/types.ts`) was `string[]` — plain GLSL text with no memory of which `.ezsl` line it came from. That had to change first: `Program.body` is now `SourceMappedLine[]`, `{ glsl: string, ezslLine: number | null }`, and **every** line the compiler emits carries its source line — not just `glsl { ... }` blocks (which already had a coarser, block-level `// ezsl:line N` comment before this milestone). `compile.ts`'s `mapped()` helper tags a batch of GLSL lines with a shared `.ezsl` line number (the enclosing statement's), and `indent()` was updated to carry that tag through instead of operating on bare strings.

`generateFragmentShaderMapped()` (`src/codegen/glslGenerator.ts`, new — `generateFragmentShader()` is now a thin wrapper that discards the map for callers who don't need it) builds the final GLSL source line-by-line via an explicit `push(glsl, ezslLine?)` sequence, so the resulting `1-based GLSL line -> ezslLine | null` map (`SourceMap`, a `ReadonlyMap<number, number | null>`) is constructed from the same data the source text is, rather than being reverse-engineered from the finished string afterward. Boilerplate lines (`#version`, uniform declarations, the `uv`/`time`/`resolution` prelude, structural braces with no single attributable line) map to `null` — a `null` is a legitimate, expected outcome, not a bug: `docs/architecture/transpiler-pipeline.md`'s auto-injected boilerplate isn't written by the user, so there's no `.ezsl` line to point at.

### Escape Hatch line-level mapping (this milestone's fix, not v0.2's original design)

`docs/architecture/escape-hatch.md` originally described the `glsl { ... }` block's source-map annotation as **block-granularity only** — one `// ezsl:line N` comment per block, not per raw line inside it. Building the per-line source map for the rest of the compiler exposed exactly why that was too coarse: a real translated-error test against `examples/error-demo/shader.ezsl` (a `glsl { float half = 2.0; }` block — `half` is a GLSL reserved word) initially pointed the translated error at line 3 (the `glsl {` line) instead of line 4 (the actual `float half = 2.0;` line) — technically correct under the old "block-granularity" design, but nearly useless for a real driver error, which needs the exact line.

Fixed by exploiting a property of how the lexer captures a raw block (see `docs/architecture/escape-hatch.md`'s lexing section): the captured text starts immediately after the `glsl {` on `statement.pos.line`, and is captured verbatim with all its newlines intact — so raw capture line `N` (0-indexed) is physically on `.ezsl` source line `statement.pos.line + N`. `compile.ts`'s `RawGlslStatement` handling now computes this per-line, giving the Escape Hatch the same per-line source-map precision as ordinary EZSL statements, for free, with no change to the lexer or grammar. This was confirmed against a live translated error in a real browser (see "Validated example" below) — not just asserted by a unit test, since a source-map off-by-one is exactly the kind of bug that looks right in isolation and wrong against a real driver log's line numbers.

## `parseCompileLog` — parsing the raw driver log

WebGL shader/program info logs (across Chrome/Firefox/Edge, which all use ANGLE regardless of OS, and most native GLSL ES drivers) follow one line shape:

```
ERROR: 0:19: 'half' : Illegal use of reserved word
```

`0` is a source-string index (always `0` for EZSL, since `compileShader` is always called with a single source string — see `docs/architecture/transpiler-pipeline.md` Stage 5), `19` is the 1-based GLSL line, the optional single-quoted segment is the offending token, and the rest is the message. This exact line was captured from a real Chromium/ANGLE compile failure during v0.1 example validation (`ROADMAP.md`'s v0.1 trap callout about `checkerboard`'s `half`) and is used verbatim as a regression-test fixture in `tests/errors.test.ts` — the parser regex (`ANGLE_DIAGNOSTIC` in `src/errors/parseCompileLog.ts`) was built and verified against real driver output, not a guessed format.

`ROADMAP.md`'s v0.4 wording ("map of common `ERROR: 0:X` codes") is slightly imprecise and worth flagging: **`0:X` is not an error code** — `0` is the source-string index and `X` is the line number; ANGLE's diagnostics don't carry a distinct numeric error code the way, say, TypeScript's `TS2322` does. The dictionary (below) therefore matches on the message *text's structural shape*, not on a code, which is also exactly what the roadmap's own v0.4 trap callout demands ("match on structural patterns... rather than literal string matching").

Unrecognized lines (blank lines, a driver's non-ANGLE format, a trailing stray character some drivers append) are silently skipped by `parseCompileLog` rather than throwing — a log that produces zero parsed diagnostics is a real, handled case (see `translateShaderError`'s fallback below), not an error in the parser itself.

## `dictionary.ts` — structural pattern matching, not vendor-specific strings

Each entry matches a regex against `ParsedDiagnostic.message` — critically, `message` has already had the location prefix (`ERROR: 0:19:`) *and* the quoted token (`'half' :`) stripped out by `parseCompileLog`, so dictionary patterns match only the driver's remaining descriptive text (e.g. `Illegal use of reserved word`), and use `diagnostic.token` directly to name the offending identifier in the explanation — **not** by re-capturing it from `message` with a `'(.+)' :` prefix in the pattern. Getting this wrong (matching a `'(.+)' :` prefix that `message` no longer contains) was a real bug caught while writing `tests/errors.test.ts`: three dictionary entries silently fell through to the generic fallback explanation for every real input, because their patterns could never match — a class of bug that's easy to write and easy to miss without a test asserting the *actual* translated text, not just "did some entry match."

Covered today (ANGLE-verified — see below): `undeclared identifier`, `Illegal use of reserved word`, `no matching overloaded function found`, `dimension mismatch`/`wrong operand types`, a bare `syntax error`, a `return` type/value mismatch, and array-index-out-of-range. A message matching no entry gets a generic fallback (`"No plain-English translation is available..."`) rather than `null` or a thrown error — the raw driver text is *never* hidden or lost, appended to every formatted diagnostic (translated or not) via `formatDiagnostic`, consistent with the roadmap's framing of error translation as additive, not a replacement for the underlying driver information.

**Verified vs. best-effort**: only `Illegal use of reserved word` and its accompanying `syntax error` are confirmed against real ANGLE output (captured live from Chromium — see "Validated example"). The other dictionary entries' exact wording (`undeclared identifier`, `no matching overloaded function found`, etc.) is written from general GLSL ES / ANGLE diagnostic conventions but has not yet been triggered and captured from a real compile failure the way the reserved-word case was. This is a known gap, not a hidden one — expanding real-driver coverage (ideally across more than just ANGLE, per the roadmap's own multi-vendor trap callout) is natural follow-up work, not represented as "done" here.

## `printer.ts` — pretty-printing

`formatDiagnostic` renders one diagnostic as: a `severity at .ezsl:N` (or `GLSL:N (no .ezsl source line found)` when the source map has no mapping — this happens for a diagnostic on a boilerplate/synthesized line) header, the actual `.ezsl` source line with a caret line under it (`^^^^` spanning the trimmed line's length — a simple whole-line caret, not sub-line column pointing, since ANGLE's own diagnostics don't reliably carry a column either), the plain-English explanation, a suggestion (when the dictionary entry has one), and the raw driver message, always. `formatDiagnostics` joins multiple diagnostics (a single compile failure often produces several related lines, e.g. `Illegal use of reserved word` immediately followed by a `syntax error` for the same token) with a blank line between them.

## Integration: `mount(canvas, program, { ezslSource })`

## "Did you mean?" suggestions (added after this milestone's initial pipeline)

The roadmap's `"Did you mean?" suggestions for common type errors` deliverable is implemented in two places, deliberately not one, because the two error sources have access to fundamentally different information:

- **EZSL-side (`src/compiler/compile.ts`)**: when `compile()` itself rejects an unknown function call, an unknown struct-field-type name, or an unknown struct field access, it already has the *complete, precise* list of valid names in scope at that point (every builtin, every `fn`, every `defineFunction`, every declared struct/field) — so `unknown function 'smoothstp'` becomes `unknown function 'smoothstp' — did you mean 'smoothstep'?`. This is the strictly better case: EZSL compile errors happen *before* any GLSL exists, so there's no ambiguity about what "in scope" means.
- **GLSL driver-side (`src/errors/dictionary.ts`)**: the `undeclared identifier` entry accepts an optional `knownNames: readonly string[]` list (threaded through `translateDiagnostic` → `translateShaderError` → `mount()`/`createPipeline()`, which supply `Program.uniforms` automatically) and offers the same style of suggestion when the misspelled GLSL token is close to a known EZSL name. This case is inherently weaker: a GLSL-level error (almost always from inside a `glsl { ... }` Escape Hatch block EZSL doesn't type-check — see `docs/architecture/escape-hatch.md`) has no real notion of "scope" available to the translator beyond whatever uniform names happen to exist on the compiled `Program`; a caller with richer information (e.g. editor tooling with access to the compiler's live `TypeScope`) can pass a fuller `knownNames` list directly to `translateDiagnostic`/`translateShaderError`.

Both share one utility: `didYouMean(name, candidates)` (`src/compiler/didYouMean.ts`), a Levenshtein-edit-distance nearest-neighbor search with a **hand-tuned tiered threshold** (not a single linear ratio) — chosen because a flat ratio either over-suggested on short names (`bogus`/`cosine` wrongly matching `cos`) or missed common short-word typos (`sni` failing to suggest `sin`) depending on which ratio was picked; no single formula fit both ends cleanly, so the threshold is a small lookup table by shorter-name length, tuned against a fixed regression table in `tests/didYouMean.test.ts`. A suggestion is only offered when the edit distance is small relative to name length — an unrelated name (`totallyUnrelatedFunctionName`) correctly yields no suggestion rather than a nonsense one, and the dictionary/compiler fall back to their pre-existing generic guidance ("check the spelling of X") in that case, never silently disappearing.

`src/runtime/bootstrap.ts`'s `mount()` gained a third, optional `MountOptions` parameter. Passing `ezslSource` (the original `.ezsl` text `program` was compiled from) causes a shader compile or program link failure to throw `translateShaderError(rawLog, ezslSource, sourceMap)`'s output instead of the bare driver log; omitting it preserves the pre-v0.4 behavior exactly (raw log + full GLSL source dumped into the thrown `Error`) — this is a deliberately non-breaking addition, not a replacement of the old error path, since not every `Program` passed to `mount()` necessarily came from `.ezsl` source (e.g. hand-built codegen IR in a test). The vertex shader is never passed through translation (`translate: null` in `compileShader`'s internal call) — EZSL doesn't generate vertex-stage EZSL source yet (see `docs/architecture/transpiler-pipeline.md` Stage 4), so a vertex shader failure would have no `.ezsl` line to map to regardless; it can currently only fail from an EZSL compiler/generator bug, not user error.

## What v0.4 deliberately doesn't implement

- **Multi-vendor diagnostic verification.** Only ANGLE (Chrome/Firefox/Edge's shared GLSL backend, all platforms) has been used to verify the parser regex and dictionary wording against real output. The roadmap's own trap callout warns NVIDIA/AMD/Intel/Apple Silicon phrase identical errors differently — this remains true and unaddressed beyond the structural (not literal-string) matching approach, which is a necessary but not sufficient mitigation. Real coverage of non-ANGLE drivers needs those drivers' actual output samples, which weren't available to capture in this environment.
- **Sub-line column pointing.** The caret under a source snippet spans the whole trimmed line, not a precise column — ANGLE doesn't reliably report a usable column either, so this wasn't purely a scope cut.
- **A dedicated CLI tool.** The roadmap's "CLI/console pretty-printer" is implemented as a library function (`formatDiagnostic`/`formatDiagnostics`, callable from any Node or browser context) rather than a standalone `ezsl` CLI binary — no CLI exists yet at all (that's `v0.7.x` scope per `ROADMAP.md`). `mount()`'s integration throws the pretty-printed string as an `Error`, which any environment's default error reporting (browser devtools console, Node's uncaught-exception printer) already renders reasonably.

## Validated example

`examples/error-demo/shader.ezsl` deliberately triggers a real WebGL2 compile failure — a `glsl { float half = 2.0; }` Escape Hatch block using the GLSL-reserved word `half` (unreachable via ordinary EZSL source, which rejects reserved words at compile time — see `docs/architecture/transpiler-pipeline.md`'s `isReservedGlslWord` coverage — but not checked inside a raw Escape Hatch block, exactly the gap `docs/architecture/escape-hatch.md` documents). Confirmed in a real Chromium browser (via Playwright) that `mount(canvas, program, { ezslSource: shaderSource })` throws a fully translated, correctly `.ezsl`-line-attributed error: it names line 4 (the actual `float half = 2.0;` line, not the enclosing block's `glsl {` line — see the Escape Hatch line-mapping fix above), explains that `half` is GLSL-reserved, suggests renaming it, and still shows the raw ANGLE driver text (`ERROR: 0:16: 'half' : Illegal use of reserved word`) beneath the explanation. Run with `npm run example:error-demo` — the page renders the translated message as page text (not just a console throw) specifically so it's directly inspectable without opening devtools.

`examples/did-you-mean-demo/shader.ezsl` (`x = smoothstp(0.0, 1.0, uv.x)` — a typo'd `smoothstep`) exercises the EZSL-side "did you mean?" path specifically. Confirmed in a real Chromium browser: `compileEzsl` throws `EZSL compile error at 1:5: unknown function 'smoothstp' — did you mean 'smoothstep'?`. Run with `npm run example:did-you-mean-demo`.
