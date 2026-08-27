import { compileEzsl } from "../src/compiler/index.js";
import { CompileError } from "../src/compiler/compile.js";
import type { Program } from "../src/codegen/types.js";

function bodyGlsl(program: Program): string[] {
  return program.body.map((l) => l.glsl);
}

describe("multi-pass buffer sampling (BufferName.sample(uv))", () => {
  it("compiles a buffer sample into a texture() call and a sampler2D uniform", () => {
    const program = compileEzsl("prev = BufferA.sample(uv)\ncolor = prev", { bufferNames: ["BufferA"] });
    expect(bodyGlsl(program)).toContain("vec4 prev = texture(u_buffer_BufferA, uv);");
    expect(program.uniforms).toContainEqual({ name: "BufferA", glslName: "u_buffer_BufferA", type: "sampler2D" });
  });

  it("declares a uniform sampler2D in the generated GLSL", async () => {
    const { generateFragmentShader } = await import("../src/codegen/glslGenerator.js");
    const program = compileEzsl("prev = BufferA.sample(uv)\ncolor = prev", { bufferNames: ["BufferA"] });
    const glsl = generateFragmentShader(program);
    expect(glsl).toContain("uniform sampler2D u_buffer_BufferA;");
  });

  it("sampling with a non-uv expression is still accepted as long as it's vec2", () => {
    const program = compileEzsl(
      "offsetUv = uv + [0.01, 0.0]\nprev = BufferA.sample(offsetUv)\ncolor = prev",
      { bufferNames: ["BufferA"] },
    );
    expect(bodyGlsl(program)).toContain("vec4 prev = texture(u_buffer_BufferA, offsetUv);");
  });

  it("multiple distinct buffers each get their own sampler2D uniform", () => {
    const program = compileEzsl(
      "a = BufferA.sample(uv)\nb = BufferB.sample(uv)\ncolor = a + b",
      { bufferNames: ["BufferA", "BufferB"] },
    );
    const names = program.uniforms.map((u) => u.name).sort();
    expect(names).toEqual(["BufferA", "BufferB"]);
  });

  it("sampling the same buffer twice reuses one uniform declaration", () => {
    const program = compileEzsl(
      "a = BufferA.sample(uv)\nb = BufferA.sample(uv + [0.01, 0.0])\ncolor = a + b",
      { bufferNames: ["BufferA"] },
    );
    expect(program.uniforms.filter((u) => u.name === "BufferA")).toHaveLength(1);
  });

  it("referencing a declared buffer name directly (not via .sample) is a CompileError", () => {
    expect(() => compileEzsl("x = BufferA\ncolor = [1, 1, 1]", { bufferNames: ["BufferA"] })).toThrow(CompileError);
  });

  it("calling .sample on an undeclared name is a CompileError, not an implicit uniform", () => {
    expect(() => compileEzsl("x = NotABuffer.sample(uv)\ncolor = [1, 1, 1]")).toThrow(CompileError);
  });

  it("calling an unknown method on a declared buffer is a CompileError", () => {
    expect(() => compileEzsl("x = BufferA.blah(uv)\ncolor = [1, 1, 1]", { bufferNames: ["BufferA"] })).toThrow(
      CompileError,
    );
  });

  it("calling .sample with the wrong argument count is a CompileError", () => {
    expect(() => compileEzsl("x = BufferA.sample(uv, uv)\ncolor = [1, 1, 1]", { bufferNames: ["BufferA"] })).toThrow(
      CompileError,
    );
  });

  it("calling .sample with a non-vec2 argument is a CompileError", () => {
    expect(() => compileEzsl("x = BufferA.sample(1.0)\ncolor = [1, 1, 1]", { bufferNames: ["BufferA"] })).toThrow(
      CompileError,
    );
  });

  it("a buffer's sampled result (vec4) can be used directly as color", () => {
    const program = compileEzsl("color = BufferA.sample(uv)", { bufferNames: ["BufferA"] });
    expect(program.outColor.glsl).toBe("texture(u_buffer_BufferA, uv)");
  });

  it("without bufferNames declared, .sample on any identifier is rejected (no ambient buffers)", () => {
    expect(() => compileEzsl("x = BufferA.sample(uv)\ncolor=[1,1,1]")).toThrow(CompileError);
  });
});
