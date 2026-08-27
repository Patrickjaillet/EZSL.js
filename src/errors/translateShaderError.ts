import { parseCompileLog } from "./parseCompileLog.js";
import { translateDiagnostic } from "./dictionary.js";
import { formatDiagnostics } from "./printer.js";
import type { SourceMap } from "../codegen/glslGenerator.js";

/**
 * Full v0.4 error-translation pipeline: a raw WebGL shader/program info log
 * -> parsed diagnostics -> dictionary-translated explanations -> GLSL line
 * mapped back to `.ezsl` line via the codegen source map -> a pretty-printed
 * console string. See docs/architecture/error-translation.md.
 *
 * `knownNames` (optional): EZSL names in scope, forwarded to
 * `translateDiagnostic` for "did you mean?" suggestions — see its own doc
 * comment for why this can't be recovered automatically from the GLSL log
 * alone. `mount()` passes `Program.uniforms` here automatically.
 */
export function translateShaderError(
  rawLog: string,
  ezslSource: string,
  sourceMap: SourceMap,
  knownNames: readonly string[] = [],
): string {
  const diagnostics = parseCompileLog(rawLog);

  if (diagnostics.length === 0) {
    // The log didn't match the expected ANGLE-style shape at all (an
    // unrecognized driver format) — fall back to showing it verbatim
    // rather than claiming there were no errors.
    return `(EZSL could not parse this driver's error format — showing it verbatim)\n\n${rawLog}`;
  }

  const translated = diagnostics.map((d) => translateDiagnostic(d, knownNames));
  return formatDiagnostics(translated, ezslSource, (glslLine) => (glslLine === null ? null : sourceMap.get(glslLine) ?? null));
}

export { parseCompileLog } from "./parseCompileLog.js";
export type { ParsedDiagnostic } from "./parseCompileLog.js";
export { translateDiagnostic } from "./dictionary.js";
export type { TranslatedDiagnostic } from "./dictionary.js";
export { formatDiagnostic, formatDiagnostics } from "./printer.js";
