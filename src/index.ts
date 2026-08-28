export {
  generateFragmentShader,
  generateFragmentShaderMapped,
  generateVertexShader,
  generateThreeVertexShaderMapped,
  generateBabylonVertexShaderMapped,
} from "./codegen/glslGenerator.js";
export type { SourceMap, GeneratedFragmentShader, GeneratedHostVertexShader } from "./codegen/glslGenerator.js";
export { mount, mountToCanvas2D } from "./runtime/bootstrap.js";
export type { EzslRuntimeHandle, MountOptions, Canvas2DHandle, MountToCanvas2DOptions } from "./runtime/bootstrap.js";
export { createPipeline, PipelineError } from "./runtime/pipeline.js";
export type { PipelineOptions, PassSource, BufferFormat, EzslPipelineHandle } from "./runtime/pipeline.js";
export type { Program, VertexProgram, Uniform, Expr, EzslType, FunctionSignature, SourceMappedLine } from "./codegen/types.js";
export {
  compileEzsl,
  compileEzslVertex,
  defineFunction,
  tokenize,
  parse,
  compile,
  LexError,
  ParseError,
  CompileError,
  collectVariableDeclarations,
} from "./compiler/index.js";
export type { CompileOptions, CustomFunction, VariableDeclaration } from "./compiler/index.js";
export type { VertexTarget } from "./compiler/typeInference.js";
export { createThreeMaterial } from "./integrations/three.js";
export type {
  ThreeShaderMaterialLike,
  ThreeShaderMaterialConstructor,
  CreateThreeMaterialOptions,
  ThreeMaterialHandle,
} from "./integrations/three.js";
export { createBabylonMaterial, dispatchBabylonUniform } from "./integrations/babylon.js";
export type {
  BabylonShaderMaterialLike,
  BabylonShaderMaterialConstructor,
  CreateBabylonMaterialOptions,
  BabylonMaterialHandle,
} from "./integrations/babylon.js";
export type { Token, TokenType } from "./lexer/tokens.js";
export type * as Ast from "./parser/ast.js";
export {
  translateShaderError,
  parseCompileLog,
  translateDiagnostic,
  formatDiagnostic,
  formatDiagnostics,
} from "./errors/translateShaderError.js";
export type { ParsedDiagnostic, TranslatedDiagnostic } from "./errors/translateShaderError.js";
export { generateWgslFragmentShader } from "./codegen/wgsl/generateWgsl.js";
export type { WgslGenerationResult } from "./codegen/wgsl/generateWgsl.js";
export { layoutUniformBuffer, wgslAlignmentFor } from "./codegen/wgsl/uboLayout.js";
export type { WgslAlignment, LaidOutMember, UboLayout } from "./codegen/wgsl/uboLayout.js";
export { generateEzslSourceMap, sourceMapComment } from "./errors/generateSourceMap.js";
export type { SourceMapV3 } from "./errors/generateSourceMap.js";
