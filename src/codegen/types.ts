// Minimal AST node shapes for the v0.1 proof-of-concept code generator.
// These are hand-authored for now (no lexer/parser yet) — the real parser
// will produce nodes matching this same shape once it exists.

export type EzslType =
  | "float"
  | "vec2"
  | "vec3"
  | "vec4"
  | "bool"
  | "int"
  | "mat2"
  | "mat3"
  | "mat4"
  | "sampler2D";

export interface Uniform {
  name: string;
  glslName: string;
  type: EzslType;
}

export interface Expr {
  glsl: string;
  type: EzslType;
}

/**
 * One line of generated GLSL body text, tagged with the `.ezsl` source line
 * it came from (1-based), or `null` for a line the compiler synthesized
 * with no single corresponding source line (e.g. a `}` closing a block,
 * or — currently unused here, see glslGenerator's own boilerplate lines —
 * fully compiler-internal text). This is the raw material for the v0.4
 * error-translation layer's GLSL-line -> `.ezsl`-line mapping; see
 * docs/architecture/error-translation.md.
 */
export interface SourceMappedLine {
  glsl: string;
  ezslLine: number | null;
}

export interface Program {
  /** Extra uniforms beyond the auto-injected ones (u_time, u_resolution). */
  uniforms: Uniform[];
  /** Ordered, source-mapped GLSL statements for the fragment shader body, before the final color write. */
  body: SourceMappedLine[];
  /** Final expression assigned to the fragment color output. */
  outColor: Expr;
  /**
   * The `.ezsl` source line the top-level `color = ...` assignment came
   * from, or `null` if it couldn't be determined (should not normally
   * happen — every program must assign `color` exactly once at top
   * level). Kept separate from `outColor` (rather than adding a line
   * field to `Expr`, used far more broadly) — see `compile.ts`'s
   * `outColorLine` for why this exists: v0.4/v0.7 error-translation and
   * DevTools source-mapping can now attribute the generated `fragColor =
   * ...` line back to real `.ezsl` source, previously always unmapped.
   */
  outColorLine: number | null;
  /**
   * Raw GLSL emitted at file scope, above `main()` — user-injected functions
   * (`defineFunction`) and `glsl { ... }` Escape Hatch blocks written outside
   * any statement position end up here; verbatim GLSL written as a
   * `glsl { ... }` *statement* inside the body instead lands in `body`.
   */
  topLevel: string[];
}

/** A custom GLSL function signature for `defineFunction` — see docs/architecture/escape-hatch.md. */
export interface FunctionSignature {
  params: EzslType[];
  returns: EzslType;
}

/**
 * A compiled vertex-stage EZSL program (v0.6 Three.js integration — see
 * docs/architecture/three-integration.md). Deliberately a separate type
 * from the fragment-stage `Program` above rather than a generalized "either
 * stage" shape: the two stages have different auto-injected builtins
 * (`position`/`normal` attributes and Three.js camera/model matrices here,
 * vs. `uv`/`time`/`resolution` for fragment), a different required output
 * (`outPosition`, not `outColor`), and no `topLevel` concept yet (vertex
 * `fn`/`defineFunction`/structs aren't exercised by this milestone) — a
 * shared type would need most of its fields to be conditionally meaningful
 * depending on stage, which is worse than two small concrete types.
 */
export interface VertexProgram {
  /** Extra uniforms beyond Three.js's own built-in matrices. */
  uniforms: Uniform[];
  /** Ordered, source-mapped GLSL statements for the vertex shader body, before the final gl_Position write. */
  body: SourceMappedLine[];
  /** Final vec4 expression assigned to `gl_Position`. */
  outPosition: Expr;
}
