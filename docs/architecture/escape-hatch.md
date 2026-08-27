# EZSL.js — Escape Hatch & Native Interop (v0.2)

Internal design doc for the v0.2.x "Escape Hatch & Native Interop" milestone. Covers two related but separate mechanisms for dropping into raw GLSL from EZSL: the `glsl { ... }` statement block, and `defineFunction` custom function injection. Read `docs/architecture/transpiler-pipeline.md` first for the surrounding pipeline this builds on.

## Why a block, not a JS tagged template

`ROADMAP.md`'s v0.2 item literally says `` glsl`...` `` tagged template literal — that's JS/TS syntax, not EZSL syntax. Given that every other EZSL construct (gradient, raymarch, etc.) lives in a `.ezsl` file compiled by `compileEzsl(source)`, a JS-side tagged template would only be reachable from *outside* a `.ezsl` file, splitting where "the shader" lives across two languages for no benefit. Instead, v0.2 implements the same idea as an EZSL-native **statement**: `glsl { <raw GLSL> }`. `defineFunction`, in contrast, genuinely is a JS-side API (per the roadmap's own signature `defineFunction(name, glslSource, signature)`) — it registers something before compilation starts, which is naturally a host-language call, not something written inside the `.ezsl` file itself.

## `glsl { ... }` — raw GLSL block statement

### Lexing

`glsl` is a reserved keyword (`GLSL` token). When the lexer sees `glsl` immediately followed by `{` (whitespace/newlines in between are skipped), it does **not** tokenize the block's contents as EZSL — it switches to verbatim capture: consume the opening `{`, track brace depth (so a nested GLSL `if (...) { ... }` or a scoping block inside the raw block doesn't prematurely close the capture), and emit everything up to the matching `}` as a single `RAW_GLSL_BLOCK` token. An unterminated block (`depth` never returns to 0) is a `LexError`.

