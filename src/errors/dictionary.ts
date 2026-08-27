import type { ParsedDiagnostic } from "./parseCompileLog.js";
import { didYouMean } from "../compiler/didYouMean.js";

/** A beginner-friendly translation of a driver diagnostic, matched structurally — see docs/architecture/error-translation.md. */
export interface TranslatedDiagnostic {
  original: ParsedDiagnostic;
  /** Plain-English explanation of what the driver message means. */
  explanation: string;
  /** A concrete suggested fix, when one can be given generically. */
  suggestion: string | null;
}

interface DictionaryEntry {
  /**
   * Matches against `ParsedDiagnostic.message` — note this is *just* the
   * driver's trailing message text; the location prefix (`ERROR: 0:19:`)
   * and any single-quoted offending token (`'half' :`) have already been
   * extracted into `ParsedDiagnostic.glslLine`/`.token` by `parseCompileLog`
   * and are *not* part of `message` — use `diagnostic.token` in `explain`,
   * don't try to re-capture it from `message`.
   */
  pattern: RegExp;
  explain(
    match: RegExpMatchArray,
    diagnostic: ParsedDiagnostic,
    knownNames: readonly string[],
  ): { explanation: string; suggestion: string | null };
}

/**
 * Structural pattern -> explanation table. Matches on the *shape* of the
 * driver's message (keywords, regex-captured operand types), not on exact
 * wording — NVIDIA/AMD/Intel/Apple Silicon phrase the same underlying error
 * differently (this is the documented v0.4 trap in ROADMAP.md), so literal
 * string matching would silently fail to translate on a subset of the
 * dictionary's own target machines. Every entry here has been matched
 * against ANGLE's actual phrasing (the driver Chrome/Firefox/Edge use on
 * all platforms) — see docs/architecture/error-translation.md for which
 * entries are ANGLE-verified vs. best-effort for other drivers.
 */
const DICTIONARY: DictionaryEntry[] = [
  {
    pattern: /^undeclared identifier$/,
    explain: (_m, d, knownNames) => {
      const name = d.token ?? "this name";
      const suggestion = d.token ? didYouMean(d.token, knownNames) : null;
      return {
        explanation: `GLSL doesn't recognize the name '${name}'. In EZSL terms, this usually means a variable or uniform was referenced before it was ever assigned, or a typo in a builtin/function name slipped through EZSL compilation into raw GLSL (most often inside a glsl { ... } Escape Hatch block, which EZSL can't type-check).`,
        suggestion: suggestion
          ? `Did you mean '${suggestion}'? (Checked against the EZSL names known to be in scope at this point in the program.)`
          : `Check the spelling of '${name}', and if it's meant to be an EZSL variable, make sure it's assigned before this point in the .ezsl source.`,
      };
    },
  },
  {
    pattern: /^Illegal use of reserved word$/,
    explain: (_m, d) => {
      const name = d.token ?? "this word";
      return {
        explanation: `'${name}' is a reserved word in GLSL — it can't be used as a variable, function, or type name, even though it isn't reserved in EZSL or JavaScript.`,
        suggestion: `Rename '${name}' to something else. Note: EZSL now rejects known reserved words like this one at compile time for ordinary EZSL variables — this error path is most likely coming from a glsl { ... } Escape Hatch block, which isn't checked.`,
      };
    },
  },
  {
    pattern: /^no matching overloaded function found$/,
    explain: (_m, d) => {
      const name = d.token ?? "this function";
      return {
        explanation: `GLSL couldn't find a version of '${name}' that accepts the argument types you passed. This usually means a type mismatch — e.g. passing a vec2 where a vec3 was expected, or calling a function with the wrong number of arguments.`,
        suggestion: `Double-check the types and count of arguments passed to '${name}' against its expected signature.`,
      };
    },
  },
  {
    pattern: /^(?:dimension mismatch|wrong operand types)/,
    explain: (_m, d) => {
      const op = d.token ?? "the operator";
      return {
        explanation: `The two sides of '${op}' don't have compatible shapes — for example, adding a vec3 to a vec2 (or assigning one to the other) isn't allowed in GLSL, unlike some other languages that would auto-pad or truncate.`,
        suggestion: "Make both sides the same vector/scalar type — extend the shorter one with an explicit constructor (e.g. vec3(v2, 0.0)) or extract the components you need with a swizzle.",
      };
    },
  },
  {
    pattern: /^syntax error$/,
    explain: (_m, d) => ({
      explanation: d.token
        ? `The GLSL parser hit unexpected input at or near '${d.token}'. If this line came from a glsl { ... } Escape Hatch block, the raw GLSL inside it has a syntax mistake (missing semicolon, unbalanced parenthesis, etc.) that EZSL cannot catch, since it doesn't parse Escape Hatch contents.`
        : "The GLSL parser hit unexpected input on this line. If this line came from a glsl { ... } Escape Hatch block, the raw GLSL inside it has a syntax mistake that EZSL cannot catch, since it doesn't parse Escape Hatch contents.",
      suggestion: "Check for a missing semicolon, unbalanced parenthesis/brace, or misplaced keyword on this line.",
    }),
  },
  {
    pattern: /^(?:function does not return a value|wrong type)/,
    explain: () => ({
      explanation: "A GLSL function's return statement doesn't produce the type the function is declared to return.",
      suggestion: "If this is from an EZSL fn, this shouldn't be possible — EZSL infers the return type from the function body. Please report this as a compiler bug if it occurs from ordinary EZSL source rather than a glsl { ... } block.",
    }),
  },
  {
    pattern: /^array index out of range /,
    explain: () => ({
      explanation: "A fixed-size array was indexed with a value outside its declared bounds. GLSL ES arrays don't grow or wrap — indexing past the end (or with a negative index) is a compile-time error when the index is a constant.",
      suggestion: "Check the array's declared size against every literal index used on it.",
    }),
  },
];

/**
 * Translates a parsed diagnostic using the structural dictionary above. A
 * diagnostic that matches no entry is returned with a generic fallback
 * explanation rather than `null` — the pretty-printer (see
 * `src/errors/printer.ts`) always has *something* to show, even if it's
 * just "no translation available, here's the raw driver message" alongside
 * the driver's own text, which is never hidden.
 *
 * `knownNames` — EZSL names (uniforms, locals, functions) in scope at the
 * point of the error, used by entries like `undeclared identifier` to offer
 * a "did you mean?" suggestion (ROADMAP.md v0.4 deliverable). Optional and
 * defaults to empty: the driver only ever reports *GLSL* identifiers, and
 * EZSL has no reliable way to recover which `.ezsl` names were in scope at
 * an arbitrary GLSL line without the caller supplying them — `mount()`
 * passes `Program.uniforms` automatically (see
 * `docs/architecture/error-translation.md`); a caller with richer scope
 * information (e.g. tooling with access to the compiler's `TypeScope`) can
 * pass a fuller list directly.
 */
export function translateDiagnostic(diagnostic: ParsedDiagnostic, knownNames: readonly string[] = []): TranslatedDiagnostic {
  for (const entry of DICTIONARY) {
    const match = diagnostic.message.match(entry.pattern);
    if (match) {
      const { explanation, suggestion } = entry.explain(match, diagnostic, knownNames);
      return { original: diagnostic, explanation, suggestion };
    }
  }
  return {
    original: diagnostic,
    explanation: `No plain-English translation is available for this driver message yet: "${diagnostic.message}"`,
    suggestion: null,
  };
}
