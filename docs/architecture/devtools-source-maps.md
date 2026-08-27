# EZSL.js — Browser DevTools Source-Map Support (v0.7, part 3)

Internal design doc for the "Source-map support for browser DevTools (breakpoint-like error jumping to `.ezsl` source)" item of v0.7.x "Developer Experience". Read `docs/architecture/error-translation.md` first (the v0.4 layer this builds on top of, not replaces) and `docs/architecture/dev-server.md` (`ezsl dev`, the feature this is most visibly wired into).

**Scope note**: this is the third v0.7.x item built, after the CLI tool and the live-reload dev server. The VS Code extension is the one remaining item.

## What "source-map support for DevTools" can actually mean for a shader

The roadmap's own wording — "breakpoint-like error jumping to `.ezsl` source" — reads naturally for JavaScript (a real Sources panel, real breakpoints, a real call stack). GLSL shaders don't execute as JavaScript: they run on the GPU, compiled and linked by the browser's WebGL driver, with no DevTools "Sources" panel or breakpoint support for them at all — there is no GPU-side debugger to jump into. This was resolved as an explicit scope decision before implementation: the achievable, real target is anchoring the **JS-side** errors EZSL already throws (a `mount()`/`swapProgram()` compile/link failure) onto real, clickable `.ezsl` file/line locations that DevTools' console can open — not a shader debugger, which doesn't exist as a browser primitive for any WebGL library.

This is a distinct mechanism from — not a replacement for — the v0.4 error-translation layer (`docs/architecture/error-translation.md`): v0.4 produces a beginner-friendly, plain-English **printed message** (`formatDiagnostic`, a source-snippet-plus-caret text block a human reads); this feature produces a real, **navigable stack-trace location** DevTools' own UI resolves and can display inline. Both consume the same underlying `SourceMap` (GLSL line → `.ezsl` line, built by `generateFragmentShaderMapped` since v0.4) — this feature adds a new *consumer* of that data, not a new mapping mechanism.

## Two source map consumers, for two different things

1. **`generateEzslSourceMap()` / `sourceMapComment()`** (`src/errors/generateSourceMap.ts`) — converts EZSL's existing `SourceMap` into a standard **Source Map v3** JSON document (the format `.js.map`/`.css.map` files use, and what browser DevTools natively parse). This is embedded as a `//# sourceMappingURL=data:...` comment appended to the *generated GLSL text itself* (harmless either way — GLSL treats `//` as a line comment) — for a tool that inspects GLSL source as a mapped asset (e.g. a browser extension reading shader source via WebGL state inspection). No such consumer is validated in this milestone (no such tool was available to test against) — this half is built to the spec and unit-tested on its output structure, analogous to the WGSL target's validation posture (`docs/architecture/webgpu-target.md`).
2. **`throwAtEzslLine()`** (`src/errors/throwAtEzslLine.ts`) — the half that's actually validated end-to-end in a real browser (see below). Fabricates a JS `Error` whose top stack frame reports a real `.ezsl` URL and line, via the `//# sourceURL=` convention (see next section). This is what a thrown `mount()`/`swapProgram()` compile-failure actually uses.

