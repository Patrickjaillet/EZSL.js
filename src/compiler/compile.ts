import type {
  Expression,
  FunctionDeclaration,
  Statement,
  StructDeclaration,
  Program as AstProgram,
} from "../parser/ast.js";
import type { EzslType, Expr, FunctionSignature, Program as CodegenProgram, SourceMappedLine, Uniform } from "../codegen/types.js";
import {
  BUILTIN_FUNCTION_RETURN_TYPES,
  componentCount,
  isReservedGlslWord,
  SHAPE_PRESERVING_FUNCTIONS,
  TypeScope,
  TYPE_CONSTRUCTORS,
} from "./typeInference.js";
import type { ShaderStage, VertexTarget } from "./typeInference.js";
import type { ResolvedType } from "./types.js";
import { glslTypeName, resolvedTypesEqual, scalarType } from "./types.js";
import { didYouMean } from "./didYouMean.js";

/** A custom GLSL function registered via `defineFunction` — see docs/architecture/escape-hatch.md. */
export interface CustomFunction {
  name: string;
  glslSource: string;
  signature: FunctionSignature;
}

export interface CompileOptions {
  /** Custom GLSL functions injected at file scope and made callable from EZSL source. */
  customFunctions?: CustomFunction[];
  /**
   * Names of other passes in the same `createPipeline()` this program may
   * sample from (v0.5 multi-pass rendering — see
   * docs/architecture/multi-pass.md). A name listed here is recognized as a
   * `sampler2D` buffer reference, callable only as `<name>.sample(uv)`; it
   * is otherwise a normal identifier reference and, like a uniform, is an
   * error if used any other way (e.g. in arithmetic). The pipeline
   * orchestrator supplies this list — a single `compile()` call has no way
   * to know what other passes exist otherwise.
   */
  bufferNames?: string[];
  /**
   * Which shader stage `ast` is being compiled for (v0.6 Three.js
   * integration — see docs/architecture/three-integration.md). Defaults to
   * `"fragment"`, matching every pre-v0.6 caller. Changes the auto-injected
   * builtin scope (`uv`/`time`/`resolution` for fragment vs.
   * `position`/`normal`/Three.js matrices for vertex) and which statement
   * name is treated as the program's required output (`color` vs.
   * `glPosition` — see `outputName`). Internal only: external callers
   * should use `compileVertex()` rather than passing `stage` directly,
   * since the vertex-specific result shape (`VertexProgram`, not
   * `Program`) needs its own return path — see that function.
   */
  stage?: ShaderStage;
  /** The statement name treated as this program's required output. Defaults to `"color"`. Only `compileVertex()` overrides this (to `"glPosition"`) — see `stage`. */
  outputName?: string;
  /**
   * Which vertex-builtin scope to use when `stage === "vertex"` (Babylon
   * integration — see docs/architecture/babylon-integration.md). Ignored
   * when `stage === "fragment"`. Defaults to `"three"`, matching v0.6's
   * original, single-target vertex support — every pre-Babylon-integration
   * call site is unaffected. Internal only, same reasoning as `stage`:
   * `compileEzslVertex()`'s public signature gains a `target` parameter
   * instead of exposing this directly, since the *result* type doesn't
   * change per-target (both produce a `VertexProgram`), so no separate
   * public wrapper function is needed, just a parameter.
   */
  vertexTarget?: VertexTarget;
  /**
   * Debug/tooling hook (v0.7, VS Code extension hover support — see
   * `docs/architecture/vscode-extension.md`), called once for every new
   * local variable declaration the compiler encounters (a first assignment
   * to a name, or a `for`-loop counter), in source order, with its
   * inferred GLSL type as a display string (via `glslTypeName` — e.g.
   * `"float"`, `"vec3"`). Purely additive and side-effect-free from the
   * compiler's own perspective — `compile()`'s return value and every
   * other behavior are unaffected by whether this is provided. Not called
   * for uniforms (already fully described by `Program.uniforms`) or
   * function parameters (out of scope for this milestone — see the design
   * doc's "what's not covered" section). `pos` is 1-based, matching every
   * other position EZSL reports (`CompileError.line`, etc.).
   */
  onVariableDeclared?(name: string, type: string, pos: { line: number; column: number }): void;
}

export class CompileError extends Error {
  constructor(message: string, public line: number, public column: number) {
    super(`EZSL compile error at ${line}:${column}: ${message}`);
    this.name = "CompileError";
  }
}

