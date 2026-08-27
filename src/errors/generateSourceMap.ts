import { encodeVlqSegment } from "./vlq.js";
import type { SourceMap } from "../codegen/glslGenerator.js";

/** A Source Map v3 document (https://sourcemaps.info/spec.html) — the standard format browser DevTools consume natively. */
export interface SourceMapV3 {
  version: 3;
  sources: string[];
  sourcesContent?: (string | null)[];
  names: string[];
  mappings: string;
}

/**
 * Converts EZSL's existing GLSL-line -> `.ezsl`-line `SourceMap` (built
 * during codegen — see `src/codegen/glslGenerator.ts`, consumed since v0.4
 * by `translateShaderError`'s own custom pretty-printer) into a standard
 * Source Map v3 JSON document, so a **real** browser DevTools Sources panel
 * (or a stack-trace frame carrying a `//# sourceMappingURL=`) can resolve a
 * generated-GLSL line back to `.ezsl` source natively — see
 * docs/architecture/devtools-source-maps.md for why this is a distinct
 * mechanism from the v0.4 error-translation layer rather than a
 * replacement for it (they serve different consumers: a human reading a
 * printed error block vs. DevTools' own UI).
 *
 * Source Map v3 mappings are column-granular and reference generated-code
 * *columns*, but EZSL's `SourceMap` is line-granular (a whole GLSL line
 * maps to a whole `.ezsl` line, never a sub-line span — GLSL codegen never
 * emits more than one EZSL-attributable statement per generated line, see
 * `emitStatementsInScope` in `src/compiler/compile.ts`). Each mapped line
 * therefore gets exactly one segment, always at generated-column 0,
 * pointing at `.ezsl`:`line`:`0` — a coarser mapping than a JS bundler's
 * (which maps every token), but a faithful, honest one: it never claims
 * column-level precision EZSL's own compiler doesn't track.
 *
 * `ezslUrl` should be the `.ezsl` file's real, network-resolvable URL (e.g.
 * `new URL("./shader.ezsl", import.meta.url).href` under Vite, which
 * serves `?raw`-imported files at a real dev-server path) — DevTools can
 * only open/display a source it can actually fetch. `ezslSource` (the
 * original `.ezsl` text) is embedded as `sourcesContent` so the mapped
 * source is viewable even if the URL becomes unreachable later (a closed
 * dev server, a production build) — the same reason JS bundlers embed it.
 */
export function generateEzslSourceMap(sourceMap: SourceMap, ezslUrl: string, ezslSource: string): SourceMapV3 {
  const maxGlslLine = Math.max(0, ...sourceMap.keys());
  const segments: string[] = [];

  // Source Map v3's mappings field encodes one semicolon-separated group per
  // *generated* line (1 per GLSL line here), each containing zero or more
  // comma-separated segments for that line's mapped positions. Fields
  // within a segment are deltas from the previous segment's corresponding
  // field (VLQ's whole reason to exist) — tracked as running totals below,
  // per the spec, not reset per line except for the generated-column field
  // (which resets to 0 each line since there's always exactly one segment
  // at column 0 or no segment at all).
  let prevSourceLine = 0;
  let prevSourceColumn = 0;

  for (let glslLine = 1; glslLine <= maxGlslLine; glslLine++) {
    const ezslLine = sourceMap.get(glslLine);
    if (ezslLine === null || ezslLine === undefined) {
      segments.push("");
      continue;
    }
    // Segment fields: [generatedColumn, sourceIndex, sourceLine, sourceColumn].
    // generatedColumn is always 0 (line-granular mapping, see above);
    // sourceIndex is always 0 (exactly one source file per shader);
    // sourceLine/sourceColumn are 0-based deltas per spec (EZSL's own line
    // numbers are 1-based, hence the -1 below).
    const sourceLine0 = ezslLine - 1;
    const sourceColumn0 = 0;
    const segment = encodeVlqSegment([0, 0, sourceLine0 - prevSourceLine, sourceColumn0 - prevSourceColumn]);
    prevSourceLine = sourceLine0;
    prevSourceColumn = sourceColumn0;
    segments.push(segment);
  }

  return {
    version: 3,
    sources: [ezslUrl],
    sourcesContent: [ezslSource],
    names: [],
    mappings: segments.join(";"),
  };
}

/** Renders a `SourceMapV3` as a `//# sourceMappingURL=data:...` comment line, appendable to the end of generated GLSL text. */
export function sourceMapComment(map: SourceMapV3): string {
  const json = JSON.stringify(map);
  const base64 = typeof Buffer !== "undefined" ? Buffer.from(json, "utf-8").toString("base64") : btoa(json);
  return `//# sourceMappingURL=data:application/json;charset=utf-8;base64,${base64}`;
}
