import { levenshteinDistance, didYouMean } from "../src/compiler/didYouMean.js";

describe("levenshteinDistance", () => {
  it("distance to itself is 0", () => expect(levenshteinDistance("sin", "sin")).toBe(0));
  it("distance from empty string is the other string's length", () => {
    expect(levenshteinDistance("", "abc")).toBe(3);
    expect(levenshteinDistance("abc", "")).toBe(3);
  });
  it("one substitution is distance 1", () => expect(levenshteinDistance("cat", "cot")).toBe(1));
  it("one insertion is distance 1", () => expect(levenshteinDistance("cat", "cats")).toBe(1));
  it("one deletion is distance 1", () => expect(levenshteinDistance("cats", "cat")).toBe(1));
  it("is case-sensitive (Sin vs sin is a real distance, not 0)", () => expect(levenshteinDistance("Sin", "sin")).toBe(1));
  it("completely different strings have a large distance", () => expect(levenshteinDistance("abc", "xyz")).toBe(3));
});

const BUILTIN_NAMES = [
  "sin", "cos", "tan", "atan", "sqrt", "length", "dot", "abs", "mix", "clamp",
  "smoothstep", "fract", "floor", "mod", "max", "min", "pow", "exp",
  "normalize", "cross", "reflect", "step",
];

describe("didYouMean", () => {
  const cases: [string, string | null][] = [
    ["sni", "sin"],
    ["smoothstp", "smoothstep"],
    ["lenght", "length"],
    ["nomalize", "normalize"],
    ["mx", "mix"],
    ["xyz", null],
    ["bogus", null],
    ["cosine", null],
    ["completelyUnrelatedName", null],
  ];
  for (const [typo, expected] of cases) {
    it(`'${typo}' -> ${expected === null ? "no suggestion" : `'${expected}'`}`, () => {
      expect(didYouMean(typo, BUILTIN_NAMES)).toBe(expected);
    });
  }

  it("returns null against an empty candidate list", () => {
    expect(didYouMean("sin", [])).toBeNull();
  });

  it("excludes an exact match from the candidate pool (only relevant if the misspelled name coincidentally equals a candidate)", () => {
    // didYouMean is only ever called on names that failed to resolve, so this
    // input shape doesn't occur in practice — this pins the exclusion behavior
    // itself: the exact-match candidate is skipped, not returned trivially.
    expect(didYouMean("sin", ["sin", "min"])).toBe("min");
  });

  it("picks the single closest candidate when multiple are somewhat close", () => {
    expect(didYouMean("mn", ["min", "max", "mod"])).toBe("min");
  });
});
