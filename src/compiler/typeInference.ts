import type { EzslType } from "../codegen/types.js";
import type { ResolvedType } from "./types.js";
import { scalarType } from "./types.js";

const FRAGMENT_BUILTIN_SCOPE: Record<string, EzslType> = {
  uv: "vec2",
  time: "float",
  resolution: "vec2",
};

/**
 * Vertex-stage builtins (v0.6 Three.js integration — see
 * docs/architecture/three-integration.md): `position`/`normal` are the
 * per-vertex geometry attributes Three.js always supplies; the four
 * matrices are Three.js's own standard uniforms, auto-mapped into EZSL
 * scope under their real Three.js names (no `u_` prefix — they aren't
 * EZSL-declared uniforms, they're Three.js-supplied ones the vertex shader
 * is expected to already have available, exactly as hand-written
 * `THREE.ShaderMaterial` GLSL would).
 */
const VERTEX_BUILTIN_SCOPE: Record<string, EzslType> = {
  position: "vec3",
  normal: "vec3",
  modelMatrix: "mat4",
  modelViewMatrix: "mat4",
  projectionMatrix: "mat4",
  normalMatrix: "mat3",
};

const TYPE_CONSTRUCTORS: Record<string, EzslType> = {
  float: "float",
  vec2: "vec2",
  vec3: "vec3",
  vec4: "vec4",
  mat2: "mat2",
  mat3: "mat3",
  mat4: "mat4",
};

/** Functions with a fixed `float` return type regardless of argument type (e.g. `length(vec3)` still returns `float`). */
const FIXED_RETURN_FUNCTIONS: Record<string, EzslType> = {
  sin: "float",
  cos: "float",
  tan: "float",
  atan: "float",
  length: "float",
  sqrt: "float",
  dot: "float",
};

/** Functions that operate component-wise and return the same type as their (widest) vector argument. */
const SHAPE_PRESERVING_FUNCTIONS = new Set([
  "abs",
  "mix",
  "clamp",
  "smoothstep",
  "fract",
  "floor",
  "mod",
  "max",
  "min",
  "pow",
  "exp",
  "normalize",
  "cross",
  "reflect",
  "step",
]);

const BUILTIN_FUNCTION_RETURN_TYPES: Record<string, EzslType> = {
  ...FIXED_RETURN_FUNCTIONS,
  abs: "float",
  mix: "float",
  clamp: "float",
  smoothstep: "float",
  fract: "float",
  floor: "float",
  mod: "float",
  max: "float",
  min: "float",
  pow: "float",
  exp: "float",
  normalize: "float",
  cross: "float",
  reflect: "float",
  step: "float",
};

/**
 * GLSL ES 3.00 reserved keywords (language keywords, reserved-for-future-use
 * words, and builtin type/qualifier names) that are illegal as identifiers.
 * EZSL local variable and for-loop-counter names compile 1:1 to GLSL
 * identifiers (unlike uniforms, which get a `u_` prefix), so a name that
 * collides with one of these fails at the WebGL driver with an opaque
 * "illegal use of reserved word" error unless caught here first.
 */