/** An expression's compiled GLSL text plus its resolved EZSL type (scalar/vector/matrix, fixed-size array, or struct instance). */
interface TypedExpr {
  glsl: string;
  type: ResolvedType;
}

/** An EZSL user function's inferred signature — parameters are always `float` (v0.3 scope; see docs/architecture/type-system.md), return type is inferred from the body. */
interface EzslFunction {
  name: string;
  params: string[];
  returns: ResolvedType;
  glsl: string;
}

const SWIZZLE_SETS = ["xyzw", "rgba"];

function isSwizzle(property: string): boolean {
  return SWIZZLE_SETS.some((set) => [...property].every((c) => set.includes(c)));
}

function swizzleResultType(count: number): EzslType {
  return (["float", "vec2", "vec3", "vec4"] as const)[count - 1];
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? `${value}.0` : String(value);
}

function indent(lines: SourceMappedLine[], depth: number): SourceMappedLine[] {
  const prefix = "  ".repeat(depth);
  return lines.map((line) => ({ glsl: prefix + line.glsl, ezslLine: line.ezslLine }));
}

/** Wraps plain GLSL strings with a single shared `.ezsl` source line (or `null`) — the common case where a statement compiles to one or more GLSL lines all attributable to the same source line. */
function mapped(glslLines: string[], ezslLine: number | null): SourceMappedLine[] {
  return glslLines.map((glsl) => ({ glsl, ezslLine }));
}

function describeType(type: ResolvedType): string {
  return glslTypeName(type);
}

/**
 * Compiles a parsed EZSL AST into the codegen IR (`Program`) consumed by
 * `generateFragmentShader`. See docs/architecture/transpiler-pipeline.md
 * (v0.1 core) and docs/architecture/type-system.md (v0.3 hardening: user
 * functions, mat2/3/4, fixed-size arrays, structs) for the full design.
 *
 * High-level: statements are assignments, bounded `for` loops (compiled to
 * a real GLSL `for`, since range bounds are number literals known at
 * compile time), `if`/`else` on a single comparison, and `glsl { ... }`
 * Escape Hatch blocks. The last top-level assignment to `color` becomes the
 * fragment output; every other assignment becomes an intermediate `body`
 * statement — a first assignment to a name declares+types it, a later
 * assignment re-assigns it (this is how loop-accumulated state, e.g.
 * raymarching, is expressed). Free identifiers that aren't builtins or a
 * previously-assigned local are treated as user uniforms, inferred as
 * `float` unless referenced with a vector swizzle.
 */
