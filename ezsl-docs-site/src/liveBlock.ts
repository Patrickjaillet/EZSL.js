import { EditorView, keymap, lineNumbers } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { cpp } from "@codemirror/lang-cpp";
import { oneDark } from "@codemirror/theme-one-dark";
import { compileEzsl, mount } from "@patrickjaillet/ezsl";
import type { EzslRuntimeHandle } from "@patrickjaillet/ezsl";
import { formatEzslError, isEzslPipelineError } from "./formatError.js";

/**
 * Mounts a live-editable EZSL code block — the v1.0.x Ecosystem Launch
 * "Live-editable code blocks embedded in every doc page" deliverable.
 * Given a `<div>` container (produced by the Markdown renderer for every
 * fenced ```ezsl code block — see markdownRenderer.ts) and the block's
 * original source text, replaces the container's contents with a real
 * CodeMirror editor plus a small live WebGL2 preview canvas, wired
 * together the same way `ezsl-playground`'s main editor is (150ms
 * debounced recompile, `swapProgram`-based hot-swap rather than
 * destroy-and-remount, an error overlay that leaves the previous frame
 * showing) — see docs/architecture/interactive-docs-site.md for why this
 * is a deliberately smaller, embeddable version of the same pattern
 * rather than a shared component imported from `ezsl-playground` (the
 * two packages are independent, and this widget has no split GLSL panel,
 * no gallery, no share-URL — just "edit this snippet and see it run").
 */
export function mountLiveBlock(container: HTMLElement, initialSource: string): void {
  container.classList.add("live-block");

  const editorHost = document.createElement("div");
  editorHost.className = "live-block-editor";

  const previewWrapper = document.createElement("div");
  previewWrapper.className = "live-block-preview";
  const canvas = document.createElement("canvas");
  canvas.width = 160;
  canvas.height = 160;
  const errorOverlay = document.createElement("pre");
  errorOverlay.className = "live-block-error";
  previewWrapper.appendChild(canvas);
  previewWrapper.appendChild(errorOverlay);

  container.replaceChildren(editorHost, previewWrapper);

  let runtimeHandle: EzslRuntimeHandle | null = null;
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;

  function showError(text: string): void {
    errorOverlay.textContent = text;
    errorOverlay.style.display = "block";
  }
  function hideError(): void {
    errorOverlay.style.display = "none";
  }

  function recompile(source: string): void {
    let program;
    try {
      program = compileEzsl(source);
    } catch (error) {
      if (isEzslPipelineError(error)) {
        showError(formatEzslError(error, source));
        return;
      }
      throw error;
    }

    try {
      if (runtimeHandle === null) {
        runtimeHandle = mount(canvas, program, { ezslSource: source });
      } else {
        runtimeHandle.swapProgram(program, { ezslSource: source });
      }
      hideError();
    } catch (err) {
      showError(err instanceof Error ? err.message : String(err));
    }
  }

  function scheduleRecompile(source: string): void {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => recompile(source), 150);
  }

  new EditorView({
    state: EditorState.create({
      doc: initialSource,
      extensions: [
        lineNumbers(),
        history(),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        cpp(),
        oneDark,
        EditorView.updateListener.of((update) => {
          if (update.docChanged) scheduleRecompile(update.state.doc.toString());
        }),
      ],
    }),
    parent: editorHost,
  });

  recompile(initialSource);
}

/** Finds every `<div class="ezsl-live-block" data-source="...">` placeholder the Markdown renderer produced on the page and mounts a real live block into each. */
export function mountAllLiveBlocks(root: ParentNode = document): void {
  const placeholders = Array.from(root.querySelectorAll<HTMLElement>(".ezsl-live-block"));
  for (const placeholder of placeholders) {
    const encodedSource = placeholder.dataset.source ?? "";
    const source = decodeURIComponent(encodedSource);
    mountLiveBlock(placeholder, source);
  }
}
