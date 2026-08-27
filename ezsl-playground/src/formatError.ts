import { LexError, ParseError, CompileError } from "@patrickjaillet/ezsl";

/**
 * Pretty-prints an EZSL-side `LexError`/`ParseError`/`CompileError` as a
 * source-snippet-plus-caret block — the same visual shape
 * `src/cli/formatCliError.ts` (in the main `ezsl` package) already uses
 * for the CLI, reimplemented locally here since that formatter is an
 * internal CLI module, not exported from the package root (`src/index.ts`
 * only re-exports the error *classes* themselves, not the CLI's own
 * pretty-printer). See docs/architecture/online-playground.md.
 */
export function formatEzslError(error: LexError | ParseError | CompileError, source: string): string {
  const lines: string[] = [];
  lines.push(`${error.name} at line ${error.line}, column ${error.column}`);

  const sourceLines = source.split("\n");
  const snippet = sourceLines[error.line - 1];
  if (snippet !== undefined) {
    const lineNumberLabel = `${error.line} | `;
    lines.push(`${lineNumberLabel}${snippet}`);
    const caretOffset = Math.max(0, error.column - 1);
    lines.push(`${" ".repeat(lineNumberLabel.length + caretOffset)}^`);
  }

  lines.push("");
  lines.push(error.message.replace(/^EZSL (lex|parse|compile) error at \d+:\d+: /, ""));

  return lines.join("\n");
}

export function isEzslPipelineError(error: unknown): error is LexError | ParseError | CompileError {
  return error instanceof LexError || error instanceof ParseError || error instanceof CompileError;
}
