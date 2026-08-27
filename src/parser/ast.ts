// AST node shapes produced by the EZSL parser (v0.1 grammar scope:
// assignment/if/for statements, binary +-*/, comparisons, function calls,
// vector literals, member/swizzle access, numbers and identifiers).

export interface Position {
  line: number;
  column: number;
}

export type Node = Program | TopLevelDeclaration | Statement | Expression;

export interface Program {
  kind: "Program";
  /** `fn` and `struct` declarations — top-level only, cannot appear inside a statement block. */
  declarations: TopLevelDeclaration[];
  /** The program's executable statements, in source order (interleaved with declarations in the source, but kept separate here since declarations hoist). */
  statements: Statement[];
}

export type TopLevelDeclaration = FunctionDeclaration | StructDeclaration;

/**
 * `fn name(param, ...) { statement* }` — the last statement, if it's a
 * `ReturnStatement`, determines the function's return type by inferring the
 * type of its expression (see `docs/architecture/type-system.md`). A
 * function with no `return` has no meaningful return type and cannot be
 * called from an expression context — enforced at compile time.
 */
export interface FunctionDeclaration {
  kind: "FunctionDeclaration";
  name: string;
  params: string[];
  body: Statement[];
  pos: Position;
}

export interface ReturnStatement {
  kind: "ReturnStatement";
  value: Expression;
  pos: Position;
}

/** `struct Name { field: type, ... }` — compiles to a GLSL `struct`. */
export interface StructDeclaration {
  kind: "StructDeclaration";
  name: string;
  fields: StructField[];
  pos: Position;
}

export interface StructField {
  name: string;
  type: TypeAnnotation;
}

/**
 * A written-out type, used only in struct field declarations and function
 * parameter type hints (both contexts where shape can't be inferred from an
 * initializer expression the way local variables infer it). `arraySize`
 * set means the field/param is a fixed-size array of `base` (GLSL ES has no
 * dynamic arrays, so the size must be known here, not inferred).
 */
export interface TypeAnnotation {
  base: string;
  arraySize: number | null;
  pos: Position;
}

export type Statement =
  | AssignmentStatement
  | IfStatement
  | ForStatement
  | RawGlslStatement
  | ReturnStatement;

export interface AssignmentStatement {
  kind: "AssignmentStatement";
  name: string;
  value: Expression;
  pos: Position;
}

export interface IfStatement {
  kind: "IfStatement";
  condition: Expression;
  consequent: Statement[];
  alternate: Statement[] | null;
  pos: Position;
}

export interface ForStatement {
  kind: "ForStatement";
  variable: string;
  /** Inclusive lower bound. */
  from: number;
  /** Exclusive upper bound (`from..to`). */
  to: number;
  body: Statement[];
  pos: Position;
}

/**
 * Escape Hatch (`glsl { ... }`): raw GLSL passthrough, opaque to the parser
 * and type inference — `source` is captured verbatim by the lexer between
 * the block's braces, not tokenized as EZSL. See `docs/architecture/escape-hatch.md`.
 */
export interface RawGlslStatement {
  kind: "RawGlslStatement";
  source: string;
  pos: Position;
}

export type Expression =
  | NumberLiteral
  | Identifier
  | VectorLiteral
  | ArrayLiteral
  | IndexExpression
  | CallExpression
  | MemberExpression
  | MethodCallExpression
  | BinaryExpression
  | ComparisonExpression;

export interface NumberLiteral {
  kind: "NumberLiteral";
  value: number;
  pos: Position;
}

export interface Identifier {
  kind: "Identifier";
  name: string;
  pos: Position;
}

export interface VectorLiteral {
  kind: "VectorLiteral";
  elements: Expression[];
  pos: Position;
}

/**
 * `array[e1, e2, ...]` — a fixed-size array literal, distinct from
 * `VectorLiteral`'s `[e1, e2]`/`[e1, e2, e3]`/`[e1, e2, e3, e4]` (which
 * infer `vec2`/`vec3`/`vec4`). The `array` keyword-prefix disambiguates the
 * two syntactically so a 2-4 element list isn't ambiguous between "a vector"
 * and "an array of that length" — see docs/architecture/type-system.md.
 */
export interface ArrayLiteral {
  kind: "ArrayLiteral";
  elements: Expression[];
  pos: Position;
}

/** `expr[index]` — fixed-size array element access, compiled 1:1 to GLSL array indexing. */
export interface IndexExpression {
  kind: "IndexExpression";
  object: Expression;
  index: Expression;
  pos: Position;
}

export interface CallExpression {
  kind: "CallExpression";
  callee: string;
  args: Expression[];
  pos: Position;
}

export interface MemberExpression {
  kind: "MemberExpression";
  object: Expression;
  property: string;
  pos: Position;
}

/**
 * `object.method(args)` — the only current use is `BufferName.sample(uv)`
 * (v0.5 multi-pass rendering: sampling another pass's output texture, see
 * docs/architecture/multi-pass.md). Distinct from `MemberExpression`
 * (`object.property`, no call) and from `CallExpression` (`name(args)`, no
 * receiver) — a plain identifier followed by `.name(` is this, not a
 * `MemberExpression` whose result happens to be called (EZSL has no
 * first-class function values, so "a member that is itself callable" isn't
 * a meaningful composition of the other two node kinds).
 */
export interface MethodCallExpression {
  kind: "MethodCallExpression";
  object: Expression;
  method: string;
  args: Expression[];
  pos: Position;
}

export type BinaryOperator = "+" | "-" | "*" | "/";

export interface BinaryExpression {
  kind: "BinaryExpression";
  operator: BinaryOperator;
  left: Expression;
  right: Expression;
  pos: Position;
}

export type ComparisonOperator = "<" | "<=" | ">" | ">=" | "==";

export interface ComparisonExpression {
  kind: "ComparisonExpression";
  operator: ComparisonOperator;
  left: Expression;
  right: Expression;
  pos: Position;
}
