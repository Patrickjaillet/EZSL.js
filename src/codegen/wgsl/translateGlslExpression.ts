/**
 * Translates a single GLSL expression/statement fragment (as emitted by
 * `src/compiler/compile.ts` — never arbitrary hand-written GLSL) into its
 * WGSL equivalent, via targeted textual substitution rather than a real
 * GLSL parser. This is only sound because the input is always EZSL's own
 * compiler output, whose shape is fully known — see
 * docs/architecture/webgpu-target.md for why "translate the generated GLSL
 * text" was chosen over "share a language-neutral IR" for this
 * experimental milestone, and exactly what shapes of GLSL text this
 * function is and isn't prepared to see.
 */

// Type-constructor calls: EZSL always emits GLSL's bare constructor names
// (`vec3(...)`, `mat4(...)`) — WGSL requires the element type spelled out
// (`vec3<f32>(...)`, `mat4x4<f32>(...)`). `float(x)` (an EZSL int->float
// cast, see docs/architecture/type-system.md) becomes WGSL's `f32(x)`.
const TYPE_CONSTRUCTOR_PATTERN = /\b(float|vec2|vec3|vec4|mat2|mat3|mat4)\(/g;
const TYPE_CONSTRUCTOR_WGSL: Record<string, string> = {
  float: "f32(",
  vec2: "vec2<f32>(",
  vec3: "vec3<f32>(",
  vec4: "vec4<f32>(",
  mat2: "mat2x2<f32>(",
  mat3: "mat3x3<f32>(",
  mat4: "mat4x4<f32>(",
};

// EZSL always emits texture() (never texture2D — GLSL ES 3.00 only), which
// takes one combined sampler argument. WGSL splits a GLSL "combined image
// sampler" into two separate bindings (a texture_2d and a sampler), so
// texture(u_buffer_X, uv) becomes textureSample(u_buffer_X, u_buffer_X_sampler, uv)
// — the codegen emitting the WGSL binding declarations (see
// generateWgslFragmentShader) is responsible for actually declaring that
// paired sampler under the `_sampler`-suffixed name this regex assumes.
const TEXTURE_CALL_PATTERN = /\btexture\((\w+),\s*/g;

// GLSL declares a local as `<type> <name> = <expr>;`; WGSL uses `var <name>: <type> = <expr>;`.
// EZSL only ever emits this exact shape for a first assignment (see
// `emitAssignmentInScope` in compile.ts) — a re-assignment is already just
// `<name> = <expr>;`, valid WGSL as-is, and is not matched by this pattern.
const LOCAL_DECLARATION_PATTERN = /^(\s*)(float|vec2|vec3|vec4|mat2|mat3|mat4|int|bool)\s+([A-Za-z_]\w*)\s*=\s*/;

const SCALAR_TYPE_WGSL: Record<string, string> = {
  float: "f32",
  vec2: "vec2<f32>",
  vec3: "vec3<f32>",
  vec4: "vec4<f32>",
  mat2: "mat2x2<f32>",
  mat3: "mat3x3<f32>",
  mat4: "mat4x4<f32>",
  int: "i32",
  bool: "bool",
};

/**
 * A handful of GLSL builtin function names WGSL spells differently, or
 * that need argument-order/shape changes beyond a simple rename. Anything
 * not listed here is assumed to have an identical name and signature in
 * WGSL (true for most of EZSL's builtin set — `sin`, `cos`, `length`,
 * `normalize`, `mix`, `clamp`, `abs`, `floor`, `pow`, `exp`, `cross`,
 * `reflect`, `step`, `smoothstep` all match GLSL's names and argument
 * order exactly). `mod` is the one confirmed real mismatch: GLSL's
 * `mod(x, y)` is floating-point modulo with GLSL's specific sign
 * convention; WGSL has no builtin of that name — `x - y * floor(x / y)`
 * is the direct equivalent (matches GLSL's `mod` for all real inputs,
 * including negative `x`). `dot`, `sqrt`, `atan`, `tan`, `fract` are all
 * also identically named in WGSL and not translated.
 */
function translateModCalls(glsl: string): string {
  // Only rewrites a simple two-argument mod(a, b) where a/b don't themselves
  // contain a comma at the top level (i.e. no nested multi-arg calls as
  // arguments) — EZSL's own generated `mod(...)` calls are always exactly
  // this shape (see SHAPE_PRESERVING_FUNCTIONS handling in compile.ts,
  // which never nests a comma-bearing argument directly inside `mod(...)`
  // without its own enclosing parens balancing first). A future emitter
  // change that nests differently would need this revisited — see
  // docs/architecture/webgpu-target.md's capability matrix for what's
  // verified vs. assumed.
  return glsl.replace(/\bmod\(([^,()]+),\s*([^,()]+)\)/g, "($1 - $2 * floor($1 / $2))");
}

export function translateGlslExpressionToWgsl(glsl: string): string {
  let wgsl = glsl;
  wgsl = translateModCalls(wgsl);
  wgsl = wgsl.replace(TYPE_CONSTRUCTOR_PATTERN, (_match, type: string) => TYPE_CONSTRUCTOR_WGSL[type]);
  wgsl = wgsl.replace(TEXTURE_CALL_PATTERN, (_match, samplerName: string) => `textureSample(${samplerName}, ${samplerName}_sampler, `);
  return wgsl;
}

/** Translates one GLSL statement line (which may be a `<type> <name> = <expr>;` local declaration) into WGSL. */
export function translateGlslStatementToWgsl(glslLine: string): string {
  const declMatch = LOCAL_DECLARATION_PATTERN.exec(glslLine);
  if (declMatch) {
    const [, indent, ezslType, name] = declMatch;
    const rest = glslLine.slice(declMatch[0].length);
    const wgslType = SCALAR_TYPE_WGSL[ezslType] ?? ezslType;
    return `${indent}var ${name}: ${wgslType} = ${translateGlslExpressionToWgsl(rest)}`;
  }
  return translateGlslExpressionToWgsl(glslLine);
}
