import { Marked } from "marked";

/** Escapes the four HTML-meaningful characters marked's own default code renderer escapes, replicated here since overriding `code()` means providing the complete rendering ourselves for the non-EZSL fallback path too (marked has no "call the default renderer from inside my override" convention). */
function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * Renders Markdown to HTML, with one deliberate override: a fenced code
 * block tagged ```ezsl``` renders as a `<div class="ezsl-live-block"
 * data-source="...">` placeholder instead of an ordinary `<pre><code>`
 * block — `liveBlock.ts`'s `mountAllLiveBlocks()` finds these after the
 * page renders and replaces each with a real, editable, live-recompiling
 * CodeMirror + WebGL2 preview widget. Every other fenced code block
 * (```typescript```, ```bash```, etc.) renders as ordinary static
 * highlighted-text `<pre><code>`, unchanged — only EZSL source is meant
 * to be "live," matching how `docs/tutorials/*.md` already distinguishes
 * EZSL snippets (```ezsl```) from orchestration code (```typescript```)
 * via the fence's own language tag — see
 * docs/architecture/interactive-docs-site.md.
 */
/**
 * The content Markdown files link to each other with real, relative
 * filesystem-style paths (`./02-values-and-types.md`,
 * `../intermediate/three-js-scene.md`) — written that way deliberately,
 * so the same `.md` files also read correctly as plain Markdown outside
 * this site (e.g. on GitHub, or `docs/tutorials/*.md`'s existing
 * cross-links to `docs/architecture/*.md`, which this renderer leaves
 * completely alone — only a link ending in `.md` gets rewritten). Inside
 * this site, navigation is hash-route-based (`#/<slug>`, see main.ts), so
 * any link target ending in `.md` is rewritten to `#/<basename-without-extension>`
 * here — e.g. `./02-values-and-types.md` -> `#/02-values-and-types`, then
 * further stripped of its numeric prefix to match the real page slugs in
 * pages.ts (`values-and-types`, not `02-values-and-types`).
 */
export function rewriteMarkdownLinkToHashRoute(href: string): string {
  if (!href.endsWith(".md") && !href.includes(".md#")) return href;
  const withoutAnchor = href.split("#")[0];
  const basename = withoutAnchor.split("/").pop() ?? withoutAnchor;
  const withoutExtension = basename.replace(/\.md$/, "");
  const slug = withoutExtension.replace(/^\d+-/, "");
  return `#/${slug}`;
}

export function renderMarkdown(markdown: string): string {
  const marked = new Marked({
    renderer: {
      link({ href, title, tokens }) {
        const rewritten = rewriteMarkdownLinkToHashRoute(href);
        const text = this.parser.parseInline(tokens);
        const titleAttr = title ? ` title="${title}"` : "";
        return `<a href="${rewritten}"${titleAttr}>${text}</a>`;
      },
      code({ text, lang }) {
        if (lang === "ezsl") {
          const encoded = encodeURIComponent(text);
          return `<div class="ezsl-live-block" data-source="${encoded}"></div>\n`;
        }
        // Replicate marked's own default code-block rendering for every
        // other language (```typescript```, ```bash```, etc.) — marked's
        // renderer-override API has no "defer to the built-in renderer"
        // escape hatch, so the fallback path is reproduced directly here.
        const langString = (lang || "").match(/^\S*/)?.[0];
        const code = text.replace(/\n$/, "") + "\n";
        if (!langString) {
          return `<pre><code>${escapeHtml(code)}</code></pre>\n`;
        }
        return `<pre><code class="language-${escapeHtml(langString)}">${escapeHtml(code)}</code></pre>\n`;
      },
    },
  });

  return marked.parse(markdown, { async: false }) as string;
}
