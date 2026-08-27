import { compileEzsl, mount, generateFragmentShaderMapped } from "@patrickjaillet/ezsl";
import type { EzslRuntimeHandle } from "@patrickjaillet/ezsl";
import { formatEzslError, isEzslPipelineError } from "./formatError.js";

const RECOMPILE_DEBOUNCE_MS = 150;

export interface RecompileTarget {
  canvas: HTMLCanvasElement;
  onError(text: string): void;
  onSuccess(): void;
  /** Only the full Playground page needs this — inline live blocks have no GLSL split-view. */
  onGlslOutput?(glsl: string): void;
}

export interface Recompiler {
  recompile(source: string): void;
  scheduleRecompile(source: string): void;
}

/**
 * The shared "compile -> format-error-on-failure -> mount-or-swapProgram"
 * state machine — extracted from what was, before this, two independent
 * near-identical implementations: liveBlock.ts's inline-snippet widget and
 * ezsl-playground's full editor page (now merged into this site's
 * Playground route — see docs/architecture/unified-site-v2.md). Both
 * follow the same three-step shape `ezsl dev`'s own client script uses
 * (see docs/architecture/dev-server.md): a LexError/ParseError/CompileError
 * shows a formatted overlay and stops, leaving the last-good frame
 * showing; a successful compile mounts (first time) or hot-swaps via
 * swapProgram (every later time) rather than destroy-and-remount, to avoid
 * exhausting the browser's live-WebGL-context budget and to avoid
 * resetting the `time` uniform on every keystroke.
 */
export function createRecompiler(target: RecompileTarget): Recompiler {
  let runtimeHandle: EzslRuntimeHandle | null = null;
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;

  function recompile(source: string): void {
    let program;
    try {
      program = compileEzsl(source);
    } catch (error) {
      if (isEzslPipelineError(error)) {
        target.onError(formatEzslError(error, source));
        return;
      }
      throw error;
    }

    if (target.onGlslOutput) {
      target.onGlslOutput(generateFragmentShaderMapped(program).source);
    }

    try {
      if (runtimeHandle === null) {
        runtimeHandle = mount(target.canvas, program, { ezslSource: source });
      } else {
        runtimeHandle.swapProgram(program, { ezslSource: source });
      }
      target.onSuccess();
    } catch (err) {
      target.onError(err instanceof Error ? err.message : String(err));
    }
  }

  function scheduleRecompile(source: string): void {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => recompile(source), RECOMPILE_DEBOUNCE_MS);
  }

  return { recompile, scheduleRecompile };
}
