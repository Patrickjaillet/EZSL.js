import { tokenize, LexError } from "../lexer/tokenizer.js";
import { parse, ParseError } from "../parser/parser.js";
import { compile, CompileError } from "./compile.js";
import type { CompileOptions, CustomFunction } from "./compile.js";
import type { VertexTarget } from "./typeInference.js";
import type { FunctionSignature, Program as CodegenProgram, VertexProgram } from "../codegen/types.js";

/** Full EZSL v0.1/v0.2 pipeline: source text -> tokens -> AST -> codegen IR. */
export function compileEzsl(source: string, options: CompileOptions = {}): CodegenProgram {
  const tokens = tokenize(source);
  const ast = parse(tokens);
  return compile(ast, options);
}

/**
 * Compiles vertex-stage EZSL source into a `VertexProgram`, for either the
 * Three.js integration (`target: "three"`, the default — see
 * docs/architecture/three-integration.md) or the Babylon.js integration
 * (`target: "babylon"` — see docs/architecture/babylon-integration.md).
 * Builtins depend on `target`: for `"three"`, `position`/`normal`
 * (per-vertex attributes) and Three.js's own
 * `modelMatrix`/`modelViewMatrix`/`projectionMatrix`/`normalMatrix`
 * uniforms; for `"babylon"`, `position`/`normal`/`uv` and Babylon's own
 * `world`/`worldView`/`worldViewProjection`/`view`/`projection`/
 * `viewProjection`/`cameraPosition` uniforms — both auto-mapped into scope
 * under their real, host-specific names (not EZSL-invented `u_`-prefixed
 * ones). The program must assign exactly one top-level `glPosition` (not
 * `color` — there's no fragment output at this stage).
 *
 * Internally this is `compile()` with `stage: "vertex"`,
 * `outputName: "glPosition"`, and `vertexTarget: target` — none of these
 * are exposed directly on `compileEzsl`/`compile` because the *result*
 * shape also differs (`VertexProgram`, no `topLevel`/struct-and-function
 * support yet), and that remapping only makes sense to do once, here. A
 * single `target` parameter (rather than two separate public functions,
 * e.g. `compileEzslVertexForBabylon`) is deliberate: both targets produce
 * the identical `VertexProgram` shape, only the builtin scope differs.
 */
export function compileEzslVertex(
  source: string,
  options: Omit<CompileOptions, "stage" | "outputName" | "vertexTarget"> = {},
  target: VertexTarget = "three",
): VertexProgram {
  const tokens = tokenize(source);
  const ast = parse(tokens);
  const program = compile(ast, { ...options, stage: "vertex", outputName: "glPosition", vertexTarget: target });
  return { uniforms: program.uniforms, body: program.body, outPosition: program.outColor };
}

/**
 * Registers a custom GLSL function (v0.2 Escape Hatch), callable from EZSL
 * source by `name` and emitted verbatim at file scope. Pass the result via
 * `compileEzsl(source, { customFunctions: [...] })`. See
 * docs/architecture/escape-hatch.md.
 */
export function defineFunction(name: string, glslSource: string, signature: FunctionSignature): CustomFunction {
  return { name, glslSource, signature };
}

export { tokenize, LexError, parse, ParseError, compile, CompileError };
export type { CompileOptions, CustomFunction } from "./compile.js";

/** One local variable declaration's inferred type, as reported by `CompileOptions.onVariableDeclared`. */
export interface VariableDeclaration {
  name: string;
  type: string;
  line: number;
  column: number;
}

/**
 * Compiles `source` and returns every local variable declaration
 * `CompileOptions.onVariableDeclared` would report, as a flat list — a
 * small convenience wrapper for tooling (v0.7 VS Code extension hover
 * support, see `docs/architecture/vscode-extension.md`) that just wants
 * "what are all the declared locals and their types," without wiring the
 * callback itself. Unlike `compileEzsl`, this **does not throw** on a
 * `LexError`/`ParseError`/`CompileError` — it returns whatever
 * declarations were collected before the failure (possibly none), since
 * the intended caller (a hover provider running against a document being
 * actively edited) needs to keep working on invalid/incomplete
 * intermediate states rather than showing nothing at all. Any other error
 * (a real bug, not a user source error) is still rethrown.
 */
export function collectVariableDeclarations(source: string, options: CompileOptions = {}): VariableDeclaration[] {
  const declarations: VariableDeclaration[] = [];
  try {
    const tokens = tokenize(source);
    const ast = parse(tokens);
    compile(ast, {
      ...options,
      onVariableDeclared: (name, type, pos) => {
        declarations.push({ name, type, line: pos.line, column: pos.column });
        options.onVariableDeclared?.(name, type, pos);
      },
    });
  } catch (error) {
    if (error instanceof LexError || error instanceof ParseError || error instanceof CompileError) {
      return declarations;
    }
    throw error;
  }
  return declarations;
}
