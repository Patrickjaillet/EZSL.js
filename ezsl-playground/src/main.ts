import { EditorView, keymap, lineNumbers } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { cpp } from "@codemirror/lang-cpp";
import { oneDark } from "@codemirror/theme-one-dark";
import { compileEzsl, mount, generateFragmentShaderMapped } from "@patrickjaillet/ezsl";
import type { EzslRuntimeHandle } from "@patrickjaillet/ezsl";
import { formatEzslError, isEzslPipelineError } from "./formatError.js";
import { readShaderFromLocation, updateLocationForShader, buildShareUrl } from "./urlState.js";
import { GALLERY } from "./gallery.js";

const DEFAULT_SHADER = `// Welcome to the EZSL.js Playground — edit and watch it recompile live.
color = [uv.x, uv.y, 0.5 + 0.5 * sin(time)]
`;

const editorHost = document.getElementById("ezsl-editor")!;
const glslOutput = document.getElementById("glsl-output")!;
const canvas = document.getElementById("preview-canvas") as HTMLCanvasElement;
const errorOverlay = document.getElementById("error-overlay")!;
const shareButton = document.getElementById("share-button") as HTMLButtonElement;
const shareStatus = document.getElementById("share-status")!;
const galleryPanel = document.getElementById("gallery-panel")!;
const galleryList = document.getElementById("gallery-list")!;
const galleryToggle = document.getElementById("gallery-toggle") as HTMLButtonElement;

let runtimeHandle: EzslRuntimeHandle | null = null;
let debounceTimer: ReturnType<typeof setTimeout> | undefined;

function resizeCanvas(): void {
  const rect = canvas.getBoundingClientRect();
  canvas.width = Math.max(1, Math.round(rect.width));
  canvas.height = Math.max(1, Math.round(rect.height));
}

function showError(text: string): void {
  errorOverlay.textContent = text;
  errorOverlay.style.display = "block";
}
function hideError(): void {
  errorOverlay.style.display = "none";
}

/**
 * Recompiles `source` and updates the split-view GLSL panel + WebGL2
 * preview. On a compile-time (`LexError`/`ParseError`/`CompileError`)
 * failure, shows the formatted error and leaves the previous frame
 * rendering (mirroring `ezsl dev`'s own hot-swap error-handling — see
 * docs/architecture/dev-server.md) rather than blanking the canvas. On a
 * successful compile, (re)mounts via `mount()`'s handle if this is the
 * first successful compile, or hot-swaps into the existing handle via
 * `swapProgram()` on every later one, for the same reason `ezsl dev`
 * does: avoiding exhausting the browser's limited live-WebGL-context
 * budget by tearing down and re-mounting on every keystroke.
 */
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

  const { source: glsl } = generateFragmentShaderMapped(program);
  glslOutput.textContent = glsl;

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
  // 150ms debounce — fast enough to feel "real-time" (the roadmap's own
  // wording), slow enough that a full line of typing doesn't trigger a
  // recompile per keystroke.
  debounceTimer = setTimeout(() => {
    recompile(source);
    updateLocationForShader(source);
    highlightActiveGalleryItem(source);
  }, 150);
}

const initialSource = readShaderFromLocation() ?? DEFAULT_SHADER;

const editorView = new EditorView({
  state: EditorState.create({
    doc: initialSource,
    extensions: [
      lineNumbers(),
      history(),
      keymap.of([...defaultKeymap, ...historyKeymap]),
      cpp(),
      oneDark,
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          scheduleRecompile(update.state.doc.toString());
        }
      }),
    ],
  }),
  parent: editorHost,
});

/**
 * The curated gallery — see gallery.ts's own doc comment for why this is
 * a static, build-time list of already-validated `examples/` shaders
 * rather than a user-submission gallery (which needs a backend and
 * ongoing human moderation, out of scope for this milestone — see
 * docs/architecture/online-playground.md's "Scope" section).
 */
function loadShaderIntoEditor(source: string): void {
  editorView.dispatch({
    changes: { from: 0, to: editorView.state.doc.length, insert: source },
  });
  // dispatch() above already triggers the updateListener (docChanged),
  // which schedules a debounced recompile — no need to call recompile()
  // directly here, keeping exactly one path that reacts to editor content
  // changes regardless of whether they came from typing or a gallery click.
}

function highlightActiveGalleryItem(currentSource: string): void {
  for (const el of Array.from(galleryList.children)) {
    (el as HTMLElement).classList.toggle("active", (el as HTMLElement).dataset.source === currentSource);
  }
}

for (const entry of GALLERY) {
  const item = document.createElement("div");
  item.className = "gallery-item";
  item.textContent = entry.name;
  item.dataset.source = entry.source;
  item.addEventListener("click", () => {
    loadShaderIntoEditor(entry.source);
    highlightActiveGalleryItem(entry.source);
  });
  galleryList.appendChild(item);
}
highlightActiveGalleryItem(initialSource);

galleryToggle.addEventListener("click", () => {
  galleryPanel.classList.toggle("collapsed");
});

shareButton.addEventListener("click", () => {
  const source = editorView.state.doc.toString();
  const url = buildShareUrl(source);
  navigator.clipboard
    .writeText(url)
    .then(() => {
      shareStatus.textContent = "Link copied to clipboard!";
      setTimeout(() => (shareStatus.textContent = ""), 2000);
    })
    .catch(() => {
      shareStatus.textContent = url;
    });
});

window.addEventListener("resize", () => {
  resizeCanvas();
});

resizeCanvas();
recompile(initialSource);
