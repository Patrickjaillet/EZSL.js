import { build, context } from "esbuild";

const watch = process.argv.includes("--watch");

/**
 * Bundles extension.ts + the `ezsl` package it imports into a single
 * self-contained dist/extension.js — chosen specifically to avoid shipping
 * `node_modules/ezsl` at all. `ezsl` is installed here as `file:..` (a
 * symlink to the whole monorepo root — src/, tests/, examples/, docs/,
 * everything), so packaging that directory as-is into a .vsix would be
 * wrong both in size and in what it exposes; bundling inlines only the
 * compiled JS this extension actually calls (`collectVariableDeclarations`
 * and its dependency graph) into one file, with no runtime `node_modules`
 * resolution needed at all. `vscode` is the one import that must stay
 * external — it isn't a real npm package, VS Code injects it into the
 * Extension Host's module resolution at runtime. See
 * docs/architecture/vscode-extension.md.
 */
const options = {
  entryPoints: ["src/extension.ts"],
  bundle: true,
  outfile: "dist/extension.js",
  platform: "node",
  format: "cjs",
  target: "node18",
  external: ["vscode"],
  sourcemap: true,
  // ezsl is ESM; esbuild bundling an ESM dependency into a CJS output is
  // exactly what it's designed to handle (unlike tsc's downleveling, which
  // is why extension.ts's own dynamic import() workaround exists for the
  // *unbundled* case — see extension.ts's own comment). Bundling makes
  // that workaround unnecessary at runtime (ezsl's code is inlined,
  // already resolved, not import()'d from disk at all) but the source
  // still uses import() so the extension also works correctly when run
  // unbundled (e.g. `tsc`-only, for quick local iteration).
};

if (watch) {
  const ctx = await context(options);
  await ctx.watch();
  console.log("esbuild watching for changes...");
} else {
  await build(options);
  console.log("esbuild: dist/extension.js written");
}
