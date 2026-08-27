import { tokenize, LexError } from "../lexer/tokenizer.js";
import { parse, ParseError } from "../parser/parser.js";
import { compile, CompileError } from "./compile.js";
import type { CompileOptions, CustomFunction } from "./compile.js";
import type { FunctionSignature, Program as CodegenProgram, VertexProgram } from "../codegen/types.js";

/** Full EZSL v0.1/v0.2 pipeline: source text -> tokens -> AST -> codegen IR. */
export function compileEzsl(source: string, options: CompileOptions = {}): CodegenProgram {
  const tokens = tokenize(source);
  const ast = parse(tokens);
  return compile(ast, options);
}

/**
 * Compiles vertex-stage EZSL source (v0.6 Three.js integration — see
 * docs/architecture/three-integration.md) into a `VertexProgram`. Builtins
 * are `position`/`normal` (per-vertex attributes) and Three.js's own
 * `modelMatrix`/`modelViewMatrix`/`projectionMatrix`/`normalMatrix`
 * uniforms, auto-mapped into scope under their real Three.js names. The
 * program must assign exactly one top-level `glPosition` (not `color` —
 * there's no fragment output at this stage).
 *
 * Internally this is `compile()` with `stage: "vertex"` and
 * `outputName: "glPosition"` — the options aren't exposed directly on
 * `compileEzsl`/`compile` because the *result* shape also differs
 * (`VertexProgram`, no `topLevel`/struct-and-function support yet), and
 * that remapping only makes sense to do once, here.
 */
export function compileEzslVertex(source: string, options: Omit<CompileOptions, "stage" | "outputName"> = {}): VertexProgram {
  const tokens = tokenize(source);
  const ast = parse(tokens);
  const program = compile(ast, { ...options, stage: "vertex", outputName: "glPosition" });
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
