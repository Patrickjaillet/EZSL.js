import { encodeShaderForUrl, decodeShaderFromUrl } from "../src/urlState.js";

// `btoa`/`atob` are globally available in Node's own runtime (since
// Node 16+, no jsdom/polyfill needed) — these tests exercise the pure
// encode/decode logic directly; `readShaderFromLocation`/`buildShareUrl`/
// `updateLocationForShader` (the `window.location`-dependent half) are
// instead covered by the real-browser Playwright check in
// tests/playground.integration.mjs, since a DOM/window mock would be
// testing the mock, not the real browser behavior this feature depends on.
describe("encodeShaderForUrl / decodeShaderFromUrl", () => {
  it("round-trips a simple ASCII shader", () => {
    const source = "color = [uv.x, uv.y, 0.5]";
    expect(decodeShaderFromUrl(encodeShaderForUrl(source))).toBe(source);
  });

  it("round-trips a multi-line shader with comments", () => {
    const source = "// a comment\nd = length(uv - [0.5, 0.5])\ncolor = [d, d, d]\n";
    expect(decodeShaderFromUrl(encodeShaderForUrl(source))).toBe(source);
  });

  it("round-trips a shader containing non-ASCII characters (e.g. a Unicode comment)", () => {
    const source = "// café — test\ncolor = [1.0, 0.0, 0.0]";
    expect(decodeShaderFromUrl(encodeShaderForUrl(source))).toBe(source);
  });

  it("round-trips an empty string", () => {
    expect(decodeShaderFromUrl(encodeShaderForUrl(""))).toBe("");
  });

  it("produces a base64-safe string (no characters that would break a URL fragment)", () => {
    const encoded = encodeShaderForUrl("color = [1.0, 0.0, 0.0]\nglsl { /* raw */ }");
    expect(encoded).toMatch(/^[A-Za-z0-9+/=]+$/);
  });
});
