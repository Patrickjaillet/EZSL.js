import type { Program, Uniform } from "../types.js";
import { layoutUniformBuffer } from "./uboLayout.js";
import type { UboLayout } from "./uboLayout.js";
import { translateGlslExpressionToWgsl, translateGlslStatementToWgsl } from "./translateGlslExpression.js";

/**
 * A GLSL `for (int i = A; i < B; i++) {` header, emitted verbatim by
 * `compile.ts` (see docs/architecture/type-system.md's `for`-loop section)
 * — WGSL's `for` syntax differs enough (`var` keyword, `: i32` type
 * annotation, no parens required but harmless to keep) that this needs its
 * own targeted rewrite rather than falling out of the general statement
 * translator, which only handles single-declaration/expression lines.
 */
const FOR_HEADER_PATTERN = /^(\s*)for \(int (\w+) = (\d+); \w+ < (\d+); \w+\+\+\) \{$/;

function translateForHeader(line: string): string | null {
  const match = FOR_HEADER_PATTERN.exec(line);
  if (!match) return null;
  const [, indent, variable, from, to] = match;
  return `${indent}for (var ${variable}: i32 = ${from}; ${variable} < ${to}; ${variable}++) {`;
}

/** Translates one line of EZSL-compiler-generated GLSL body text into WGSL. */
function translateBodyLine(line: string): string {
  const forHeader = translateForHeader(line);
  if (forHeader !== null) return forHeader;
  return translateGlslStatementToWgsl(line);
}

export interface WgslGenerationResult {
  source: string;
  /** The uniform buffer's computed WGSL layout (offsets/sizes/padding) — see docs/architecture/webgpu-target.md. Empty members/zero totalSize if the program declares no non-sampler uniforms. */
  uboLayout: UboLayout;
  /** Uniform names this program declared that could **not** be translated to WGSL (currently: none are actually rejected — see docs/architecture/webgpu-target.md's capability matrix for what's fully supported vs. best-effort). */
  unsupportedFeatures: string[];
}

const BUILTIN_UNIFORM_MEMBERS: { name: string; type: "float" | "vec2" }[] = [
  { name: "time", type: "float" },
  { name: "resolution", type: "vec2" },
];

/**
 * Generates an **experimental** WGSL fragment shader from the same
 * compiled `Program` IR `generateFragmentShaderMapped` (GLSL) consumes —
 * "the same AST" in ROADMAP.md's v0.6 wording refers to this shared
 * compiled-IR input, not a shared textual generator; see
 * docs/architecture/webgpu-target.md for why GLSL text translation was
 * chosen over a language-neutral IR for this milestone, and exactly what
 * this does and doesn't cover. Not runtime-validated against a real
 * `GPUDevice` (unavailable in this project's environment) — validated by
 * exhaustive unit tests on the generated WGSL text's structure only. Not
 * wired into `mount()`/`createPipeline()`/`createThreeMaterial()`; no
 * WebGPU runtime exists yet.
 */
export function generateWgslFragmentShader(program: Program): WgslGenerationResult {
  const samplerUniforms = program.uniforms.filter((u) => u.type === "sampler2D");
  const bufferUniforms = program.uniforms.filter((u) => u.type !== "sampler2D");

  const uboMembers = [
    ...BUILTIN_UNIFORM_MEMBERS,
    ...bufferUniforms.map((u) => ({ name: u.glslName, type: u.type as Exclude<Uniform["type"], "sampler2D"> })),
  ];
  const uboLayout = layoutUniformBuffer(uboMembers);

  const lines: string[] = [];

  // Uniform buffer struct — field order matches uboLayout.members (declaration
  // order, padding made explicit via WGSL's own alignment rules rather than
  // manual padding fields; WGSL's compiler inserts the actual byte padding,
  // this struct only needs correctly-ordered, correctly-typed fields for that
  // to happen automatically — see docs/architecture/webgpu-target.md).
  lines.push("struct Uniforms {");
  for (const member of uboLayout.members) {
    lines.push(`  ${member.name}: ${member.wgslType},`);
  }
  lines.push("};");
  lines.push("@group(0) @binding(0) var<uniform> u: Uniforms;");

  // Each sampler2D uniform becomes a texture_2d<f32> + a separate sampler
  // binding (WGSL's split of GLSL's combined sampler2D — see
  // translateGlslExpression.ts's texture()->textureSample() rewrite, which
  // assumes exactly this naming convention).
  let bindingIndex = 1;
  for (const s of samplerUniforms) {
    lines.push(`@group(0) @binding(${bindingIndex}) var ${s.glslName}: texture_2d<f32>;`);
    bindingIndex++;
    lines.push(`@group(0) @binding(${bindingIndex}) var ${s.glslName}_sampler: sampler;`);
    bindingIndex++;
  }
  lines.push("");

  // topLevel (struct declarations, defineFunction/fn GLSL text) is NOT
  // translated — it's raw, hand-authored or already-GLSL-typed text, which
  // this milestone's textual translator has no reliable way to rewrite
  // (see docs/architecture/webgpu-target.md's capability matrix: "custom
  // GLSL functions / Escape Hatch blocks" is GLSL-only, not dual-target).
  const untranslatedTopLevel = program.topLevel.length > 0 ? program.topLevel : [];

  lines.push("@fragment");
  lines.push("fn main(@builtin(position) fragCoord: vec4<f32>) -> @location(0) vec4<f32> {");
  lines.push("  var uv: vec2<f32> = fragCoord.xy / u.resolution;");
  lines.push("  uv.y = 1.0 - uv.y;");
  lines.push("  let time: f32 = u.time;");
  lines.push("  let resolution: vec2<f32> = u.resolution;");
  for (const bodyLine of program.body) {
    lines.push(`  ${translateBodyLine(bodyLine.glsl)}`);
  }
  lines.push(`  return ${translateGlslExpressionToWgsl(program.outColor.glsl)};`);
  lines.push("}");
  lines.push("");

  const source = [...untranslatedTopLevel, ...lines].join("\n");

  return {
    source,
    uboLayout,
    unsupportedFeatures: untranslatedTopLevel.length > 0 ? ["topLevel (struct/fn/defineFunction/glsl{} text is emitted untranslated — see capability matrix)"] : [],
  };
}
