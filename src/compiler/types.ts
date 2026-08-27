import type { EzslType } from "../codegen/types.js";

/**
 * A resolved EZSL value type during compilation — richer than the codegen
 * IR's `EzslType` (which is scalar/vector/matrix only, since that's all a
 * GLSL type annotation string needs to be). `ResolvedType` additionally
 * covers fixed-size arrays and struct instances, both of which need extra
 * data (element type + size; struct name) that a bare `EzslType` string
 * can't carry. Kept separate from `EzslType` rather than folding arrays/
 * structs into it, since most of the compiler (builtins, swizzles, binary
 * ops) only ever deals with scalars/vectors/matrices and shouldn't have to
 * account for "what if this is secretly an array" at every type check.
 */
export type ResolvedType =
  | { kind: "scalar"; type: EzslType }
  | { kind: "array"; element: EzslType; size: number }
  | { kind: "struct"; name: string }
  | { kind: "sampler2D"; bufferName: string };

export function scalarType(type: EzslType): ResolvedType {
  return { kind: "scalar", type };
}

/** GLSL type annotation string for a resolved type — e.g. `float`, `float[8]`, `Light`, `sampler2D`. */
export function glslTypeName(type: ResolvedType): string {
  if (type.kind === "scalar") return type.type;
  if (type.kind === "array") return `${type.element}[${type.size}]`;
  if (type.kind === "sampler2D") return "sampler2D";
  return type.name;
}

export function resolvedTypesEqual(a: ResolvedType, b: ResolvedType): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "scalar" && b.kind === "scalar") return a.type === b.type;
  if (a.kind === "array" && b.kind === "array") return a.element === b.element && a.size === b.size;
  if (a.kind === "struct" && b.kind === "struct") return a.name === b.name;
  if (a.kind === "sampler2D" && b.kind === "sampler2D") return a.bufferName === b.bufferName;
  return false;
}
