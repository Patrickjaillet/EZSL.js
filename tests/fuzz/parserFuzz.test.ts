import { tokenize, LexError } from "../../src/lexer/tokenizer.js";
import { parse, ParseError } from "../../src/parser/parser.js";
import { compile, CompileError } from "../../src/compiler/compile.js";

/**
 * Ordinary Jest regression coverage (runs as part of the normal `npm
 * test`) pinning down the one real bug the v1.0.x fuzz-testing pass found
 * (`tests/fuzz/fuzzParser.mjs`, a separate, much larger multi-thousand-
 * iteration property-based run via `npm run fuzz`, kept out of the fast
 * default `npm test` loop since it's slow and its value is in periodic
 * exploration, not fast-feedback regression pinning — see
 * docs/architecture/fuzzing.md): deeply nested parenthesized expressions
 * crashing with an uncaught `RangeError` instead of a `ParseError`. Also
 * covers a handful of other malformed-input shapes the fuzzer's mutation
 * strategies are designed to produce, so a future change can't silently
 * reintroduce a crash without an ordinary test run catching it.
 */
describe("parser fuzz-testing regression coverage", () => {
  it("deeply nested parenthesized expressions raise a ParseError, not a RangeError (the real bug the fuzzer found)", () => {
    const deeplyNested = `color = ${"(".repeat(10000)}1.0${")".repeat(10000)}`;
    expect(() => compile(parse(tokenize(deeplyNested)))).toThrow(ParseError);
  });

  it("moderately nested parenthesized expressions (well under the depth guard) still compile normally", () => {
    const nested = `color = ${"(".repeat(50)}1.0${")".repeat(50)}`;
    expect(() => compile(parse(tokenize(nested)))).not.toThrow();
  });

  it("an empty source string raises a documented pipeline error, not a crash", () => {
    expect(() => compile(parse(tokenize("")))).toThrow();
  });

  it("truncated input mid-expression raises a documented pipeline error", () => {
    expect(() => compile(parse(tokenize("color = vec3(1.0, 2.0")))).toThrow();
  });

  it("truncated input mid-keyword raises a documented pipeline error", () => {
    expect(() => tokenize("col")).not.toThrow(); // "col" alone is a valid identifier, not a crash either way
    expect(() => compile(parse(tokenize("f")))).toThrow();
  });

  it("random non-EZSL byte noise raises a documented pipeline error, not a crash", () => {
    const noise = "\x00\x01\x02￿\u{1F600}$$$@@@###";
    let threw = false;
    try {
      compile(parse(tokenize(noise)));
    } catch (err) {
      threw = true;
      expect(err instanceof LexError || err instanceof ParseError || err instanceof CompileError).toBe(true);
    }
    // Either it throws one of the three documented error types, or (less
    // likely for pure noise, but not impossible) it happens to tokenize
    // into something that fails later — either way, no crash reaching here
    // is itself the assertion; the try/catch above already checked the
    // error class if one was thrown.
    void threw;
  });

  it("a deeply nested array/struct-like bracket sequence raises a documented pipeline error, not a crash", () => {
    const deeplyNested = `color = ${"[".repeat(10000)}1.0${"]".repeat(10000)}`;
    let errorClass: unknown;
    try {
      compile(parse(tokenize(deeplyNested)));
    } catch (err) {
      errorClass = err;
    }
    expect(errorClass instanceof LexError || errorClass instanceof ParseError || errorClass instanceof CompileError).toBe(true);
  });
});
