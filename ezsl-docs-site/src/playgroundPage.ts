import { EditorView, keymap, lineNumbers } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { cpp } from "@codemirror/lang-cpp";
import { oneDark } from "@codemirror/theme-one-dark";
import { createRecompiler } from "./compiler.js";
import { updateLocationForShader, buildShareUrl } from "./urlState.js";
import { GALLERY, type GalleryCategory } from "./gallery.js";

const DEFAULT_SHADER = `// Welcome to the EZSL.js Playground — edit and watch it recompile live.
color = [uv.x, uv.y, 0.5 + 0.5 * sin(time)]
`;

const CATEGORY_ORDER: GalleryCategory[] = ["Patterns", "Noise & Procedural", "Raymarching", "Color & Animation", "SDF Techniques"];

/**
 * Renders the Shadertoy-style shader editor — the site's flagship
 * "create your own shaders" page (`#/playground`, optionally
 * `#/playground/<base64>` for a shared shader). This is the merged,
 * restyled successor to the standalone `ezsl-playground` package — see
 * docs/architecture/unified-site-v2.md for why that package was folded
 * into this site rather than kept separate (it had no CI/deploy of its
 * own, and its editor/gallery/share-URL/error-formatting logic largely
 * duplicated what this site's live-code-blocks already did).
 */
export function renderPlaygroundPage(container: HTMLElement, initialSource: string | null): void {
  const source = initialSource ?? DEFAULT_SHADER;

  container.innerHTML = "";
  const app = document.createElement("div");
  app.id = "playground-app";

  const header = document.createElement("div");
  header.id = "playground-header";
  header.innerHTML = `
    <h1>Playground</h1>
    <button class="btn btn-ghost" id="gallery-toggle">Gallery</button>
    <div class="spacer"></div>
    <span id="share-status"></span>
    <button class="btn btn-primary" id="share-button">Copy Share Link</button>
  `;

  const main = document.createElement("div");
  main.id = "playground-main";
  main.innerHTML = `
    <div id="gallery-panel">
      <div class="panel-label">Gallery (curated examples)</div>
      <div id="gallery-list"></div>
    </div>
    <div class="pg-panel">
      <div class="panel-label">EZSL source</div>
      <div id="ezsl-editor"></div>
    </div>
    <div class="pg-panel">
      <div class="panel-label">Generated GLSL</div>
      <pre id="glsl-output"></pre>
    </div>
    <div class="pg-panel pg-preview-panel">
      <div class="panel-label">Live preview</div>
      <canvas id="preview-canvas"></canvas>
      <pre id="error-overlay"></pre>
    </div>
  `;

  app.appendChild(header);
  app.appendChild(main);
  container.appendChild(app);

  const editorHost = document.getElementById("ezsl-editor")!;
  const glslOutput = document.getElementById("glsl-output")!;
  const canvas = document.getElementById("preview-canvas") as HTMLCanvasElement;
  const errorOverlay = document.getElementById("error-overlay")!;
  const shareButton = document.getElementById("share-button") as HTMLButtonElement;
  const shareStatus = document.getElementById("share-status")!;
  const galleryPanel = document.getElementById("gallery-panel")!;
  const galleryList = document.getElementById("gallery-list")!;
  const galleryToggle = document.getElementById("gallery-toggle") as HTMLButtonElement;

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

  const { recompile, scheduleRecompile } = createRecompiler({
    canvas,
    onError: showError,
    onSuccess: hideError,
    onGlslOutput: (glsl) => {
      glslOutput.textContent = glsl;
    },
  });

  const editorView = new EditorView({
    state: EditorState.create({
      doc: source,
      extensions: [
        lineNumbers(),
        history(),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        cpp(),
        oneDark,
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            const newSource = update.state.doc.toString();
            scheduleRecompile(newSource);
            updateLocationForShader(newSource);
            highlightActiveGalleryItem(newSource);
          }
        }),
      ],
    }),
    parent: editorHost,
  });

  function loadShaderIntoEditor(newSource: string): void {
    editorView.dispatch({
      changes: { from: 0, to: editorView.state.doc.length, insert: newSource },
    });
    // dispatch() above already triggers the updateListener (docChanged),
    // which schedules a debounced recompile — no need to call recompile()
    // directly here, keeping exactly one path that reacts to editor content
    // changes regardless of whether they came from typing or a gallery click.
  }

  function highlightActiveGalleryItem(currentSource: string): void {
    for (const el of Array.from(galleryList.children)) {
      const item = el as HTMLElement;
      if (item.dataset.source !== undefined) {
        item.classList.toggle("active", item.dataset.source === currentSource);
      }
    }
  }

  for (const category of CATEGORY_ORDER) {
    const entries = GALLERY.filter((e) => e.category === category);
    if (entries.length === 0) continue;

    const heading = document.createElement("div");
    heading.className = "gallery-category-heading";
    heading.textContent = category;
    galleryList.appendChild(heading);

    for (const entry of entries) {
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
  }
  highlightActiveGalleryItem(source);

  galleryToggle.addEventListener("click", () => {
    galleryPanel.classList.toggle("collapsed");
  });

  shareButton.addEventListener("click", () => {
    const shaderSource = editorView.state.doc.toString();
    const url = buildShareUrl(shaderSource);
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
  recompile(source);
}
