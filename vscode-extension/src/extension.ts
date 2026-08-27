import * as vscode from "vscode";

/**
 * The subset of the `ezsl` package's public API this extension actually
 * uses — typed locally rather than importing `ezsl`'s own `.d.ts` files
 * directly, since `ezsl` is ESM-only (`"type": "module"`, see its own
 * `package.json`) and this extension's `main` entry point is CommonJS
 * (VS Code's conventional extension format) — `require("ezsl")` cannot
 * load an ESM package, so the actual module is loaded via a dynamic
 * `import()` at activation time (see `activate` below) and only its
 * runtime shape, not its compile-time types, is available here without
 * extra build-graph complexity. See docs/architecture/vscode-extension.md.
 */
interface EzslModule {
  collectVariableDeclarations(
    source: string,
    options?: unknown,
  ): { name: string; type: string; line: number; column: number }[];
}

let ezsl: EzslModule | undefined;

/**
 * Loads the `ezsl` package via a real dynamic `import()` expression.
 * `ezsl` is a pure ESM package and this extension's own module system is
 * CommonJS, so a plain `require("ezsl")` cannot load it — but the actual
 * shipped extension is always built via `esbuild.config.mjs`, which
 * bundles `ezsl`'s compiled output directly into `dist/extension.js` (see
 * that file's own comment): esbuild resolves and inlines this `import()`
 * at *build* time, so at runtime it never touches the filesystem or
 * `node_modules` at all — there is no ESM/CJS interop happening in the
 * shipped artifact, only in this source file's own on-disk shape before
 * bundling. (An earlier version hid this behind `new Function(...)` to
 * dodge `tsc`'s CJS-downleveling — a real bug found while building this:
 * that same trick also hid the import from esbuild's bundler, which
 * relies on being able to statically see `import()` calls to resolve and
 * inline them, so the bundled output silently kept a real runtime
 * `import("@patrickjaillet/ezsl")` that only worked by accident, not a self-contained
 * one. A plain, literal `import()` here is what makes bundling actually
 * inline the dependency — see docs/architecture/vscode-extension.md.)
 */
async function loadEzsl(): Promise<EzslModule> {
  if (!ezsl) {
    ezsl = (await import("@patrickjaillet/ezsl")) as unknown as EzslModule;
  }
  return ezsl;
}

/**
 * Finds the declared variable (if any) whose name matches the identifier
 * at `position` in `document`, using `ezsl`'s `collectVariableDeclarations`
 * — the same compiler pass `ezsl dev`/the CLI use, run in-process against
 * the document's current (possibly mid-edit, possibly invalid) text. Only
 * locals the compiler actually declares (a first assignment, or a
 * for-loop counter) are covered — uniforms and function parameters are
 * out of scope for this milestone, see the design doc.
 */
async function findHoverType(document: vscode.TextDocument, position: vscode.Position): Promise<string | null> {
  const wordRange = document.getWordRangeAtPosition(position, /[A-Za-z_]\w*/);
  if (!wordRange) return null;
  const word = document.getText(wordRange);

  const mod = await loadEzsl();
  const declarations = mod.collectVariableDeclarations(document.getText());

  // A variable can be declared once and referenced many times — hovering
  // any occurrence should report its type, so this matches by *name*
  // rather than requiring the hover to land exactly on the declaration
  // line/column.
  const declaration = declarations.find((d) => d.name === word);
  return declaration ? declaration.type : null;
}

export function activate(context: vscode.ExtensionContext): void {
  const hoverProvider = vscode.languages.registerHoverProvider("ezsl", {
    async provideHover(document, position) {
      const type = await findHoverType(document, position);
      if (!type) return null;
      const wordRange = document.getWordRangeAtPosition(position, /[A-Za-z_]\w*/)!;
      const word = document.getText(wordRange);
      const markdown = new vscode.MarkdownString();
      markdown.appendCodeblock(`${type} ${word}`, "glsl");
      return new vscode.Hover(markdown, wordRange);
    },
  });

  context.subscriptions.push(hoverProvider);
}

export function deactivate(): void {
  // No teardown needed — the hover provider is disposed automatically via
  // context.subscriptions, and `ezsl` holds no persistent resources
  // (no file handles, no timers) once compileVariableDeclarations returns.
}
