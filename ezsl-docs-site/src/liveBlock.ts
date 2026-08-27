import { EditorView, keymap, lineNumbers } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { cpp } from "@codemirror/lang-cpp";
import { oneDark } from "@codemirror/theme-one-dark";
import { createRecompiler } from "./compiler.js";

/**
 * Mounts a live-editable EZSL code block — the v1.0.x Ecosystem Launch
 * "Live-editable code blocks embedded in every doc page" deliverable.
 * Given a `<div>` container (produced by the Markdown renderer for every
 * fenced ```ezsl code block — see markdownRenderer.ts) and the block's
 * original source text, replaces the container's contents with a real
 * CodeMirror editor plus a small live WebGL2 preview canvas, using the
 * same shared `createRecompiler` (150ms debounced recompile,
 * `swapProgram`-based hot-swap rather than destroy-and-remount, an error
 * overlay that leaves the previous frame showing) the full Playground
 * page (`playgroundPage.ts`) uses — see docs/architecture/unified-site-v2.md.
 * This widget is deliberately smaller than the full Playground: no split
 * GLSL panel, no gallery, no share-URL — just "edit this snippet and see
 * it run" inline on the doc page you're reading.
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

  function showError(text: string): void {
    errorOverlay.textContent = text;
    errorOverlay.style.display = "block";
  }
  function hideError(): void {
    errorOverlay.style.display = "none";
  }

  const { recompile, scheduleRecompile } = createRecompiler({
    canvas,
    onError: showError,
    onSuccess: hideError,
  });

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
