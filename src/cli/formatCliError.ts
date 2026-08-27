import { LexError } from "../lexer/tokenizer.js";
import { ParseError } from "../parser/parser.js";
import { CompileError } from "../compiler/compile.js";

/**
 * Pretty-prints a `LexError`/`ParseError`/`CompileError` (the three
 * exceptions the pure `tokenize -> parse -> compile` pipeline can throw)
 * as a source-snippet-plus-caret block, in the same visual style as
 * `src/errors/printer.ts`'s `formatDiagnostic` (v0.4) — but for EZSL-side
 * syntax/type errors caught before any GLSL text or WebGL driver is
 * involved, which `formatDiagnostic` doesn't cover (it only formats
 * *driver* diagnostics, translated from a WebGL compile log). The CLI
 * (`ezsl build`/`check`) never has a WebGL context, so this is the only
 * error class it can ever actually throw — see docs/architecture/cli.md.
 */
export function formatCliError(error: LexError | ParseError | CompileError, source: string, fileLabel: string): string {
  const lines: string[] = [];
  lines.push(`error in ${fileLabel} at ${error.line}:${error.column}`);

  const sourceLines = source.split("\n");
  const snippet = sourceLines[error.line - 1];
  if (snippet !== undefined) {
    const lineNumberLabel = `${error.line} | `;
    lines.push(`${lineNumberLabel}${snippet}`);
    const caretOffset = Math.max(0, error.column - 1);
    lines.push(`${" ".repeat(lineNumberLabel.length + caretOffset)}^`);
  }

  lines.push("");
  lines.push(error.message);

  return lines.join("\n");
}

/** True for any error the pure compile pipeline (no WebGL context involved) can throw. */
export function isEzslPipelineError(error: unknown): error is LexError | ParseError | CompileError {
  return error instanceof LexError || error instanceof ParseError || error instanceof CompileError;
}
