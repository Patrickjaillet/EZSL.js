/**
 * A single parsed diagnostic line from a WebGL shader compile/link log.
 * See docs/architecture/error-translation.md for the overall design and
 * why matching is structural (regex on the line's shape) rather than
 * matching driver vendors' exact wording, which varies across GPUs.
 */
export interface ParsedDiagnostic {
  /** 1-based GLSL source line the driver reported, or `null` if the log line didn't carry one. */
  glslLine: number | null;
  /** The single quoted token the driver flagged, if the message included one (e.g. `'half'`). */
  token: string | null;
  /** The driver's own message text, with the leading `ERROR:`/`WARNING:` + location prefix stripped. */
  message: string;
  severity: "error" | "warning";
  /** The raw, unparsed log line — kept so a diagnostic that didn't match any known dictionary entry can still be shown verbatim. */ raw: string;
}

// ANGLE (Chrome/Firefox/Edge on all platforms via ANGLE, and most native GLSL ES
// drivers) reports diagnostics as: `ERROR: 0:19: 'half' : Illegal use of reserved word`
// — "0" is a source-string index (always 0 here, since EZSL only ever compiles a
// single source string per shader), then the 1-based line number, then an optional
// single-quoted offending token, then the message. WARNING: lines use the same shape.
const ANGLE_DIAGNOSTIC = /^(ERROR|WARNING):\s*\d+:(\d+):\s*(?:'([^']*)'\s*:\s*)?(.*)$/;

/**
 * Parses a raw WebGL shader/program info log (as returned by
 * `gl.getShaderInfoLog`/`gl.getProgramInfoLog`) into structured diagnostics.
 * Unrecognized lines (blank lines, a trailing null-byte some drivers emit,
 * or a driver using a wildly different log format) are silently skipped —
 * this is a best-effort parse for translation, not a strict grammar; a
 * diagnostic that fails to parse simply isn't translated, and the raw log
 * remains available as a fallback (see docs/architecture/error-translation.md).
 */
export function parseCompileLog(log: string): ParsedDiagnostic[] {
  const diagnostics: ParsedDiagnostic[] = [];
  for (const rawLine of log.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;
    const match = ANGLE_DIAGNOSTIC.exec(line);
    if (!match) continue;
    const [, severityWord, lineNumber, token, message] = match;
    diagnostics.push({
      glslLine: Number(lineNumber),
      token: token || null,
      message: message.trim(),
      severity: severityWord === "ERROR" ? "error" : "warning",
      raw: line,
    });
  }
  return diagnostics;
}