This is what "transpiler-opaque by design" (the roadmap's own phrase) means concretely: from the token stream onward, the block's contents are an opaque string, not EZSL tokens. `glsl` used any other way (e.g. `glsl = 1`, as a variable name) still lexes as the `GLSL` token — it doesn't get special-cased back to `IDENTIFIER` — so `glsl` is effectively a reserved word in EZSL source, not just inside a block.

### Parsing

`RawGlslStatement` is a new `Statement` variant (`src/parser/ast.ts`) holding the captured `source` string and the position of the `glsl` keyword. `Parser.parseRawGlslStatement` just expects `GLSL` then `RAW_GLSL_BLOCK` — there's no internal parsing of the block's contents at all; the grammar production is `'glsl' RAW_GLSL_BLOCK`, not `'glsl' Block` (see `docs/architecture/ezsl-grammar.ebnf.md`, which should be updated alongside this file if the block's *outer* syntax changes — the block's *inner* contents are by definition outside the EBNF's scope).

### Compilation

`compile.ts`'s `emitStatements` handles `RawGlslStatement` by:
1. Running `checkRawGlslNamespaceCollisions` on the raw source (see below).
2. Emitting a `// ezsl:line <N> (glsl { ... } Escape Hatch)` comment, then the raw source's lines verbatim (trailing-whitespace-trimmed, with a leading/trailing blank line stripped if present from how the block was written) — all indented to match the current nesting depth, same as any other statement.

The block can appear anywhere a statement can — top level, inside `if`/`for` bodies — and can read or write any EZSL variable already in scope by referencing its plain (unprefixed) name, since EZSL locals compile 1:1 to GLSL identifiers of the same name (uniforms are the one exception — see below). This is how `examples/escape-hatch/shader.ezsl` uses it: `d` and `time` (both EZSL locals/builtins) are read inside the block, and `ripple` (an EZSL local declared *before* the block) is written to.

### On "consumed" variables and dead-code elimination

`ROADMAP.md`'s v0.2 trap callout says an EZSL variable referenced inside a raw block "must be explicitly declared as consumed to prevent dead-code elimination from stripping it before injection." **This does not apply to the current implementation, and deliberately isn't built**: the compiler (`src/compiler/compile.ts`) has no dead-code elimination pass at all — every EZSL assignment is always emitted, unconditionally, whether or not anything (EZSL or a `glsl` block) ever reads it. A "consumed" marker exists to solve a problem that doesn't exist yet. Building the marker now, ahead of the DCE pass it would gate, would be exactly the kind of speculative complexity worth avoiding — it can't even be tested meaningfully without something to protect against. If/when a DCE pass is added (not currently on any milestone), a "consumed" mechanism becomes a real necessity again and should be designed against the actual DCE pass's liveness analysis at that time, not designed blind now.

### Namespace collision detection

Because the compiler cannot parse or type-check the block's contents, `checkRawGlslNamespaceCollisions` (`src/compiler/compile.ts`) does the one useful check that's still possible without a real GLSL parser: a **textual** scan for GLSL-style local declarations (`<type> <name>` or `<type> <name> =`, where `<type>` is one of `float`/`int`/`bool`/`vec2..4`/`mat2..4`) whose `<name>` collides with an EZSL local or uniform already in scope at that point in the program. GLSL has no block scoping that would make such a collision safe — it's always either a redefinition error at the driver, or (worse) silent double-use of one identifier for two logically different values. This is caught as a `CompileError` with the `.ezsl` source position, rather than surfacing later as an opaque WebGL driver error — consistent with how `isReservedGlslWord` (`src/compiler/typeInference.ts`) already catches a related but distinct class of "looks fine in EZSL, breaks at the driver" bug (see `docs/architecture/transpiler-pipeline.md` and the `ROADMAP.md` v0.1 trap callout it documents).

This check is intentionally narrow: it flags *declarations*, not *references* — reading `d` inside a block is fine (and is exactly the primary use case), only re-declaring a name already in scope (`float d = ...` where `d` already exists) is flagged. It's a heuristic, not a GLSL parser; it will not catch every possible collision (e.g. a name introduced inside a nested `{ }` scope *within* the raw block, which GLSL scoping would make legal but which this regex can't distinguish from a top-level redeclaration) and may in rare cases false-positive on a raw block that legitimately shadows a name in an inner GLSL scope. If that turns out to matter in practice, the fix is a real (even if minimal) GLSL tokenizer for the block contents, not a regex refinement.

### `#define` / `#ifdef` preprocessor passthrough

This "just works" as a consequence of verbatim injection — no special-casing was needed. A `#define FOO 1.0` or `#ifdef`/`#endif` pair written inside a `glsl { ... }` block is emitted exactly as written, and the GLSL preprocessor (which runs before the GLSL compiler proper, independent of EZSL) handles it normally. The one caveat: **preprocessor directives must not have other tokens before them on their line** per the GLSL spec, but leading whitespace/indentation is tolerated by all major drivers in practice — `examples/escape-hatch/shader.ezsl`'s `#define RIPPLE_FREQ 30.0` is emitted with the block's indentation and was confirmed to compile and link in a real WebGL2 context (Chromium via Playwright).

### Source-map annotations

**Updated in v0.4** — originally (v0.2) this was block-granularity only: a single `// ezsl:line <N>` comment naming the `glsl` keyword's line, with no per-raw-line mapping. Once `Program.body` became a real per-line source map (`SourceMappedLine[]`, structured data — see `docs/architecture/error-translation.md`) rather than plain `string[]`, extending the Escape Hatch to per-line precision turned out to be nearly free: since the lexer captures the block's contents starting immediately after `glsl {` with all newlines intact, raw capture line `N` (0-indexed) is simply `.ezsl` line `statement.pos.line + N`. Every line inside a `glsl { ... }` block is now individually tagged with its real `.ezsl` source line, not just the block as a whole — confirmed against a live translated compile error in `docs/architecture/error-translation.md`'s validated example (`examples/error-demo/shader.ezsl`), which initially (before this fix) mis-pointed at the block's opening line instead of the actual offending line inside it. The block still additionally emits a leading `// ezsl:line <N> (glsl { ... } Escape Hatch)` comment in the generated GLSL text, for a human eyeballing the raw shader source directly (outside of any tooling) to see at a glance which block a region came from.

## `defineFunction` — custom GLSL function injection

### API

```ts
import { defineFunction, compileEzsl } from "@patrickjaillet/ezsl";

const square = defineFunction(
  "square",
  `float square(float x) {\n  return x * x;\n}`,
  { params: ["float"], returns: "float" },
);

const program = compileEzsl(source, { customFunctions: [square] });
```

`defineFunction(name, glslSource, signature)` (`src/compiler/index.ts`) is a plain constructor — it just returns `{ name, glslSource, signature }` (`CustomFunction`, `src/compiler/compile.ts`); it does nothing on its own. The list of registered functions is passed into `compile()`/`compileEzsl()` via `CompileOptions.customFunctions`, matching the roadmap's exact signature.

### Signature

`FunctionSignature` (`src/codegen/types.ts`) is `{ params: EzslType[], returns: EzslType }`. This is what lets `square(2.0)` be type-checked and inferred like any builtin call from inside EZSL source: `compile()` validates argument count against `params.length` (a `CompileError` on mismatch — argument *types* are not currently cross-checked against `params`, only count; the declared `glslSource` is trusted to match its own stated signature) and gives the resulting `CallExpression` the declared `returns` type, the same way `FIXED_RETURN_FUNCTIONS`/`SHAPE_PRESERVING_FUNCTIONS` do for builtins (see `docs/architecture/transpiler-pipeline.md` Stage 3).

### Collision and validation rules (`compile()`, at the top of the function, before any statement is walked)

- A custom function name colliding with an existing builtin (`sin`, `mix`, `vec3`, etc.) is a `CompileError` — it would otherwise shadow the builtin silently and unpredictably depending on iteration order.
- Two custom functions registered under the same name: `CompileError`.
- A custom function name that is a GLSL reserved word (`isReservedGlslWord`): `CompileError` — same reasoning as reserved-word local variable names.

### Codegen

Each registered function's `glslSource` (trimmed) is collected into the codegen IR's new `Program.topLevel: string[]` field (`src/codegen/types.ts`) and emitted by `generateFragmentShader` (`src/codegen/glslGenerator.ts`) **above `void main()`**, below the uniform declarations — i.e. at GLSL file scope, exactly where a GLSL function definition must live. `topLevel` is also where a *statement-position* `glsl { ... }` block's output does **not** go — that lands in `body`, inside `main()` — the two Escape Hatch mechanisms write to different parts of the generated shader by design: `defineFunction` for file-scope declarations (functions, and in principle future struct/const declarations), `glsl { ... }` for inline logic inside the render loop.

## Validated example

`examples/escape-hatch/shader.ezsl` exercises both mechanisms together and was confirmed to compile, link, and render correctly in an actual WebGL2 context (Chromium via Playwright): a `glsl { ... }` block computes an animated ripple pattern using a `#define`d constant and reads/writes EZSL locals (`d`, `time`, `ripple`), then a `defineFunction`-injected `hueShift` (called from ordinary EZSL source, `hueShift(ripple)`) maps the ripple value through a cosine-palette color function. Run with `npm run example:escape-hatch`.

## What v0.2 deliberately does not implement

- **"Consumed" variable marking / dead-code elimination** — see above; there's no DCE to protect against yet.
- **Cross-checking custom function argument *types*** (only argument *count* is checked) against the declared `signature.params` — the `glslSource` is trusted to actually implement what `signature` claims. A future hardening could validate this, but nothing today generates a custom function's `glslSource` programmatically in a way that could drift from its declared signature, so it hasn't been a real footgun yet.
- **A real GLSL parser for raw block contents** — collision detection is textual/regex-based (see above), not semantic.

(Per-line source mapping inside a `glsl` block, listed here as a gap through v0.3, was closed in v0.4 — see the "Source-map annotations" section above and `docs/architecture/error-translation.md`.)