const GLSL_RESERVED_WORDS = new Set([
  "attribute", "const", "uniform", "varying", "buffer", "shared", "coherent", "volatile",
  "restrict", "readonly", "writeonly", "atomic_uint", "layout", "centroid", "flat",
  "smooth", "noperspective", "patch", "sample", "invariant", "precise", "break",
  "continue", "do", "for", "while", "switch", "case", "default", "if", "else",
  "subroutine", "in", "out", "inout", "int", "void", "bool", "true", "false",
  "float", "double", "discard", "return", "vec2", "vec3", "vec4", "ivec2", "ivec3",
  "ivec4", "bvec2", "bvec3", "bvec4", "uint", "uvec2", "uvec3", "uvec4", "dvec2",
  "dvec3", "dvec4", "mat2", "mat3", "mat4", "mat2x2", "mat2x3", "mat2x4", "mat3x2",
  "mat3x3", "mat3x4", "mat4x2", "mat4x3", "mat4x4", "dmat2", "dmat3", "dmat4",
  "dmat2x2", "dmat2x3", "dmat2x4", "dmat3x2", "dmat3x3", "dmat3x4", "dmat4x2",
  "dmat4x3", "dmat4x4", "lowp", "mediump", "highp", "precision", "sampler2D",
  "sampler3D", "samplerCube", "samplerCubeShadow", "sampler2DArray",
  "sampler2DArrayShadow", "isampler2D", "isampler3D", "isamplerCube", "isampler2DArray",
  "usampler2D", "usampler3D", "usamplerCube", "usampler2DArray", "sampler2DShadow",
  "sampler2DMS", "isampler2DMS", "usampler2DMS", "sampler2DMSArray", "isampler2DMSArray",
  "usampler2DMSArray", "image2D", "iimage2D", "uimage2D", "image3D", "iimage3D",
  "uimage3D", "imageCube", "iimageCube", "uimageCube", "image2DArray", "iimage2DArray",
  "uimage2DArray", "struct", "common", "partition", "active", "asm", "class", "union",
  "enum", "typedef", "template", "this", "resource", "goto", "inline", "noinline",
  "public", "static", "extern", "external", "interface", "long", "short", "half",
  "fixed", "unsigned", "superp", "input", "output", "hvec2", "hvec3", "hvec4",
  "fvec2", "fvec3", "fvec4", "sampler1D", "sampler1DShadow", "sampler1DArray",
  "sampler1DArrayShadow", "isampler1D", "isampler1DArray", "usampler1D",
  "usampler1DArray", "sampler2DRect", "sampler2DRectShadow", "isampler2DRect",
  "usampler2DRect", "samplerBuffer", "isamplerBuffer", "usamplerBuffer", "sizeof",
  "cast", "namespace", "using", "gl_FragColor", "gl_FragCoord", "gl_Position",
  "gl_FragDepth", "gl_VertexID", "gl_InstanceID",
]);

export function isReservedGlslWord(name: string): boolean {
  return GLSL_RESERVED_WORDS.has(name);
}

export class TypeError_ extends Error {
  constructor(message: string, public line: number, public column: number) {
    super(`EZSL type error at ${line}:${column}: ${message}`);
    this.name = "TypeError";
  }
}

/**
 * Number of components for each vector/scalar/matrix type — used for shape
 * inference and mismatch checks. `sampler2D` has no meaningful component
 * count (it's never swizzled or used in arithmetic — see
 * `MethodCallExpression` handling in `compile.ts`, the only place a
 * `sampler2D`-typed value is ever produced) but must be listed for
 * exhaustiveness; its value is never actually read.
 */
export function componentCount(type: EzslType): number {
  return { float: 1, vec2: 2, vec3: 3, vec4: 4, bool: 1, int: 1, mat2: 4, mat3: 9, mat4: 16, sampler2D: 0 }[type];
}

export type ShaderStage = "fragment" | "vertex";

function builtinScopeFor(stage: ShaderStage): Record<string, EzslType> {
  return stage === "vertex" ? VERTEX_BUILTIN_SCOPE : FRAGMENT_BUILTIN_SCOPE;
}

/** Tracks inferred types (scalars, vectors, matrices, arrays, or struct instances) for variables in scope during a single compile pass. */
export class TypeScope {
  private vars: Map<string, ResolvedType>;

  constructor(stage: ShaderStage = "fragment") {
    this.vars = new Map(Object.entries(builtinScopeFor(stage)).map(([k, v]) => [k, scalarType(v)]));
  }

  get(name: string): ResolvedType | undefined {
    return this.vars.get(name);
  }

  set(name: string, type: ResolvedType): void {
    this.vars.set(name, type);
  }

  has(name: string): boolean {
    return this.vars.has(name);
  }

  /** Creates an isolated child scope pre-seeded with the builtins for `stage` — used to compile a function body without leaking its locals into the caller's scope. */
  static withBuiltinsOnly(stage: ShaderStage = "fragment"): TypeScope {
    return new TypeScope(stage);
  }
}

export { TYPE_CONSTRUCTORS, BUILTIN_FUNCTION_RETURN_TYPES, SHAPE_PRESERVING_FUNCTIONS };