These are complementary, not overlapping: (1) maps *GLSL text* back to `.ezsl` for a tool reading GLSL; (2) maps a *JS exception* back to `.ezsl` for a tool reading a JS stack trace (i.e. every browser's console, unconditionally — no extension required).

## `throwAtEzslLine`: the `//# sourceURL=` mechanism (the part actually validated live)

Browsers (V8, SpiderMonkey, JavaScriptCore — confirmed here against a real Chromium via Playwright, not assumed from documentation) honor a trailing `//# sourceURL=<url>` comment inside dynamically-evaluated code (`eval`): a stack frame originating from that code reports `<url>` as its file, exactly as if it were a real, separately-loaded script — and DevTools renders that as a clickable link, since the URL is real and fetchable (see "Wiring into `ezsl dev`" below for why the URL has to actually be servable, not just look like one).

`throwAtEzslLine(message, ezslUrl, line, column)` pads the evaluated string with `line - 1` leading newlines so the `throw` statement lands on the real `.ezsl` line, then evaluates it via **indirect eval** (`(0, eval)(body)`, not `new Function(body)` and not a direct `eval(body)` call):

- **`new Function(...)` was tried first and rejected** — a real bug found while building this. V8 synthesizes an implicit `function anonymous(\n) {\n<body>\n}` wrapper around a `Function` constructor's body, which consumes extra leading lines before the body's own line 1 — but the exact offset is not a portable constant: this project's Node/Jest environment showed a +2 line offset, while a real Chromium tab (via Playwright) showed +3 for the identical input. A hardcoded compensation would have been correct in exactly one of those two environments and silently wrong in the other — caught by testing in both, not by reading V8 internals.
- **Indirect eval has no such wrapper.** `(0, eval)(...)` — the comma operator forces *indirect* eval, which always executes as a top-level global-scope script (direct `eval(...)` instead runs in the caller's lexical scope, with its own scoping quirks under strict mode) — the evaluated string's own line 1 is truly line 1, with zero synthetic header. Verified identical, exact line-number behavior in both plain Node and a real Chromium browser.

The message is escaped (backslashes, backticks, `${`) before being embedded in a template literal inside the evaluated string — `tests/throwAtEzslLine.test.ts` includes a deliberate "malicious message" test (a message crafted to look like it closes the template literal and injects a second statement) confirming no code execution occurs beyond throwing an `Error` carrying the literal (if garbled) message text.

## Wiring into `mount()`/`swapProgram()`: `MountOptions.ezslUrl`

A new optional `ezslUrl` field on `MountOptions` (`src/runtime/bootstrap.ts`), used alongside the existing `ezslSource`. When both are given and a shader fails to compile/link:

1. `compileShader`/`linkProgram` gained a `throwLocated: ((rawLog: string) => void) | null` parameter, called *before* falling back to the v0.4 translated-text `Error`. `throwLocated` parses the raw driver log (`parseCompileLog`), takes its *first* diagnostic's GLSL line, resolves it through the `SourceMap` to a real `.ezsl` line, and calls `throwAtEzslLine` with the diagnostic's message — a real, throwing call, so on success this function never returns.
2. If no diagnostic can be resolved to a real `.ezsl` line (e.g. the failure is inside unmapped boilerplate, or the log didn't parse at all), `throwLocated` **returns normally** instead of throwing, and execution falls through to the existing v0.4-translated (or raw) `Error` exactly as before — `ezslUrl` never *suppresses* an error, only sometimes replaces its shape with a better-located one.
3. Separately (see "Two source map consumers" above), `linkAndBind` appends the Source Map v3 `sourceMappingURL` comment to the generated GLSL text itself when both options are present — independent of whether a failure actually occurs.

`ezslUrl` requires `ezslSource` (the compiled `SourceMap` is what resolves a GLSL line to an `.ezsl` line at all — a URL alone can't do that). Omitting `ezslUrl` (the pre-existing default) changes nothing — this is purely additive; every prior `mount()` call without it behaves identically to before this milestone.

## Wiring into `ezsl dev`: the URL has to be real

`throwAtEzslLine`'s whole value depends on `ezslUrl` being a URL DevTools can actually open — a fabricated-looking path that 404s is worse than no link at all. Before this milestone, `ezsl dev` (`docs/architecture/dev-server.md`) never served the watched `.ezsl` file itself, only its *compiled* `Program` over SSE — there was no real URL to point at. This milestone adds:

- A `/shader.ezsl` route (`createRequestListener`, `src/cli/devServer.ts`) serving the watched file's raw text, verbatim, as `text/plain`.
- `ezslUrl: "/shader.ezsl"` on every `DevServerMessage` (`compileToMessage`), sent alongside `source` over SSE.
- The dev server's client script (`CLIENT_SCRIPT`) now resolves that relative path against `window.location.href` and passes it as `MountOptions.ezslUrl` to both `mount()` (first message) and `swapProgram()` (every later one).

This means every `ezsl dev` session now gets located compile-failure stack traces "for free," with no additional user-facing option to set — the dev server always knows its own watched file's real URL.

## Real, live validation (not just unit tests)

Following this project's standing rule that a runtime-facing feature needs real-browser confirmation, not just passing unit tests: started a real `ezsl dev` session against a temp `.ezsl` file containing a genuine driver-level failure (`glsl { float half = 2.0; }` — `half` is a GLSL ES 3.00 reserved word, the same class of bug the `error-demo` example demonstrates), then, via Playwright against a real Chromium tab, called `mount()` directly (using the library loaded from the dev server's own `/index.js`, with `ezslUrl` pointing at the dev server's own `/shader.ezsl`) and captured the thrown error's real `.stack`:

```
Error: Illegal use of reserved word
    at eval (http://localhost:4398/shader.ezsl:3:7)
    at eval (<anonymous>)
    at throwAtEzslLine (http://localhost:4398/errors/throwAtEzslLine.js:52:5)
    ...
```

Line 3 of the test `.ezsl` source was exactly `  float half = 2.0;` — the driver's diagnostic (originally reporting a *generated GLSL* line number, deep inside boilerplate + escape-hatch text) correctly resolved through the compiled `SourceMap` back to the real authored source line, and the URL is genuinely fetchable (confirmed by `fetch("/shader.ezsl")` returning the real file content in the same session) — a real, clickable DevTools link, not a plausible-looking string.

## A real compiler bug found and fixed while building this

Building the "resolve a GLSL line back to `.ezsl`" path surfaced a genuine, previously-invisible gap: `generateFragmentShaderMapped`'s `fragColor = ...;` line (the very last statement of every generated shader, and a highly plausible place for a driver error to land — e.g. a type mismatch in the final color expression) was **always** mapped to `null` in the `SourceMap`, for every program, with no exception. The root cause: `compile.ts`'s top-level `color = <expr>` assignment sets the compiler's internal `outColor` variable but — unlike every other statement — never recorded which `.ezsl` line it came from; `Expr`/`TypedExpr` (the codegen IR's expression type, used far more broadly than just this one field) carries no line information at all.

Fixed by adding a new, narrowly-scoped `Program.outColorLine: number | null` field (`src/codegen/types.ts`) — populated in `compile.ts` at the exact point the top-level output assignment is recognized (`statement.pos.line`), and consumed by `generateFragmentShaderMapped`'s final `push(\`  fragColor = ...\`, program.outColorLine)` call. Deliberately *not* solved by adding a line field to `Expr` itself (which would ripple through the WGSL codegen, Three.js integration, and every test hand-constructing a `Program`/`Expr` fixture) — a separate, single-purpose field was the smaller, more honest change for what turned out to be a one-statement-shaped gap. This also improves v0.4 error-translation coverage as a side effect (a driver error on the `fragColor = ...` line can now be attributed to real `.ezsl` source too, not just this feature's `throwAtEzslLine` path) — caught by a genuinely failing unit test (`tests/generateSourceMap.test.ts`'s "produces a non-empty segment for a line mapped to a real `.ezsl` line" case, using the simplest possible program: a single top-level `color = [...]` with no intermediate body statements — the exact shape that had never been exercised by any prior v0.4 test, since v0.4's own tests always used a multi-statement program where *some* line mapped successfully). `VertexProgram`'s equivalent `outPosition` line was deliberately left unmapped — out of scope, since `ezsl dev`/this feature targets `mount()`'s fragment path only, matching the dev server's existing single-fragment-focus decision (`docs/architecture/dev-server.md`).

## What this milestone does not implement

- **No real GPU-side shader debugging** (breakpoints, step-through) — impossible via any browser API; see "What 'source-map support' can actually mean" above.
- **No source-map anchoring for `VertexProgram`/vertex-stage errors** (Three.js), and no anchoring for `mountToCanvas2D` — only `mount()`'s fragment path.
- **No column-level precision.** `generateEzslSourceMap`'s mappings are line-granular (matching `SourceMap`'s own granularity — GLSL codegen never attributes more than one EZSL statement per generated line); `throwAtEzslLine`'s `column` parameter is a best-effort approximation from `CompileError`'s own token-start column, not guaranteed to match exactly where a driver's diagnostic would point.
- **Multiple diagnostics.** `throwLocated` only ever resolves the *first* driver diagnostic to a location — a shader with several simultaneous errors still gets a single located throw (matching v0.4's own existing multi-diagnostic printed-text behavior, which does show all of them; this feature's single-frame nature is a JS `Error` limitation, not a deliberate omission).
- **Multi-pass (`createPipeline`) wiring.** Each pass would need its own `ezslUrl`; not threaded through in this milestone.

## Tests

- `tests/vlq.test.ts` (6 cases) — Base64-VLQ encoding, cross-checked against hand-derived reference values and a round-trip through an independent decoder.
- `tests/generateSourceMap.test.ts` (9 cases) — Source Map v3 document shape, `sourcesContent` embedding, one-group-per-generated-line structure, empty segments for unmapped lines, non-empty segments for mapped lines (including the `outColorLine` fix above), `sourceMapComment`'s base64 round-trip.
- `tests/throwAtEzslLine.test.ts` (6 cases) — message propagation, URL/line presence in the real stack, the line-1 edge case, and the malicious-message-escaping tests described above.
- `tests/devServer.test.ts` gained 3 cases: `ezslUrl` present in `compileToMessage`'s output, the `/shader.ezsl` route serving real file content, and its fallback behavior when no `ezslPath` is configured.
- `tests/glslGenerator.test.ts`'s hand-built `Program` fixtures were updated for the new required `outColorLine` field (all set to `null`, preserving each fixture's original, pre-existing behavior).
- All 427 project tests pass; the full cross-browser integration suite (29/29 examples × Chromium/Firefox/WebKit) was re-run after these changes and shows no regressions, since `compile.ts`/`codegen/types.ts`/`glslGenerator.ts`/`bootstrap.ts` are all shared, heavily-exercised files.
