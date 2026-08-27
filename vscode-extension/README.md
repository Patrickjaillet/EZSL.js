# EZSL for VS Code

Syntax highlighting and inferred-type hover tooltips for [EZSL.js](../README.md) (`.ezsl`) shader files.

## Features

- **Syntax highlighting** for `.ezsl` files — keywords (`fn`, `struct`, `if`/`else`, `for`/`in`, `return`), type constructors (`vec2`/`vec3`/`vec4`/`mat2`/`mat3`/`mat4`/`float`/`int`/`bool`/`array`), auto-injected builtins (`uv`, `time`, `resolution`, `position`, `normal`, Three.js camera matrices), swizzles/method calls, and `glsl { ... }` Escape Hatch blocks (highlighted as embedded GLSL when a GLSL grammar is installed).
- **Hover type hints** — hovering any locally-declared variable (a first assignment, or a `for`-loop counter) shows its inferred EZSL/GLSL type, computed by running the real EZSL compiler's type inference against the open document.

## How hover type inference works

This extension bundles the `ezsl` compiler package directly (via [esbuild](https://esbuild.github.io/)) and calls its `collectVariableDeclarations(source)` function against the current document's text on every hover — the same type-inference pass the compiler itself uses to generate GLSL, not a separate/approximate re-implementation. If the document doesn't currently compile (e.g. mid-edit), whatever declarations were successfully inferred before the failure are still shown; the hover provider never throws on invalid intermediate source.

Uniforms and function parameters aren't covered by hover yet — see `docs/architecture/vscode-extension.md` (in the main [EZSL.js repository](https://github.com/anthropics/ezsl)) for the full design and scope notes.

## Development

```bash
npm install
npm run build   # bundles src/extension.ts + ezsl into dist/extension.js via esbuild
npm run watch   # same, but rebuilds on change
```

Press F5 in VS Code (with this folder open) to launch an Extension Development Host with the extension loaded, or run:

```bash
code --extensionDevelopmentPath=. path/to/some/shader.ezsl
```
