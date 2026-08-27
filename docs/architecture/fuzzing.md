# EZSL.js — Parser Fuzz-Testing (v1.0.x)

Internal design doc for the v1.0.x Quality & Coverage "Fuzz-testing pass on the parser (malformed input → graceful error, never a silent crash)" deliverable.

## The property under test

For **any** string fed through `tokenize → parse → compile`, the outcome must be either a successful compile, or one of the three documented pipeline exceptions (`LexError`, `ParseError`, `CompileError`) — never any other kind of thrown error (a bare `TypeError`, a `RangeError` from unbounded recursion, etc.) and never an uncaught crash. This is exactly what "graceful error, never a silent crash" means made checkable: a consumer catching `LexError | ParseError | CompileError` around a compile call (which every documented error-handling pattern in this project already assumes — the CLI, the dev server, the VS Code extension's `collectVariableDeclarations` all do exactly this) must never be surprised by a fourth kind of exception escaping that catch.

## Why a hand-rolled fuzzer, not a library (explicit user decision)

`fast-check` (or a similar property-based-testing library) offers real capabilities this hand-rolled version doesn't — automatic shrinking of a failing input down to a minimal reproducing case, richer generator combinators. It was considered and explicitly not chosen: this project has consistently avoided adding a new dependency when a small, self-contained script covers the actual need (the CLI's hand-written argv parsing, the dev server's zero-dependency `node:http` server, the VLQ encoder built by hand rather than pulled from `source-map` — see their respective design docs), and a fuzzer is a bounded, one-purpose tool here, not a piece of ongoing test-writing infrastructure that would benefit from a library's ergonomics over years of use.

## How it works

`tests/fuzz/fuzzParser.mjs` (`npm run fuzz [iterations] [seed]`):

1. **Corpus**: every `.ezsl` file under `examples/` (56 files as of this writing) — real, valid, structurally-varied EZSL programs, not synthetic examples, so mutations start from realistic shapes rather than arbitrary strings.
2. **Mutation**: each fuzz iteration picks a random corpus seed and applies 1–5 chained mutations, each one of: contiguous-slice deletion, random-EZSL-token insertion, contiguous-slice duplication, prefix truncation, character swap, or single random-byte insertion. Chaining multiple mutations (rather than one mutation per iteration) covers both "shallow" corruption (a single dropped character) and "deep" corruption (a barely-recognizable mangled program) — different classes of bug tend to hide at different corruption depths.
3. **Execution**: each mutated string is run through the real `tokenize → parse → compile` pipeline (against the compiled `dist/` output, not `ts-jest`-transformed source, so the fuzzer exercises exactly what a real consumer would run). The outcome is classified as `compiled`, `expected-error` (one of the three documented classes), or `unexpected-crash` (anything else, including a `RangeError`, a `TypeError`, or the fuzzer process itself dying).
4. **Reproducibility**: a fixed, seeded linear congruential generator (no crypto, no dependency) drives all randomness — the exact same `iterations`/`seed` pair always produces the exact same sequence of mutated inputs, so a failing run can be re-run byte-for-byte identically to investigate, rather than "it failed once and I can't reproduce it."

## A real crash bug found and fixed while building this

The very first substantial run (5,000 and 50,000 iterations, two different seeds) found **zero** unexpected crashes — a genuinely strong result on its own, but not sufficient evidence of correctness by itself, since a mutation-based fuzzer starting from valid corpus seeds tends to under-explore certain *structural* pathologies (very deep, not-otherwise-malformed nesting) that a real user is more likely to hit by accident (e.g. programmatically generated EZSL source with runaway nesting) than a fuzzer's typically-shallow mutation chains are to stumble into by chance. Deliberately stress-testing that specific shape — a fully valid but extremely deeply nested parenthesized expression, `color = ((((...1.0...))))`  with the nesting depth pushed up manually — found a real bug: at a depth somewhere between 2,000 and 5,000 levels (confirmed empirically, not by reading the recursion-depth math in advance), the recursive-descent parser's `parseExpression → parseTerm → parseUnary → parsePostfix → parsePrimary → parseExpression` cycle (re-entering `parseExpression` for each layer of parenthesization) exhausted the JavaScript call stack and threw a raw `RangeError: Maximum call stack size exceeded` — not one of the three documented pipeline exceptions, and exactly the "silent crash" this deliverable exists to catch and prevent.

**The fix**: `Parser` (`src/parser/parser.ts`) gained a private `expressionDepth` counter, incremented on entry to `parseExpression` and decremented in a `finally` block on exit — the single re-entry point every recursive path in the expression grammar passes through (parenthesized sub-expressions, vector/array literal elements, function-call arguments all bottom out through `parseExpression`). Once depth exceeds `MAX_EXPRESSION_DEPTH` (500, chosen with real margin under the empirically-observed 2,000–5,000 failure range — deliberately conservative, since stack-overflow thresholds vary by platform, Node build, and available stack size, none of which this constant can observe at runtime), parsing raises a real `ParseError: expression nesting too deep (> 500 levels) — likely malformed or excessively parenthesized input` instead of continuing to recurse. Verified directly: depths up to 499 still compile exactly as before (no regression on any real, reasonably-nested program — confirmed against the full example corpus and the 450-case Jest suite), depths of 500 and above now raise `ParseError` cleanly, and the previously-crashing 10,000-deep case from the original bug report now fails gracefully instead of crashing the process.

## Regression coverage

`tests/fuzz/parserFuzz.test.ts` (7 cases, runs as part of the ordinary `npm test` — unlike the fuzz pass itself, this is fast and belongs in the default loop) pins the exact bug found above (a `ParseError`, not a `RangeError`, for 10,000-deep nesting) as a permanent regression test, confirms moderate nesting (well under the guard) still compiles normally, and covers several other malformed-input shapes the fuzzer's own mutation strategies are designed to produce (empty input, mid-expression truncation, mid-keyword truncation, raw non-EZSL byte/Unicode noise, deeply nested array-literal brackets — confirming the same guard transitively protects `[...]` nesting too, since a vector/array literal's elements are themselves parsed via `parseExpression`).

