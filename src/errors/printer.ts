import type { TranslatedDiagnostic } from "./dictionary.js";

/**
 * Renders a single translated diagnostic as a multi-line, human-readable
 * block: severity + location, a source snippet with a caret pointing at
 * the offending line, the plain-English explanation, a suggested fix (if
 * any), and the original driver text (never hidden — see
 * docs/architecture/error-translation.md on why raw text always survives
 * alongside a translation, since the dictionary can't cover every driver
 * message).
 *
 * `ezslSource` is the original `.ezsl` source text; `ezslLine` is the
 * looked-up `.ezsl` line (via the codegen source map), or `null` if the
 * diagnostic's GLSL line couldn't be mapped back (e.g. it's inside
 * boilerplate or a `glsl { ... }` Escape Hatch block whose raw contents
 * aren't further mapped line-by-line — see docs/architecture/escape-hatch.md).
 */
export function formatDiagnostic(diagnostic: TranslatedDiagnostic, ezslSource: string, ezslLine: number | null): string {
  const { original, explanation, suggestion } = diagnostic;
  const lines: string[] = [];

  const location = ezslLine !== null ? `.ezsl:${ezslLine}` : `GLSL:${original.glslLine ?? "?"} (no .ezsl source line found)`;
  lines.push(`${original.severity === "error" ? "error" : "warning"} at ${location}`);

  if (ezslLine !== null) {
    const sourceLines = ezslSource.split("\n");
    const snippet = sourceLines[ezslLine - 1];
    if (snippet !== undefined) {
      const lineNumberLabel = `${ezslLine} | `;
      lines.push(`${lineNumberLabel}${snippet}`);
      lines.push(`${" ".repeat(lineNumberLabel.length)}${"^".repeat(Math.max(1, snippet.trimEnd().length))}`);
    }
  }

  lines.push("");
  lines.push(explanation);
  if (suggestion) {
    lines.push("");
    lines.push(`Suggestion: ${suggestion}`);
  }
  lines.push("");
  lines.push(`Driver message: ${original.raw}`);

  return lines.join("\n");
}

/** Formats a full list of translated diagnostics for console output, in order, separated by a blank line. */
export function formatDiagnostics(
  diagnostics: TranslatedDiagnostic[],
  ezslSource: string,
  lineForGlsl: (glslLine: number | null) => number | null,
): string {
  return diagnostics.map((d) => formatDiagnostic(d, ezslSource, lineForGlsl(d.original.glslLine))).join("\n\n");
}
