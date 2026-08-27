// The progressive tutorial track's navigation manifest — the v1.0.x
// Ecosystem Launch "Progressive tutorial track (beginner -> intermediate
// -> advanced/Escape Hatch)" deliverable. Beginner and Advanced pages
// live in this package's own content/ directory (new pages, restructured
// from docs/ezsl-language-reference.md and docs/architecture/escape-hatch.md
// respectively). Intermediate pages are loaded directly from the main
// repo's docs/tutorials/*.md — not copied — so there is exactly one
// source of truth for that content and it can never drift between the
// two locations. See docs/architecture/interactive-docs-site.md.
import helloGradient from "../content/beginner/01-hello-gradient.md?raw";
import valuesAndTypes from "../content/beginner/02-values-and-types.md?raw";
import variablesAndControlFlow from "../content/beginner/03-variables-and-control-flow.md?raw";
import functionsStructsArrays from "../content/beginner/04-functions-structs-arrays.md?raw";
import builtinsAndUniforms from "../content/beginner/05-builtins-and-uniforms.md?raw";
import escapeHatch from "../content/advanced/escape-hatch.md?raw";
import threeJsScene from "../../docs/tutorials/three-js-scene.md?raw";
import multiPassShadertoy from "../../docs/tutorials/multi-pass-shadertoy.md?raw";
import canvas2dCompositing from "../../docs/tutorials/canvas2d-compositing.md?raw";
import comparisonsOverview from "../content/comparisons/01-overview.md?raw";
import syntaxSideBySide from "../content/comparisons/02-syntax-side-by-side.md?raw";
import typeSystemsCompared from "../content/comparisons/03-type-systems-compared.md?raw";
import uniformsAndVaryingsCompared from "../content/comparisons/04-uniforms-and-varyings-compared.md?raw";
import multiPassCompared from "../content/comparisons/05-multi-pass-compared.md?raw";

export interface Page {
  slug: string;
  title: string;
  tier: "Beginner" | "Intermediate" | "Comparisons" | "Advanced";
  markdown: string;
}

export const PAGES: Page[] = [
  { slug: "hello-gradient", title: "1. Hello, gradient", tier: "Beginner", markdown: helloGradient },
  { slug: "values-and-types", title: "2. Values and types", tier: "Beginner", markdown: valuesAndTypes },
  { slug: "variables-and-control-flow", title: "3. Variables and control flow", tier: "Beginner", markdown: variablesAndControlFlow },
  { slug: "functions-structs-arrays", title: "4. Functions, structs, arrays", tier: "Beginner", markdown: functionsStructsArrays },
  { slug: "builtins-and-uniforms", title: "5. Builtins and uniforms", tier: "Beginner", markdown: builtinsAndUniforms },
  { slug: "three-js-scene", title: "Three.js scene", tier: "Intermediate", markdown: threeJsScene },
  { slug: "multi-pass-shadertoy", title: "Multi-pass (Shadertoy-style)", tier: "Intermediate", markdown: multiPassShadertoy },
  { slug: "canvas2d-compositing", title: "Canvas2D compositing", tier: "Intermediate", markdown: canvas2dCompositing },
  { slug: "comparisons-overview", title: "Overview", tier: "Comparisons", markdown: comparisonsOverview },
  { slug: "syntax-side-by-side", title: "Syntax side-by-side", tier: "Comparisons", markdown: syntaxSideBySide },
  { slug: "type-systems-compared", title: "Type systems compared", tier: "Comparisons", markdown: typeSystemsCompared },
  { slug: "uniforms-and-varyings-compared", title: "Uniforms & varyings compared", tier: "Comparisons", markdown: uniformsAndVaryingsCompared },
  { slug: "multi-pass-compared", title: "Multi-pass compared", tier: "Comparisons", markdown: multiPassCompared },
  { slug: "escape-hatch", title: "The Escape Hatch", tier: "Advanced", markdown: escapeHatch },
];

export function findPage(slug: string): Page | undefined {
  return PAGES.find((p) => p.slug === slug);
}
