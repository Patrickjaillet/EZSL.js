import { compileEzsl } from "../src/compiler/index.js";
import { generateWgslFragmentShader } from "../src/codegen/wgsl/generateWgsl.js";

describe("generateWgslFragmentShader", () => {
  it("compiles the gradient example into structurally valid-looking WGSL", () => {
    const program = compileEzsl("color = [uv.x, uv.y, 0.5 + 0.5 * sin(time)]");
    const { source } = generateWgslFragmentShader(program);
    expect(source).toContain("@fragment");
    expect(source).toContain("fn main(@builtin(position) fragCoord: vec4<f32>) -> @location(0) vec4<f32> {");
    expect(source).toContain("return vec4<f32>(vec3<f32>(uv.x, uv.y,");
  });

  it("declares a Uniforms struct with the auto-injected time/resolution builtins even when unreferenced", () => {
    const program = compileEzsl("color = [1.0, 1.0, 1.0]");
    const { source } = generateWgslFragmentShader(program);
    expect(source).toContain("struct Uniforms {");
    expect(source).toContain("time: f32,");
    expect(source).toContain("resolution: vec2<f32>,");
    expect(source).toContain("@group(0) @binding(0) var<uniform> u: Uniforms;");
  });

  it("declares a user-defined float uniform inside the same Uniforms struct", () => {
    const program = compileEzsl("color = [speed, speed, speed]");
    const { source } = generateWgslFragmentShader(program);
    expect(source).toContain("u_speed: f32,");
  });

  it("computes a UBO layout whose member count matches time+resolution+user uniforms", () => {
    const program = compileEzsl("color = [speed, offset, brightness]");
    const { uboLayout } = generateWgslFragmentShader(program);
    expect(uboLayout.members.map((m) => m.name)).toEqual(["time", "resolution", "u_speed", "u_offset", "u_brightness"]);
  });

  it("produces a UBO layout whose total size is a multiple of 16", () => {
    const program = compileEzsl("color = [speed, speed, speed]");
    const { uboLayout } = generateWgslFragmentShader(program);
    expect(uboLayout.totalSize % 16).toBe(0);
  });

  it("translates vector/matrix constructor calls in the body", () => {
    const program = compileEzsl("m = mat3(1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0)\ncolor = [1, 1, 1]");
    const { source } = generateWgslFragmentShader(program);
    expect(source).toContain("mat3x3<f32>(1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0)");
  });

  it("translates a local scalar declaration to WGSL's var-with-type-annotation form", () => {
    const program = compileEzsl("d = length(uv)\ncolor = [d, d, d]");
    const { source } = generateWgslFragmentShader(program);
    expect(source).toContain("var d: f32 = length(uv);");
  });

  it("translates a for-loop header to WGSL's var-based for syntax", () => {
    const program = compileEzsl("total = 0.0\nfor i in 0..4 {\n  total = total + float(i)\n}\ncolor = [total, total, total]");
    const { source } = generateWgslFragmentShader(program);
    expect(source).toContain("for (var i: i32 = 0; i < 4; i++) {");
    expect(source).toContain("f32(i)");
  });

  it("translates if/else headers verbatim (already valid WGSL syntax)", () => {
    const program = compileEzsl("d = length(uv)\nb = 0.0\nif d < 0.5 {\n  b = 1.0\n} else {\n  b = 0.0\n}\ncolor = [b, b, b]");
    const { source } = generateWgslFragmentShader(program);
    expect(source).toContain("if ((d < 0.5)) {");
    expect(source).toContain("} else {");
  });

  it("translates a mod() call to its WGSL-equivalent expression", () => {
    const program = compileEzsl("x = mod(uv.x, 0.5)\ncolor = [x, x, x]");
    const { source } = generateWgslFragmentShader(program);
    expect(source).toContain("(uv.x - 0.5 * floor(uv.x / 0.5))");
  });

  it("emits a texture_2d + separate sampler binding pair for a buffer sample, and rewrites texture() to textureSample()", () => {
    const program = compileEzsl("prev = BufferA.sample(uv)\ncolor = prev", { bufferNames: ["BufferA"] });
    const { source } = generateWgslFragmentShader(program);
    expect(source).toContain("var u_buffer_BufferA: texture_2d<f32>;");
    expect(source).toContain("var u_buffer_BufferA_sampler: sampler;");
    expect(source).toContain("textureSample(u_buffer_BufferA, u_buffer_BufferA_sampler, uv)");
    expect(source).not.toContain("texture(");
  });

  it("flags topLevel (struct/fn/defineFunction) content as an unsupported/untranslated feature", () => {
    const program = compileEzsl("struct Light {\n  intensity: float\n}\nl = Light(1.0)\ncolor = [l.intensity, 0, 0]");
    const { unsupportedFeatures } = generateWgslFragmentShader(program);
    expect(unsupportedFeatures.length).toBeGreaterThan(0);
  });

  it("reports no unsupported features for a program with no topLevel content", () => {
    const program = compileEzsl("color = [1.0, 0.0, 0.0]");
    const { unsupportedFeatures } = generateWgslFragmentShader(program);
    expect(unsupportedFeatures).toEqual([]);
  });

  it("auto-injects a Y-flipped uv and time/resolution prelude matching GLSL codegen's semantics", () => {
    const program = compileEzsl("color = [uv.x, uv.y, 1.0]");
    const { source } = generateWgslFragmentShader(program);
    expect(source).toContain("uv.y = 1.0 - uv.y;");
  });
});
