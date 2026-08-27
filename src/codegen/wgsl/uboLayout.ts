import type { EzslType } from "../types.js";

/**
 * WGSL uniform-address-space struct member layout rules (WGSL spec §13.4,
 * "alignment and size" — this is WGSL's own rule set, not GLSL's `std140`,
 * though the two happen to agree on every scalar/vector/matrix case EZSL
 * currently supports). Every uniform buffer struct member's byte offset
 * must be a multiple of its `align`; the struct's own size must be rounded
 * up to a multiple of 16. See docs/architecture/webgpu-target.md for the
 * full design and ROADMAP.md's v0.6 trap callout this directly implements.
 */
export interface WgslAlignment {
  /** Required byte alignment for this type as a struct member. */
  align: number;
  /** Byte size of one value of this type. */
  size: number;
  /** The WGSL type name to emit (e.g. `vec3<f32>`, distinct from EZSL's own `vec3`). */
  wgslType: string;
}

const SCALAR_OR_VECTOR_ALIGNMENT: Record<string, WgslAlignment> = {
  float: { align: 4, size: 4, wgslType: "f32" },
  int: { align: 4, size: 4, wgslType: "i32" },
  bool: { align: 4, size: 4, wgslType: "u32" }, // WGSL has no bool-typed uniform member; EZSL's bool is compiler-internal (if-conditions only) and never actually appears as a uniform, but is listed for exhaustiveness.
  vec2: { align: 8, size: 8, wgslType: "vec2<f32>" },
  // vec3's align (16) exceeds its size (12) — the single most common source
  // of silent uniform-buffer corruption across every graphics API with this
  // rule (GLSL std140 included): a vec3 uniform followed immediately by a
  // scalar looks contiguous but isn't — 4 bytes of implicit padding are
  // inserted after the vec3 before the scalar can start. This is exactly
  // ROADMAP.md's v0.6 trap; getting this one row of the table right is the
  // entire point of this file.
  vec3: { align: 16, size: 12, wgslType: "vec3<f32>" },
  vec4: { align: 16, size: 16, wgslType: "vec4<f32>" },
  mat2: { align: 8, size: 16, wgslType: "mat2x2<f32>" },
  mat3: { align: 16, size: 48, wgslType: "mat3x3<f32>" },
  mat4: { align: 16, size: 64, wgslType: "mat4x4<f32>" },
};

/** Returns the WGSL alignment/size/type-name for an EZSL scalar/vector/matrix type — `null` for types with no uniform-buffer-member representation (`sampler2D`; textures are bound outside the uniform buffer entirely, as a separate `texture_2d`/`sampler` binding pair — see docs/architecture/webgpu-target.md). */
export function wgslAlignmentFor(type: EzslType): WgslAlignment | null {
  return SCALAR_OR_VECTOR_ALIGNMENT[type] ?? null;
}

export interface LaidOutMember {
  name: string;
  type: EzslType;
  offset: number;
  align: number;
  size: number;
  wgslType: string;
}

export interface UboLayout {
  members: LaidOutMember[];
  /** Total struct size in bytes, rounded up to a multiple of 16 (WGSL's own struct-in-uniform-address-space requirement, independent of any individual member's alignment). */
  totalSize: number;
}

function roundUpTo(value: number, multiple: number): number {
  return Math.ceil(value / multiple) * multiple;
}

/**
 * Computes WGSL-legal byte offsets for a sequence of uniform members,
 * inserting padding as needed — this is the "automatic layout generation"
 * ROADMAP.md's v0.6 item asks for. Members are laid out in the order
 * given (EZSL's own declaration order is preserved, unlike some layout
 * algorithms that reorder for density — reordering would make the
 * generated WGSL struct's field order not match the `.ezsl` source's
 * uniform declaration order, which would undermine the whole point of a
 * source-mappable, inspectable output; see docs/architecture/webgpu-target.md
 * on why EZSL pads instead of reorders).
 */
export function layoutUniformBuffer(members: { name: string; type: EzslType }[]): UboLayout {
  const laidOut: LaidOutMember[] = [];
  let cursor = 0;

  for (const member of members) {
    const alignment = wgslAlignmentFor(member.type);
    if (!alignment) {
      throw new Error(`layoutUniformBuffer: type '${member.type}' has no uniform-buffer representation (samplers are bound separately)`);
    }
    const offset = roundUpTo(cursor, alignment.align);
    laidOut.push({ name: member.name, type: member.type, offset, align: alignment.align, size: alignment.size, wgslType: alignment.wgslType });
    cursor = offset + alignment.size;
  }

  return { members: laidOut, totalSize: roundUpTo(cursor, 16) };
}