## Running it

```bash
npm run build     # fuzzParser.mjs imports from dist/, matching what a real consumer runs
npm run fuzz                    # 5000 iterations, seed 42 (defaults)
npm run fuzz -- 50000 1337       # custom iteration count / seed
```

Not wired into CI (no CI configuration exists in this repository yet — same gap noted in `docs/architecture/api-diff-ci.md`) and not run as part of `npm test`, deliberately — a multi-thousand-iteration property-based pass has real runtime cost (tens of seconds at 50,000 iterations) that doesn't belong in the fast local dev-loop test command; its value is in periodic, deliberate exploration (and was exercised at three different seeds and iteration counts — 5,000/50,000 at seed 42, 20,000 each at two other seeds — totaling 90,000+ fuzzed inputs across this milestone, well beyond the single run that found the depth bug) rather than being gated on every commit.

## What this doesn't cover

- **Only the `tokenize`/`parse`/`compile` pipeline entry point** — not `generateFragmentShaderMapped`/codegen (which only ever receives already-validated compiler output, not arbitrary strings) and not the WebGL runtime (`mount()`, which requires a real browser context this Node-based fuzzer doesn't have — see `docs/architecture/integration-testing.md` for how the runtime is validated instead).
- **Not coverage-guided.** A more sophisticated fuzzer (e.g. using `libFuzzer`-style coverage feedback to steer mutation toward under-explored code paths) would likely find bugs faster or find different classes of bug than this corpus-mutation approach; that's a real capability gap versus a production fuzzing setup, accepted here given the scope decision above.
- **No automated minimization/shrinking** of a failing input to a minimal reproducing case — a library like `fast-check` would provide this; here, investigating a crash means reading the full (possibly large) mutated input directly from the fuzzer's reported output.
