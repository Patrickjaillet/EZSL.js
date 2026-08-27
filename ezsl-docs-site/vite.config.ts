import { defineConfig } from "vite";

// GitHub Pages serves a project site (repo name != <user>.github.io) under
// a subpath, so every asset URL needs that subpath prefixed — Vite's `base`
// does this for the build (`npm run dev` is unaffected, base defaults to
// "/" outside a GITHUB_PAGES build). The site's existing hash-based routing
// (`#/<slug>`, see src/main.ts) means no server-side rewrite rules are
// needed for deep links — every route is really just `index.html#/...`,
// which GitHub Pages serves correctly with zero extra configuration.
export default defineConfig({
  base: process.env.GITHUB_PAGES ? "/EZSL.js/" : "/",
});