export function compile(ast: AstProgram, options: CompileOptions = {}): CodegenProgram {
  const stage: ShaderStage = options.stage ?? "fragment";
  const outputName = options.outputName ?? "color";
  const vertexTarget: VertexTarget = options.vertexTarget ?? "three";
  const scope = new TypeScope(stage, vertexTarget);
  const uniforms = new Map<string, Uniform>();
  const customFunctions = new Map<string, CustomFunction>();
  const structs = new Map<string, StructDeclaration>();
  const ezslFunctions = new Map<string, EzslFunction>();
  const bufferNames = new Set(options.bufferNames ?? []);
  let outColor: TypedExpr | undefined;
  // The .ezsl line the top-level `color = ...` (or `glPosition = ...`)
  // assignment came from — tracked separately from `outColor` itself
  // rather than adding a line field to the shared `Expr`/`TypedExpr`
  // shapes (used far more broadly than just this one line), so v0.4/v0.7
  // error-translation/source-mapping can attribute the generated
  // `fragColor = ...`/`gl_Position = ...` line back to real .ezsl source
  // — previously always unmapped (null), a real, if minor, coverage gap:
  // a driver error landing on exactly that line could never be resolved
  // back to .ezsl source. See docs/architecture/devtools-source-maps.md.
  let outColorLine: number | null = null;

  for (const fn of options.customFunctions ?? []) {
    if (fn.name in TYPE_CONSTRUCTORS || fn.name in BUILTIN_FUNCTION_RETURN_TYPES) {
      throw new CompileError(`defineFunction: '${fn.name}' collides with a builtin EZSL function of the same name`, 1, 1);
    }
    if (customFunctions.has(fn.name)) {
      throw new CompileError(`defineFunction: '${fn.name}' is already defined`, 1, 1);
    }
    if (isReservedGlslWord(fn.name)) {
      throw new CompileError(`defineFunction: '${fn.name}' is a reserved GLSL keyword`, 1, 1);
    }
    customFunctions.set(fn.name, fn);
  }

  // Struct declarations are registered before any statement is compiled, so
  // a struct can be referenced (as a field type or constructor) regardless
  // of where in the source it's declared relative to its use — including a
  // field type that forward-references a struct declared later in the file.
  for (const decl of ast.declarations) {
    if (decl.kind !== "StructDeclaration") continue;
    if (structs.has(decl.name)) {
      throw new CompileError(`struct '${decl.name}' is already defined`, decl.pos.line, decl.pos.column);
    }
    if (decl.name in TYPE_CONSTRUCTORS || isReservedGlslWord(decl.name)) {
      throw new CompileError(`struct name '${decl.name}' collides with a builtin GLSL type`, decl.pos.line, decl.pos.column);
    }
    structs.set(decl.name, decl);
  }

  // Now that every struct name is known, validate field types referencing another struct actually exist.
  for (const decl of structs.values()) {
    for (const field of decl.fields) {
      if (!(field.type.base in TYPE_CONSTRUCTORS) && !structs.has(field.type.base)) {
        const suggestion = didYouMean(field.type.base, [...Object.keys(TYPE_CONSTRUCTORS), ...structs.keys()]);
        const hint = suggestion ? ` — did you mean '${suggestion}'?` : "";
        throw new CompileError(
          `struct '${decl.name}' field '${field.name}' has unknown type '${field.type.base}'${hint}`,
          decl.pos.line,
          decl.pos.column,
        );
      }
    }
  }

  function resolveTypeAnnotationType(base: string, pos: { line: number; column: number }): ResolvedType {
    if (base in TYPE_CONSTRUCTORS) return scalarType(TYPE_CONSTRUCTORS[base]);
    if (structs.has(base)) return { kind: "struct", name: base };
    throw new CompileError(`unknown type '${base}'`, pos.line, pos.column);
  }

  function emitInScope(expr: Expression, localScope: TypeScope, localUniforms: Map<string, Uniform>): TypedExpr {
    switch (expr.kind) {
      case "NumberLiteral":
        return { glsl: formatNumber(expr.value), type: scalarType("float") };

      case "Identifier": {
        if (localScope.has(expr.name)) {
          return { glsl: expr.name, type: localScope.get(expr.name)! };
        }
        if (bufferNames.has(expr.name)) {
          throw new CompileError(
            `'${expr.name}' is a pipeline buffer, not a value — use '${expr.name}.sample(uv)' to read a pixel from it`,
            expr.pos.line,
            expr.pos.column,
          );
        }
        // First unknown-identifier use: assume a user uniform of type float,
        // refined later if it's swizzled (see MemberExpression handling).
        const existing = localUniforms.get(expr.name);
        if (existing) return { glsl: `u_${expr.name}`, type: scalarType(existing.type) };
        localUniforms.set(expr.name, { name: expr.name, glslName: `u_${expr.name}`, type: "float" });
        return { glsl: `u_${expr.name}`, type: scalarType("float") };
      }

      case "VectorLiteral": {
        const elements = expr.elements.map((e) => emitInScope(e, localScope, localUniforms));
        const count = elements.length;
        if (count < 2 || count > 4) {
          throw new CompileError(`vector literals must have 2-4 elements, got ${count}`, expr.pos.line, expr.pos.column);
        }
        const type = swizzleResultType(count);
        return { glsl: `${type}(${elements.map((e) => e.glsl).join(", ")})`, type: scalarType(type) };
      }

      case "ArrayLiteral": {
        const elements = expr.elements.map((e) => emitInScope(e, localScope, localUniforms));
        if (elements.length === 0) {
          throw new CompileError("array literals cannot be empty", expr.pos.line, expr.pos.column);
        }
        const firstType = elements[0].type;
        if (firstType.kind !== "scalar") {
          throw new CompileError("array elements must be scalar, vector, or matrix values", expr.pos.line, expr.pos.column);
        }
        for (const el of elements.slice(1)) {
          if (!resolvedTypesEqual(el.type, firstType)) {
            throw new CompileError(
              `array literal has mixed element types (${describeType(firstType)} and ${describeType(el.type)})`,
              expr.pos.line,
              expr.pos.column,
            );
          }
        }
        const elementType = firstType.type;
        const glsl = `${elementType}[${elements.length}](${elements.map((e) => e.glsl).join(", ")})`;
        return { glsl, type: { kind: "array", element: elementType, size: elements.length } };
      }

      case "IndexExpression": {
        const object = emitInScope(expr.object, localScope, localUniforms);
        if (object.type.kind !== "array") {
          throw new CompileError(`'${object.glsl}' is not an array (${describeType(object.type)}) and cannot be indexed`, expr.pos.line, expr.pos.column);
        }
        // GLSL array subscripts must be an `int` expression — a `float` index (even a
        // whole-number one like `0.0`) is a compile error at the driver. A literal
        // integer index is emitted without the `.0` NumberLiteral normally adds;
        // anything else must already be int-typed (e.g. a `for`-loop counter).
        let indexGlsl: string;
        if (expr.index.kind === "NumberLiteral") {
          if (!Number.isInteger(expr.index.value)) {
            throw new CompileError(`array index must be an integer, got ${expr.index.value}`, expr.pos.line, expr.pos.column);
          }
          indexGlsl = String(expr.index.value);
        } else {
          const index = emitInScope(expr.index, localScope, localUniforms);
          if (!(index.type.kind === "scalar" && index.type.type === "int")) {
            throw new CompileError(
              `array index must be an integer, got ${describeType(index.type)}`,
              expr.pos.line,
              expr.pos.column,
            );
          }
          indexGlsl = index.glsl;
        }
        return { glsl: `${object.glsl}[${indexGlsl}]`, type: scalarType(object.type.element) };
      }

      case "CallExpression": {
        const args = expr.args.map((a) => emitInScope(a, localScope, localUniforms));

        if (expr.callee in TYPE_CONSTRUCTORS) {
          const type = TYPE_CONSTRUCTORS[expr.callee];
          return { glsl: `${expr.callee}(${args.map((a) => a.glsl).join(", ")})`, type: scalarType(type) };
        }

        if (structs.has(expr.callee)) {
          const decl = structs.get(expr.callee)!;
          if (args.length !== decl.fields.length) {
            throw new CompileError(
              `struct '${expr.callee}' constructor expects ${decl.fields.length} argument(s), got ${args.length}`,
              expr.pos.line,
              expr.pos.column,
            );
          }
          return { glsl: `${expr.callee}(${args.map((a) => a.glsl).join(", ")})`, type: { kind: "struct", name: expr.callee } };
        }

        const ezslFn = ezslFunctions.get(expr.callee);
        if (ezslFn) {
          if (args.length !== ezslFn.params.length) {
            throw new CompileError(
              `'${expr.callee}' expects ${ezslFn.params.length} argument(s), got ${args.length}`,
              expr.pos.line,
              expr.pos.column,
            );
          }
          return { glsl: `${expr.callee}(${args.map((a) => a.glsl).join(", ")})`, type: ezslFn.returns };
        }

        const customFn = customFunctions.get(expr.callee);
        if (customFn) {
          if (args.length !== customFn.signature.params.length) {
            throw new CompileError(
              `'${expr.callee}' expects ${customFn.signature.params.length} argument(s), got ${args.length}`,
              expr.pos.line,
              expr.pos.column,
            );
          }
          return { glsl: `${expr.callee}(${args.map((a) => a.glsl).join(", ")})`, type: scalarType(customFn.signature.returns) };
        }

        const returnType = BUILTIN_FUNCTION_RETURN_TYPES[expr.callee];
        if (!returnType) {
          const allKnownNames = [
            ...Object.keys(TYPE_CONSTRUCTORS),
            ...Object.keys(BUILTIN_FUNCTION_RETURN_TYPES),
            ...ezslFunctions.keys(),
            ...customFunctions.keys(),
            ...structs.keys(),
          ];
          const suggestion = didYouMean(expr.callee, allKnownNames);
          const hint = suggestion ? ` — did you mean '${suggestion}'?` : "";
          throw new CompileError(`unknown function '${expr.callee}'${hint}`, expr.pos.line, expr.pos.column);
        }
        // Shape-preserving builtins operate component-wise and widen to their vector argument's type.
        const scalarArgTypes = args.map((a) => (a.type.kind === "scalar" ? a.type.type : undefined));
        const type = SHAPE_PRESERVING_FUNCTIONS.has(expr.callee)
          ? (scalarArgTypes.find((t) => t !== undefined && t !== "float") ?? returnType)
          : returnType;
        return { glsl: `${expr.callee}(${args.map((a) => a.glsl).join(", ")})`, type: scalarType(type) };
      }

      case "MemberExpression": {
        const object = emitInScope(expr.object, localScope, localUniforms);

        if (object.type.kind === "struct") {
          const decl = structs.get(object.type.name)!;
          const field = decl.fields.find((f) => f.name === expr.property);
          if (!field) {
            const suggestion = didYouMean(expr.property, decl.fields.map((f) => f.name));
            const hint = suggestion ? ` — did you mean '.${suggestion}'?` : "";
            throw new CompileError(`struct '${object.type.name}' has no field '${expr.property}'${hint}`, expr.pos.line, expr.pos.column);
          }
          const fieldType = resolveTypeAnnotationType(field.type.base, expr.pos);
          const resultType: ResolvedType =
            field.type.arraySize !== null && fieldType.kind === "scalar"
              ? { kind: "array", element: fieldType.type, size: field.type.arraySize }
              : fieldType;
          return { glsl: `${object.glsl}.${expr.property}`, type: resultType };
        }

        if (object.type.kind !== "scalar") {
          throw new CompileError(`'.${expr.property}' is not valid on ${describeType(object.type)}`, expr.pos.line, expr.pos.column);
        }
        if (object.type.type === "mat2" || object.type.type === "mat3" || object.type.type === "mat4") {
          throw new CompileError(`'.${expr.property}' is not valid on a matrix (${object.type.type}) — GLSL has no swizzle syntax for matrices`, expr.pos.line, expr.pos.column);
        }
        if (!isSwizzle(expr.property)) {
          throw new CompileError(`unknown member '.${expr.property}'`, expr.pos.line, expr.pos.column);
        }
        if (expr.property.length > 4) {
          throw new CompileError(`swizzle '.${expr.property}' has more than 4 components`, expr.pos.line, expr.pos.column);
        }
        // Every *letter used* must be a valid component of the source type
        // (e.g. only x/y are valid on a vec2) — the swizzle string's own
        // length can still exceed the source's component count, since GLSL
        // allows repeating components (`vec2.xyx` is a valid vec3-producing
        // swizzle, even though the vec2 source only has x/y).
        const sourceType = object.type.type;
        const validLetters = SWIZZLE_SETS.map((set) => set.slice(0, componentCount(sourceType)));
        const isValid = validLetters.some((allowed) => [...expr.property].every((c) => allowed.includes(c)));
        if (!isValid) {
          throw new CompileError(
            `swizzle '.${expr.property}' is not valid on '${object.glsl}' (${sourceType})`,
            expr.pos.line,
            expr.pos.column,
          );
        }
        const resultType = swizzleResultType(expr.property.length);
        return { glsl: `${object.glsl}.${expr.property}`, type: scalarType(resultType) };
      }

      case "MethodCallExpression": {
        // v0.5 multi-pass: the only method call EZSL recognizes today is
        // `<BufferName>.sample(uv)` — see docs/architecture/multi-pass.md.
        // The receiver must be a bare identifier naming a declared pipeline
        // buffer (not an arbitrary expression) since a buffer reference
        // isn't a real EZSL value with its own type to compute a receiver
        // for; it's purely a name looked up against `bufferNames`.
        if (expr.object.kind !== "Identifier" || !bufferNames.has(expr.object.name)) {
          throw new CompileError(
            `'.${expr.method}(...)' is only valid on a pipeline buffer name (e.g. 'BufferA.sample(uv)')`,
            expr.pos.line,
            expr.pos.column,
          );
        }
        if (expr.method !== "sample") {
          throw new CompileError(`unknown buffer method '.${expr.method}' — only '.sample(uv)' is supported`, expr.pos.line, expr.pos.column);
        }
        if (expr.args.length !== 1) {
          throw new CompileError(`'.sample(...)' takes exactly one argument (a vec2 UV coordinate), got ${expr.args.length}`, expr.pos.line, expr.pos.column);
        }
        const bufferName = expr.object.name;
        const uv = emitInScope(expr.args[0], localScope, localUniforms);
        if (!(uv.type.kind === "scalar" && uv.type.type === "vec2")) {
          throw new CompileError(`'.sample(...)' expects a vec2 UV argument, got ${describeType(uv.type)}`, expr.pos.line, expr.pos.column);
        }
        const glslName = `u_buffer_${bufferName}`;
        if (!uniforms.has(bufferName)) {
          uniforms.set(bufferName, { name: bufferName, glslName, type: "sampler2D" });
        }
        return { glsl: `texture(${glslName}, ${uv.glsl})`, type: scalarType("vec4") };
      }

      case "BinaryExpression": {
        const left = emitInScope(expr.left, localScope, localUniforms);
        const right = emitInScope(expr.right, localScope, localUniforms);
        if (left.type.kind !== "scalar" || right.type.kind !== "scalar") {
          throw new CompileError(
            `operator '${expr.operator}' is not valid between ${describeType(left.type)} and ${describeType(right.type)}`,
            expr.pos.line,
            expr.pos.column,
          );
        }
        const leftType = left.type.type;
        const rightType = right.type.type;
        // A `float` operand combines with anything (GLSL scales a vector/matrix
        // by a scalar component-wise). Otherwise both sides must have matching
        // component counts — vecN op vecN, matN op matN, and vecN * matN (the
        // one mixed case GLSL allows, used for e.g. `uv * rotationMatrix`).
        if (leftType !== "float" && rightType !== "float" && leftType !== rightType) {
          const vecMatPairOk =
            expr.operator === "*" &&
            ((leftType.startsWith("vec") && rightType.startsWith("mat") && leftType[3] === rightType[3]) ||
              (leftType.startsWith("mat") && rightType.startsWith("vec") && leftType[3] === rightType[3]));
          if (!vecMatPairOk) {
            throw new CompileError(
              `operator '${expr.operator}' is not valid between ${leftType} and ${rightType} — shapes don't match`,
              expr.pos.line,
              expr.pos.column,
            );
          }
        }
        // Result type: a `float` operand defers to the other side's type.
        // For a matN * vecN (or vecN * matN) pair specifically, GLSL always
        // produces vecN — a matrix transforming a vector yields a vector,
        // regardless of which operand is written first — so that case must
        // be checked before the general "left wins" default below.
        let resultType: EzslType;
        if (leftType === "float") {
          resultType = rightType;
        } else if (rightType === "float") {
          resultType = leftType;
        } else if (leftType.startsWith("mat") && rightType.startsWith("vec")) {
          resultType = rightType;
        } else {
          resultType = leftType;
        }
        return { glsl: `(${left.glsl} ${expr.operator} ${right.glsl})`, type: scalarType(resultType) };
      }

      case "ComparisonExpression": {
        const left = emitInScope(expr.left, localScope, localUniforms);
        const right = emitInScope(expr.right, localScope, localUniforms);
        return { glsl: `(${left.glsl} ${expr.operator} ${right.glsl})`, type: scalarType("bool") };
      }
    }
  }

  function emit(expr: Expression): TypedExpr {
    return emitInScope(expr, scope, uniforms);
  }

  function emitAssignmentInScope(
    name: string,
    value: TypedExpr,
    pos: { line: number; column: number },
    localScope: TypeScope,
  ): string {
    if (localScope.has(name)) {
      const existing = localScope.get(name)!;
      if (!resolvedTypesEqual(existing, value.type)) {
        throw new CompileError(
          `cannot re-assign '${name}' (${describeType(existing)}) with a value of type ${describeType(value.type)}`,
          pos.line,
          pos.column,
        );
      }
      return `${name} = ${value.glsl};`;
    }
    if (isReservedGlslWord(name)) {
      throw new CompileError(`'${name}' is a reserved GLSL keyword and cannot be used as a variable name`, pos.line, pos.column);
    }
    localScope.set(name, value.type);
    options.onVariableDeclared?.(name, glslTypeName(value.type), pos);
    return `${glslTypeName(value.type)} ${name} = ${value.glsl};`;
  }

  function emitAssignment(name: string, value: TypedExpr, pos: { line: number; column: number }): string {
    return emitAssignmentInScope(name, value, pos, scope);
  }

  /**
   * Escape Hatch blocks are opaque to type inference (the compiler cannot
   * see what a raw GLSL block declares or references), so the one guard
   * that's still possible without parsing GLSL is a textual one: if the raw
   * block *declares* a local (`<type> <name>` / `<type> <name> =`) whose
   * name is already an EZSL local or uniform in scope, that's almost always
   * an accidental collision (the same GLSL identifier would be emitted
   * twice), not intentional shadowing — GLSL has no block scoping that would
   * make it safe. Flag it at compile time instead of letting it surface as
   * a "redefinition" error from the WebGL driver with no `.ezsl` context.
   */
  function checkRawGlslNamespaceCollisions(source: string, pos: { line: number; column: number }): void {
    const glslTypePattern = /^\s*(?:float|int|bool|vec2|vec3|vec4|mat2|mat3|mat4)\s+([A-Za-z_]\w*)\s*[=;)]/gm;
    let match: RegExpExecArray | null;
    while ((match = glslTypePattern.exec(source))) {
      const declaredName = match[1];
      if (scope.has(declaredName) || uniforms.has(declaredName)) {
        throw new CompileError(
          `glsl { ... } block declares '${declaredName}', which collides with an existing EZSL variable of the same name`,
          pos.line,
          pos.column,
        );
      }
    }
  }

  function emitStatementsInScope(
    statements: Statement[],
    depth: number,
    localScope: TypeScope,
    localUniforms: Map<string, Uniform>,
    isTopLevel: boolean,
  ): { lines: SourceMappedLine[]; returned: TypedExpr | undefined } {
    const lines: SourceMappedLine[] = [];
    let returned: TypedExpr | undefined;

    for (const statement of statements) {
      if (statement.kind === "AssignmentStatement") {
        const value = emitInScope(statement.value, localScope, localUniforms);

        if (isTopLevel && depth === 0 && statement.name === outputName) {
          outColor = value;
          outColorLine = statement.pos.line;
          continue;
        }

        lines.push(...indent(mapped([emitAssignmentInScope(statement.name, value, statement.pos, localScope)], statement.pos.line), depth));
        continue;
      }

      if (statement.kind === "ReturnStatement") {
        const value = emitInScope(statement.value, localScope, localUniforms);
        returned = value;
        lines.push(...indent(mapped([`return ${value.glsl};`], statement.pos.line), depth));
        continue;
      }

      if (statement.kind === "IfStatement") {
        const condition = emitInScope(statement.condition, localScope, localUniforms);
        lines.push(...indent(mapped([`if (${condition.glsl}) {`], statement.pos.line), depth));
        const consequentResult = emitStatementsInScope(statement.consequent, depth + 1, localScope, localUniforms, isTopLevel);
        lines.push(...consequentResult.lines);
        returned = returned ?? consequentResult.returned;
        if (statement.alternate) {
          lines.push(...indent(mapped(["} else {"], statement.pos.line), depth));
          const alternateResult = emitStatementsInScope(statement.alternate, depth + 1, localScope, localUniforms, isTopLevel);
          lines.push(...alternateResult.lines);
          returned = returned ?? alternateResult.returned;
        }
        lines.push(...indent(mapped(["}"], statement.pos.line), depth));
        continue;
      }

      if (statement.kind === "ForStatement") {
        if (statement.to <= statement.from) {
          throw new CompileError(
            `for-loop range ${statement.from}..${statement.to} is empty (end must be greater than start)`,
            statement.pos.line,
            statement.pos.column,
          );
        }
        if (isReservedGlslWord(statement.variable)) {
          throw new CompileError(
            `'${statement.variable}' is a reserved GLSL keyword and cannot be used as a for-loop variable name`,
            statement.pos.line,
            statement.pos.column,
          );
        }
        localScope.set(statement.variable, scalarType("int"));
        options.onVariableDeclared?.(statement.variable, "int", statement.pos);
        const header = `for (int ${statement.variable} = ${statement.from}; ${statement.variable} < ${statement.to}; ${statement.variable}++) {`;
        lines.push(...indent(mapped([header], statement.pos.line), depth));
        const bodyResult = emitStatementsInScope(statement.body, depth + 1, localScope, localUniforms, isTopLevel);
        lines.push(...bodyResult.lines);
        returned = returned ?? bodyResult.returned;
        lines.push(...indent(mapped(["}"], statement.pos.line), depth));
        continue;
      }

      if (statement.kind === "RawGlslStatement") {
        checkRawGlslNamespaceCollisions(statement.source, statement.pos);
        // The lexer captures everything between the block's braces verbatim, starting
        // right after the `glsl {` on statement.pos.line — so raw line N of the capture
        // (0-indexed, before trimming) is physically on .ezsl source line
        // `statement.pos.line + N`. This gives the Escape Hatch a real per-line source
        // map instead of only block-granularity, letting a driver error inside a
        // glsl { ... } block point at the exact offending .ezsl line.
        const allRawLines = statement.source.split("\n");
        const trimmedWithLineNumbers = allRawLines
          .map((l, i) => ({ text: l.trimEnd(), ezslLine: statement.pos.line + i }))
          .filter((l, i, arr) => !(l.text === "" && (i === 0 || i === arr.length - 1)));
        const header = { glsl: `// ezsl:line ${statement.pos.line} (glsl { ... } Escape Hatch)`, ezslLine: statement.pos.line };
        const rawMapped = trimmedWithLineNumbers.map((l) => ({ glsl: l.text, ezslLine: l.ezslLine }));
        lines.push(...indent([header, ...rawMapped], depth));
        continue;
      }
    }

    return { lines, returned };
  }

  /** Compiles a `fn` declaration's body in an isolated scope (only builtins + its own params visible) to infer its return type. */
  function compileFunctionDeclaration(decl: FunctionDeclaration): EzslFunction {
    if (decl.name in TYPE_CONSTRUCTORS || decl.name in BUILTIN_FUNCTION_RETURN_TYPES || customFunctions.has(decl.name)) {
      throw new CompileError(`function '${decl.name}' collides with a builtin or custom function of the same name`, decl.pos.line, decl.pos.column);
    }
    if (isReservedGlslWord(decl.name)) {
      throw new CompileError(`'${decl.name}' is a reserved GLSL keyword and cannot be used as a function name`, decl.pos.line, decl.pos.column);
    }

    const fnScope = TypeScope.withBuiltinsOnly(stage, vertexTarget);
    const fnUniforms = new Map<string, Uniform>(); // uniforms referenced inside a function body are folded into the outer program's uniforms below
    for (const param of decl.params) {
      if (isReservedGlslWord(param)) {
        throw new CompileError(`'${param}' is a reserved GLSL keyword and cannot be used as a parameter name`, decl.pos.line, decl.pos.column);
      }
      fnScope.set(param, scalarType("float")); // v0.3 scope: EZSL function parameters are always float — see docs/architecture/type-system.md
    }

    const { lines, returned } = emitStatementsInScope(decl.body, 1, fnScope, fnUniforms, false);
    for (const [name, uniform] of fnUniforms) {
      if (!uniforms.has(name)) uniforms.set(name, uniform);
    }

    if (!returned) {
      throw new CompileError(`function '${decl.name}' has no 'return' statement`, decl.pos.line, decl.pos.column);
    }

    const paramList = decl.params.map((p) => `float ${p}`).join(", ");
    const glsl = `${glslTypeName(returned.type)} ${decl.name}(${paramList}) {\n${lines.map((l) => l.glsl).join("\n")}\n}`;

    return { name: decl.name, params: decl.params, returns: returned.type, glsl };
  }

  for (const decl of ast.declarations) {
    if (decl.kind !== "FunctionDeclaration") continue;
    ezslFunctions.set(decl.name, compileFunctionDeclaration(decl));
  }

  const { lines: body } = emitStatementsInScope(ast.statements, 0, scope, uniforms, true);

  if (!outColor) {
    throw new CompileError(`program must assign to '${outputName}'`, 1, 1);
  }
  if (outColor.type.kind !== "scalar") {
    throw new CompileError(`'${outputName}' must be a vector, got ${describeType(outColor.type)}`, 1, 1);
  }

  const finalColor: Expr =
    outColor.type.type === "vec4"
      ? { glsl: outColor.glsl, type: "vec4" }
      : { glsl: `vec4(${outColor.glsl}, 1.0)`, type: "vec4" };

  const structDecls = [...structs.values()].map((decl) => {
    const fields = decl.fields
      .map((f) => `  ${f.type.base}${f.type.arraySize !== null ? `[${f.type.arraySize}]` : ""} ${f.name};`)
      .join("\n");
    return `struct ${decl.name} {\n${fields}\n};`;
  });
  const functionDecls = [...ezslFunctions.values()].map((fn) => fn.glsl);
  const customFunctionDecls = [...customFunctions.values()].map((fn) => fn.glslSource.trim());

  return {
    uniforms: [...uniforms.values()],
    body,
    outColor: finalColor,
    outColorLine,
    topLevel: [...structDecls, ...customFunctionDecls, ...functionDecls],
  };
}
