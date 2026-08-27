// Indirect eval (`(0, eval)(...)` rather than a direct `eval(...)` call) —
// deliberate: a *direct* eval call runs in the calling scope's lexical
// environment (and, under strict mode, gets its own additional wrapper
// semantics for `this`/scoping), while an *indirect* eval always runs as
// a top-level global-scope script — the simplest, most predictable line-1
// starting point. Confirmed empirically while building this (not assumed
// from the spec alone): a `new Function(body)` was tried first, but V8
// synthesizes an implicit `function anonymous(\n) {\n` wrapper header
// around the body that consumes extra leading lines before the body's own
// line 1 — an offset that turned out to differ between this project's
// Node/Jest environment (+2) and a real Chromium tab (+3), i.e. not even
// a stable constant to compensate for. Indirect `eval`, by contrast, has
// no such wrapper: N leading newlines in the evaluated string reliably
// put the following statement on line N+1, verified identically in both
// plain Node and a real Chromium browser via Playwright.
// eslint-disable-next-line no-eval -- deliberate: indirect eval IS the mechanism.
// @ts-expect-error -- TS2695: the comma operator here is exactly what forces indirect (not direct) eval.
const indirectEval = (0, eval);

/**
 * Synthesizes and throws an `Error` whose top stack frame resolves to a
 * real, clickable `<ezslUrl>:<line>:<column>` location in browser
 * DevTools — the mechanism behind `mount()`'s `ezslUrl` option (v0.7 —
 * see docs/architecture/devtools-source-maps.md). Uses the `//#
 * sourceURL=` convention V8/SpiderMonkey/JavaScriptCore all honor for
 * dynamically-evaluated code: a stack frame originating from code
 * containing that trailing comment reports the given URL as its "file,"
 * navigable exactly like a real script — confirmed against a real
 * Chromium `Error.stack` while building this (a synthesized frame reads
 * `at eval (http://.../shader.ezsl:4:7)`, which DevTools' console renders
 * as a clickable link to that URL/line).
 *
 * This does **not** use the Source Map v3 document `generateEzslSourceMap`
 * produces — that document is for mapping *generated GLSL* text back to
 * `.ezsl` (attached as a `sourceMappingURL` comment on the GLSL source
 * itself, inspectable by tools that read GLSL as a mapped asset). This
 * function instead directly fabricates a JS-level stack frame pointing at
 * the `.ezsl` file, for the case that actually reaches a JS `throw` (a
 * `mount()`/`swapProgram()` compile/link failure) — the two mechanisms
 * are complementary, not overlapping; see the design doc's "Two source
 * map consumers" section for why both exist.
 */
export function throwAtEzslLine(message: string, ezslUrl: string, line: number, column = 1): never {
  // Padding with blank lines so the `throw` statement's own line inside
  // the evaluated string equals the real .ezsl line: N leading newlines
  // (an eval'd string's own line 1 is the first character) put the
  // following statement on line N+1, so `line - 1` newlines are needed to
  // land the throw on line `line`.
  const padding = "\n".repeat(Math.max(0, line - 1));
  const indent = " ".repeat(Math.max(0, column - 1));
  const escapedMessage = message.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${");
  const body = `${padding}${indent}throw new Error(\`${escapedMessage}\`);\n//# sourceURL=${ezslUrl}`;

  indirectEval(body);
  // Unreachable — the eval'd body always throws — but keeps TypeScript's
  // control-flow analysis happy about this function's `never` return type.
  throw new Error(message);
}
