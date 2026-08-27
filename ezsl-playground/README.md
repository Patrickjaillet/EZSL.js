# ezsl-playground

A browser-based [EZSL.js](../README.md) editor with live WebGL2 preview, a split view showing the generated GLSL alongside your source, and shareable shader URLs — no backend, fully static.

## Try it locally

```bash
npm install
npm run dev
```

Opens a Vite dev server. Edit the EZSL source; the generated GLSL and the live WebGL2 preview update automatically as you type. Click **Gallery** to browse and load 21 curated, already-validated example shaders — click one to load it into the editor.

## Shareable URLs

The current shader is always reflected in the page URL's fragment (`#shader=<base64>`) — copy the address bar, or click "Copy Share Link," and send it to anyone. Opening that URL restores the exact shader, with no server or database involved: the shader lives entirely in the URL.

## What's not here

The built-in gallery is curated (fixed, build-time), not community-submitted — there's no way for anyone else to add an entry. A real submission gallery needs a backend and ongoing human moderation, neither of which this package attempts. See `docs/architecture/online-playground.md` (in the main `ezsl` repo) for the full design and scope decisions.

## Development

```bash
npm run typecheck
npm run build                # tsc --noEmit + vite build -> dist/
npm test                     # pure encode/decode logic (Jest)
npm run test:integration     # real Playwright/Chromium session against a real running dev server
```
