import type { Program, SourceMappedLine, VertexProgram } from "./types.js";

/**
 * Boilerplate auto-injected into every EZSL fragment shader (v0.1 scope):
 * - `uv`: normalized gl_FragCoord, Y-flipped to match top-left-origin
 *   beginner/Canvas2D mental models (see ROADMAP.md v0.1 known trap).
 * - `time`: seconds elapsed, bound to uniform u_time.
 * - `resolution`: canvas size in pixels, bound to uniform u_resolution.
 */
const BOILERPLATE_UNIFORMS = `uniform float u_time;
uniform vec2 u_resolution;`;

const BOILERPLATE_PRELUDE = `  vec2 uv = gl_FragCoord.xy / u_resolution;
  uv.y = 1.0 - uv.y;
  float time = u_time;
  vec2 resolution = u_resolution;`;

/**
 * Maps each 1-based line of a generated fragment shader to the `.ezsl`
 * source line it was compiled from — `null` where a line has no single
 * corresponding source line (boilerplate, structural braces with no better
 * attribution, blank/header lines). Built by `generateFragmentShader`
 * alongside the GLSL text; see docs/architecture/error-translation.md for
 * how the v0.4 error-translation layer consumes this.
 */
export type SourceMap = ReadonlyMap<number, number | null>;

export interface GeneratedFragmentShader {
  source: string;
  sourceMap: SourceMap;
}

/**
 * Generates GLSL ES 3.00 (WebGL2) fragment shader source from a Program
 * AST, plus its GLSL-line -> `.ezsl`-line source map. `includeVersionDirective`
 * (default `true`) controls whether the leading `#version 300 es` line is
 * emitted — set `false` when the host environment supplies its own
 * `#version` line before this shader's source (e.g. `THREE.RawShaderMaterial`
 * with `glslVersion: THREE.GLSL3` — see `src/integrations/three.ts` and
 * docs/architecture/three-integration.md; a duplicate `#version` anywhere
 * but the true first line is a hard GLSL compile error, confirmed against
 * a real Three.js runtime while building that integration).
 */
export function generateFragmentShaderMapped(program: Program, includeVersionDirective = true): GeneratedFragmentShader {
  const userUniforms = program.uniforms.map((u) => `uniform ${u.type} ${u.glslName};`);
  const topLevel = program.topLevel.length > 0 ? program.topLevel.join("\n\n").split("\n").concat("") : [];

  const lines: SourceMappedLine[] = [];
  const push = (glsl: string, ezslLine: number | null = null) => lines.push({ glsl, ezslLine });

  if (includeVersionDirective) push("#version 300 es");
  push("precision highp float;");
  push("");
  push(BOILERPLATE_UNIFORMS.split("\n")[0]);
  push(BOILERPLATE_UNIFORMS.split("\n")[1]);
  for (const u of userUniforms) push(u);
  push("");
  push("out vec4 fragColor;");
  push("");
  for (const t of topLevel) push(t);
  push("void main() {");
  for (const preludeLine of BOILERPLATE_PRELUDE.split("\n")) push(preludeLine);
  for (const bodyLine of program.body) push(bodyLine.glsl, bodyLine.ezslLine);
  push(`  fragColor = ${program.outColor.glsl};`, program.outColorLine);
  push("}");
  push("");

  const source = lines.map((l) => l.glsl).join("\n");
  const sourceMap = new Map<number, number | null>();
  lines.forEach((l, i) => sourceMap.set(i + 1, l.ezslLine));

  return { source, sourceMap };
}

/** Generates just the GLSL source text (no source map) — convenience wrapper for callers that don't need error translation. */
export function generateFragmentShader(program: Program): string {
  return generateFragmentShaderMapped(program).source;
}

/** Fullscreen-quad vertex shader — identical for every EZSL fragment program in v0.1. */
export function generateVertexShader(): string {
  return `#version 300 es
in vec2 a_position;

void main() {
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`;
}

/**
 * Generates a real GLSL ES 3.00 vertex shader from a compiled `VertexProgram`
 * (v0.6 Three.js integration — see docs/architecture/three-integration.md),
 * plus its GLSL-line -> `.ezsl`-line source map. Unlike `generateVertexShader`
 * above (a fixed fullscreen-quad passthrough for fragment-only rendering),
 * this compiles user-authored vertex logic: `position`/`normal` are declared
 * as `in` attributes (Three.js always supplies these for any `BufferGeometry`),
 * and Three.js's own `modelMatrix`/`modelViewMatrix`/`projectionMatrix`/
 * `normalMatrix` uniforms are declared under their real names — no `u_`
 * prefix, since these aren't EZSL-declared uniforms but ones Three.js itself
 * populates every frame for any `ShaderMaterial`. `includeVersionDirective`
 * (default `true`) — see the same parameter on `generateFragmentShaderMapped`
 * for why this exists; `src/integrations/three.ts` passes `false`.
 */
export function generateThreeVertexShaderMapped(program: VertexProgram, includeVersionDirective = true): GeneratedFragmentShader {
  const threeBuiltinNames = new Set(["modelMatrix", "modelViewMatrix", "projectionMatrix", "normalMatrix"]);
  const threeBuiltinDeclarations: Record<string, string> = {
    modelMatrix: "uniform mat4 modelMatrix;",
    modelViewMatrix: "uniform mat4 modelViewMatrix;",
    projectionMatrix: "uniform mat4 projectionMatrix;",
    normalMatrix: "uniform mat3 normalMatrix;",
  };

  // Only declare the Three.js builtin uniforms actually referenced — Three.js
  // supplies them regardless, but redeclaring an unused one is harmless; the
  // real reason to filter is that program.uniforms only ever contains
  // *EZSL*-declared uniforms (see compile.ts), so Three.js builtins never
  // appear there and must be found by scanning the compiled GLSL text instead.
  const allGlsl = [program.outPosition.glsl, ...program.body.map((l) => l.glsl)].join("\n");
  const referencedThreeBuiltins = [...threeBuiltinNames].filter((name) => new RegExp(`\\b${name}\\b`).test(allGlsl));

  const userUniforms = program.uniforms.map((u) => `uniform ${u.type} ${u.glslName};`);

  const lines: SourceMappedLine[] = [];
  const push = (glsl: string, ezslLine: number | null = null) => lines.push({ glsl, ezslLine });

  if (includeVersionDirective) push("#version 300 es");
  push("in vec3 position;");
  push("in vec3 normal;");
  for (const name of referencedThreeBuiltins) push(threeBuiltinDeclarations[name]);
  for (const u of userUniforms) push(u);
  push("");
  push("void main() {");
  for (const bodyLine of program.body) push(bodyLine.glsl, bodyLine.ezslLine);
  push(`  gl_Position = ${program.outPosition.glsl};`);
  push("}");
  push("");

  const source = lines.map((l) => l.glsl).join("\n");
  const sourceMap = new Map<number, number | null>();
  lines.forEach((l, i) => sourceMap.set(i + 1, l.ezslLine));

  return { source, sourceMap };
}
