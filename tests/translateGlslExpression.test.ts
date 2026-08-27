import { translateGlslExpressionToWgsl, translateGlslStatementToWgsl } from "../src/codegen/wgsl/translateGlslExpression.js";

describe("translateGlslExpressionToWgsl", () => {
  it("translates vec2/vec3/vec4 constructor calls to their WGSL <f32> form", () => {
    expect(translateGlslExpressionToWgsl("vec3(1.0, 0.0, 0.0)")).toBe("vec3<f32>(1.0, 0.0, 0.0)");
    expect(translateGlslExpressionToWgsl("vec2(uv.x, uv.y)")).toBe("vec2<f32>(uv.x, uv.y)");
    expect(translateGlslExpressionToWgsl("vec4(rgb, 1.0)")).toBe("vec4<f32>(rgb, 1.0)");
  });

  it("translates float(x) casts to f32(x)", () => {
    expect(translateGlslExpressionToWgsl("float(i)")).toBe("f32(i)");
  });

  it("translates mat2/mat3/mat4 constructor calls", () => {
    expect(translateGlslExpressionToWgsl("mat2(1.0, 0.0, 0.0, 1.0)")).toBe("mat2x2<f32>(1.0, 0.0, 0.0, 1.0)");
    expect(translateGlslExpressionToWgsl("mat4(1.0)")).toBe("mat4x4<f32>(1.0)");
  });

  it("translates nested constructor calls (vec4 wrapping a vec3)", () => {
    expect(translateGlslExpressionToWgsl("vec4(vec3(uv.x, uv.y, 0.5), 1.0)")).toBe("vec4<f32>(vec3<f32>(uv.x, uv.y, 0.5), 1.0)");
  });

  it("translates texture() calls to textureSample() with a paired _sampler binding", () => {
    expect(translateGlslExpressionToWgsl("texture(u_buffer_BufferA, uv)")).toBe(
      "textureSample(u_buffer_BufferA, u_buffer_BufferA_sampler, uv)",
    );
  });

  it("leaves unrelated builtin calls (sin, length, normalize, mix, clamp) unchanged", () => {
    expect(translateGlslExpressionToWgsl("sin(time)")).toBe("sin(time)");
    expect(translateGlslExpressionToWgsl("length(uv)")).toBe("length(uv)");
    expect(translateGlslExpressionToWgsl("normalize(v)")).toBe("normalize(v)");
    expect(translateGlslExpressionToWgsl("mix(a, b, t)")).toBe("mix(a, b, t)");
    expect(translateGlslExpressionToWgsl("clamp(x, 0.0, 1.0)")).toBe("clamp(x, 0.0, 1.0)");
  });

  it("translates mod(a, b) to GLSL-equivalent WGSL (WGSL has no mod builtin)", () => {
    expect(translateGlslExpressionToWgsl("mod(total, 2.0)")).toBe("(total - 2.0 * floor(total / 2.0))");
  });

  it("leaves swizzles, arithmetic, and plain identifiers untouched", () => {
    expect(translateGlslExpressionToWgsl("(uv.x + uv.y)")).toBe("(uv.x + uv.y)");
    expect(translateGlslExpressionToWgsl("uv.xyz")).toBe("uv.xyz");
  });
});

describe("translateGlslStatementToWgsl", () => {
  it("translates a scalar local declaration to WGSL's var-with-type-annotation form", () => {
    expect(translateGlslStatementToWgsl("float d = length(uv);")).toBe("var d: f32 = length(uv);");
  });

  it("translates a vector local declaration", () => {
    expect(translateGlslStatementToWgsl("vec3 trail = vec3(1.0, 0.0, 0.0);")).toBe(
      "var trail: vec3<f32> = vec3<f32>(1.0, 0.0, 0.0);",
    );
  });

  it("preserves leading indentation on a declaration", () => {
    expect(translateGlslStatementToWgsl("  float x = 1.0;")).toBe("  var x: f32 = 1.0;");
  });

  it("leaves a re-assignment (no type prefix) unchanged in structure, only translating its RHS", () => {
    expect(translateGlslStatementToWgsl("total = mod(total, 2.0);")).toBe(
      "total = (total - 2.0 * floor(total / 2.0));",
    );
  });

  it("leaves a bare control-flow line (if/for header, closing brace) unchanged", () => {
    expect(translateGlslStatementToWgsl("if ((d < 0.5)) {")).toBe("if ((d < 0.5)) {");
    expect(translateGlslStatementToWgsl("}")).toBe("}");
  });

  it("translates a for-loop int declaration inline within the header, leaving the header structurally GLSL-shaped (handled separately by the WGSL statement emitter, not this function)", () => {
    // for-loop headers are emitted as a single already-complete GLSL line by
    // compile.ts and are handled by generateWgslFragmentShader's own
    // for-header translation, not by this general statement translator —
    // this test documents that boundary rather than asserting a specific
    // (currently unsupported) rewrite here.
    const header = "for (int i = 0; i < 4; i++) {";
    expect(translateGlslStatementToWgsl(header)).toBe(header);
  });
});
