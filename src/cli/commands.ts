import { readFile, writeFile, watch as fsWatch } from "node:fs/promises";
import { dirname, basename, extname, join, relative } from "node:path";
import { compileEzsl, compileEzslVertex } from "../compiler/index.js";
import { generateFragmentShaderMapped, generateThreeVertexShaderMapped } from "../codegen/glslGenerator.js";
import { formatCliError, isEzslPipelineError } from "./formatCliError.js";

export interface CliOptions {
  /** Compile as a vertex-stage program (v0.6 Three.js — `position`/`normal`/camera-matrix builtins, `glPosition` output) instead of the default fragment stage. */
  vertex?: boolean;
}

/** Result of compiling one `.ezsl` file through the pure pipeline — never touches a WebGL context. */
export interface CompileFileResult {
  ok: boolean;
  /** Generated GLSL source, only present when `ok` is true. */
  glsl?: string;
  /** Pretty-printed error block (see `formatCliError`), only present when `ok` is false. */
  errorText?: string;
}

/** Compiles one `.ezsl` file's already-read source text to GLSL, catching only the pure-pipeline error classes (`LexError`/`ParseError`/`CompileError`) — anything else is a real bug and is rethrown. */
export function compileSourceToGlsl(source: string, fileLabel: string, options: CliOptions = {}): CompileFileResult {
  try {
    const glsl = options.vertex
      ? generateThreeVertexShaderMapped(compileEzslVertex(source)).source
      : generateFragmentShaderMapped(compileEzsl(source)).source;
    return { ok: true, glsl };
  } catch (error) {
    if (isEzslPipelineError(error)) {
      return { ok: false, errorText: formatCliError(error, source, fileLabel) };
    }
    throw error;
  }
}

function glslOutputPath(ezslPath: string): string {
  const dir = dirname(ezslPath);
  const base = basename(ezslPath, extname(ezslPath));
  return join(dir, `${base}.glsl`);
}

/**
 * `ezsl build <file.ezsl>`: compiles one file and writes `<name>.glsl` next
 * to it — the "inspectable GLSL output" the project's own design pillar
 * calls for (see CLAUDE.md's "Core design pillars"), not stdout or a
 * structured JSON blob (an explicit scope decision — see docs/architecture/cli.md).
 * Returns the exit code to use.
 */
export async function runBuild(ezslPath: string, options: CliOptions = {}): Promise<number> {
  const source = await readFile(ezslPath, "utf-8");
  const result = compileSourceToGlsl(source, ezslPath, options);
  if (!result.ok) {
    process.stderr.write(`${result.errorText}\n`);
    return 1;
  }
  const outPath = glslOutputPath(ezslPath);
  await writeFile(outPath, result.glsl ?? "", "utf-8");
  process.stdout.write(`${relative(process.cwd(), outPath)}\n`);
  return 0;
}

/**
 * `ezsl check <file.ezsl>`: compiles a file and reports success/failure
 * without writing anything — compilation only (`tokenize -> parse ->
 * compile -> codegen`), never a real WebGL2 link, so it never needs a
 * driver/browser context (see the CLI design doc's "compilation-only"
 * scope decision). Returns the exit code to use.
 */
export async function runCheck(ezslPath: string, options: CliOptions = {}): Promise<number> {
  const source = await readFile(ezslPath, "utf-8");
  const result = compileSourceToGlsl(source, ezslPath, options);
  if (!result.ok) {
    process.stderr.write(`${result.errorText}\n`);
    return 1;
  }
  process.stdout.write(`${ezslPath}: OK\n`);
  return 0;
}

/**
 * `ezsl watch <file.ezsl>`: re-runs `runBuild` on the given file every time
 * it changes on disk, until the process is interrupted (Ctrl+C) — the
 * "hot shader swapping" roadmap wording is about *this* file-watch loop,
 * not a browser-side live-reload transport (that's the separate "Live-reload
 * dev server" roadmap item, not yet built — see ROADMAP.md v0.7.x). A
 * compile error is printed and the watch loop continues rather than exiting,
 * since the whole point of watch mode is to keep running through edit
 * mistakes.
 */
export async function runWatch(ezslPath: string, options: CliOptions = {}): Promise<void> {
  const build = async () => {
    const code = await runBuild(ezslPath, options);
    if (code !== 0) {
      // runBuild already printed the error; keep watching regardless.
    }
  };

  await build();
  process.stdout.write(`watching ${ezslPath} for changes (Ctrl+C to stop)\n`);

  const watcher = fsWatch(ezslPath);
  for await (const event of watcher) {
    if (event.eventType === "change") {
      await build();
    }
  }
}
