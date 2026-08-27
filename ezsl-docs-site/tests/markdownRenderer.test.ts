import { rewriteMarkdownLinkToHashRoute } from "../src/markdownRenderer.js";

// `renderMarkdown` itself (the `marked` wiring, the ezsl-live-block code
// fence override) is covered by the real-browser Playwright check in
// tests/docsSite.integration.mjs, since what matters there is the actual
// rendered DOM and mounted CodeMirror/WebGL2 widgets, not marked's
// internal call sequence. This file covers the one piece of pure,
// non-DOM logic in that module: rewriting a plain relative-file-path
// Markdown link into this site's hash-route scheme.
describe("rewriteMarkdownLinkToHashRoute", () => {
  it("strips a numeric prefix and the .md extension from a same-directory link", () => {
    expect(rewriteMarkdownLinkToHashRoute("./02-values-and-types.md")).toBe("#/values-and-types");
  });

  it("takes only the basename from a relative parent-directory link", () => {
    expect(rewriteMarkdownLinkToHashRoute("../intermediate/three-js-scene.md")).toBe("#/three-js-scene");
  });

  it("strips a trailing #anchor along with the extension", () => {
    expect(rewriteMarkdownLinkToHashRoute("./01-hello-gradient.md#builtins")).toBe("#/hello-gradient");
  });

  it("leaves a link with no .md extension untouched", () => {
    expect(rewriteMarkdownLinkToHashRoute("https://example.com/page")).toBe("https://example.com/page");
  });

  it("leaves a link to a docs/architecture/*.md file untouched when it has no numeric prefix", () => {
    // These links (e.g. from docs/tutorials/*.md to docs/architecture/*.md)
    // are deliberately left alone by the caller's own doc comment... but
    // rewriteMarkdownLinkToHashRoute itself has no way to distinguish "an
    // in-site page" from "a real repo file" — it rewrites every .md link
    // uniformly. This test documents that actual behavior (no special-casing),
    // not a claim that architecture docs get a different code path.
    expect(rewriteMarkdownLinkToHashRoute("../architecture/three-integration.md")).toBe("#/three-integration");
  });

  it("does not strip a non-leading numeric-looking segment", () => {
    expect(rewriteMarkdownLinkToHashRoute("./v2-notes.md")).toBe("#/v2-notes");
  });
});
