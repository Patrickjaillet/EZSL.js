import { layoutUniformBuffer, wgslAlignmentFor } from "../src/codegen/wgsl/uboLayout.js";

describe("wgslAlignmentFor", () => {
  it("float: align 4, size 4", () => expect(wgslAlignmentFor("float")).toEqual({ align: 4, size: 4, wgslType: "f32" }));
  it("vec2: align 8, size 8", () => expect(wgslAlignmentFor("vec2")).toEqual({ align: 8, size: 8, wgslType: "vec2<f32>" }));
  it("vec3: align 16, size 12 (the classic trap — align exceeds size)", () =>
    expect(wgslAlignmentFor("vec3")).toEqual({ align: 16, size: 12, wgslType: "vec3<f32>" }));
  it("vec4: align 16, size 16", () => expect(wgslAlignmentFor("vec4")).toEqual({ align: 16, size: 16, wgslType: "vec4<f32>" }));
  it("mat2: align 8, size 16", () => expect(wgslAlignmentFor("mat2")).toEqual({ align: 8, size: 16, wgslType: "mat2x2<f32>" }));
  it("mat3: align 16, size 48", () => expect(wgslAlignmentFor("mat3")).toEqual({ align: 16, size: 48, wgslType: "mat3x3<f32>" }));
  it("mat4: align 16, size 64", () => expect(wgslAlignmentFor("mat4")).toEqual({ align: 16, size: 64, wgslType: "mat4x4<f32>" }));
  it("sampler2D has no uniform-buffer representation", () => expect(wgslAlignmentFor("sampler2D")).toBeNull());
});

describe("layoutUniformBuffer", () => {
  it("a single float member starts at offset 0", () => {
    const { members, totalSize } = layoutUniformBuffer([{ name: "speed", type: "float" }]);
    expect(members).toEqual([{ name: "speed", type: "float", offset: 0, align: 4, size: 4, wgslType: "f32" }]);
    expect(totalSize).toBe(16); // rounded up to the 16-byte struct minimum
  });

  it("two floats pack contiguously (both align 4, no padding needed)", () => {
    const { members } = layoutUniformBuffer([
      { name: "a", type: "float" },
      { name: "b", type: "float" },
    ]);
    expect(members[0].offset).toBe(0);
    expect(members[1].offset).toBe(4);
  });

  it("vec3 followed by float: no padding needed between them (float's align-4 already divides 12)", () => {
    // position: offset 0, size 12 -> next free byte is 12. intensity has
    // align 4, and 12 is already a multiple of 4, so it starts immediately
    // at 12 with no gap. This is the case that's easy to assume pads (by
    // analogy with GLSL std140, where a vec3 is always followed by padding
    // up to the next 16-byte boundary) but WGSL's own rule doesn't require
    // it here — only a following member whose *own* alignment doesn't
    // divide 12 gets pushed forward. See the next test for the case that
    // actually does need padding (vec3 followed by vec4).
    const { members, totalSize } = layoutUniformBuffer([
      { name: "position", type: "vec3" },
      { name: "intensity", type: "float" },
    ]);
    expect(members[0]).toMatchObject({ name: "position", offset: 0 });
    expect(members[1]).toMatchObject({ name: "intensity", offset: 12 });
    expect(totalSize).toBe(16);
  });

  it("vec3 followed by vec4 DOES require padding (vec4's align-16 pushes it past the vec3's 12-byte size)", () => {
    const { members } = layoutUniformBuffer([
      { name: "position", type: "vec3" },
      { name: "color", type: "vec4" },
    ]);
    expect(members[0]).toMatchObject({ offset: 0, size: 12 });
    // color's align is 16; the next free byte after position (12) is not a
    // multiple of 16, so color is pushed to offset 16, leaving a 4-byte gap.
    expect(members[1]).toMatchObject({ offset: 16 });
  });

  it("vec2 followed by vec2 packs contiguously (both align 8)", () => {
    const { members } = layoutUniformBuffer([
      { name: "a", type: "vec2" },
      { name: "b", type: "vec2" },
    ]);
    expect(members[0].offset).toBe(0);
    expect(members[1].offset).toBe(8);
  });

  it("float followed by vec3 requires padding up to the vec3's 16-byte alignment", () => {
    const { members } = layoutUniformBuffer([
      { name: "a", type: "float" },
      { name: "b", type: "vec3" },
    ]);
    expect(members[0]).toMatchObject({ offset: 0, size: 4 });
    expect(members[1]).toMatchObject({ offset: 16 });
  });

  it("preserves declaration order rather than reordering for density", () => {
    const { members } = layoutUniformBuffer([
      { name: "b", type: "vec3" },
      { name: "a", type: "float" },
    ]);
    expect(members.map((m) => m.name)).toEqual(["b", "a"]);
  });

  it("total size is always rounded up to a multiple of 16", () => {
    expect(layoutUniformBuffer([{ name: "a", type: "float" }]).totalSize % 16).toBe(0);
    expect(layoutUniformBuffer([{ name: "a", type: "vec2" }]).totalSize % 16).toBe(0);
    expect(
      layoutUniformBuffer([
        { name: "a", type: "float" },
        { name: "b", type: "float" },
        { name: "c", type: "float" },
      ]).totalSize % 16,
    ).toBe(0);
  });

  it("a mat4 member is 16-byte aligned and 64 bytes", () => {
    const { members, totalSize } = layoutUniformBuffer([{ name: "m", type: "mat4" }]);
    expect(members[0]).toMatchObject({ offset: 0, align: 16, size: 64 });
    expect(totalSize).toBe(64);
  });

  it("throws when a member has no uniform-buffer representation (sampler2D)", () => {
    expect(() => layoutUniformBuffer([{ name: "tex", type: "sampler2D" }])).toThrow();
  });

  it("an empty member list lays out to zero total size", () => {
    expect(layoutUniformBuffer([]).totalSize).toBe(0);
  });
});
