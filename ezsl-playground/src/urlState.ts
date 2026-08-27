/**
 * Shareable shader URLs — the v1.0.x Ecosystem Launch "Online Playground"
 * sub-item. The shader's `.ezsl` source is encoded into the URL fragment
 * (`#shader=<base64>`), never sent to any server — a plain, static-hosted
 * page can support "shareable URLs" with zero backend, since the fragment
 * portion of a URL is never transmitted in an HTTP request (only
 * available to client-side JS via `location.hash`). See
 * docs/architecture/online-playground.md for why base64-without-compression
 * was chosen over a compressed encoding.
 *
 * Base64-encoding a UTF-8 string directly with `btoa` fails on any
 * character outside Latin1 (`btoa` operates on UTF-16 code units, not
 * bytes) — EZSL source is plain ASCII in every real example so far, but a
 * shader author could still type a non-ASCII character in a comment.
 * `encodeUriComponent`/`decodeURIComponent` round-tripped through
 * `btoa`/`atob` is the standard, well-known workaround (turns arbitrary
 * Unicode into a byte sequence `btoa` can actually handle) — used here
 * defensively even though today's presets/examples are all ASCII.
 */

const HASH_PREFIX = "#shader=";

export function encodeShaderForUrl(source: string): string {
  const bytes = encodeURIComponent(source).replace(/%([0-9A-F]{2})/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));
  return btoa(bytes);
}

export function decodeShaderFromUrl(encoded: string): string {
  const bytes = atob(encoded);
  const percentEncoded = Array.from(bytes)
    .map((char) => `%${char.charCodeAt(0).toString(16).padStart(2, "0")}`)
    .join("");
  return decodeURIComponent(percentEncoded);
}

/** Reads the current page URL's `#shader=` fragment, if present, and decodes it. Returns `null` if there's no shader in the URL, or if decoding fails (a malformed/truncated share link — treated as "no shader," not an error, since falling back to the default example is the friendlier failure mode). */
export function readShaderFromLocation(): string | null {
  const hash = window.location.hash;
  if (!hash.startsWith(HASH_PREFIX)) return null;
  const encoded = hash.slice(HASH_PREFIX.length);
  if (!encoded) return null;
  try {
    return decodeShaderFromUrl(encoded);
  } catch {
    return null;
  }
}

/** Builds a full, shareable URL for `source`, based on the current page's own URL (origin + pathname, discarding any existing fragment/query). */
export function buildShareUrl(source: string): string {
  const url = new URL(window.location.href);
  url.hash = HASH_PREFIX + encodeShaderForUrl(source);
  return url.toString();
}

/** Updates the current page's URL fragment to reflect `source`, without adding a new browser-history entry (every keystroke updating the URL would otherwise spam the back button) — see docs/architecture/online-playground.md. */
export function updateLocationForShader(source: string): void {
  const url = new URL(window.location.href);
  url.hash = HASH_PREFIX + encodeShaderForUrl(source);
  window.history.replaceState(null, "", url.toString());
}
