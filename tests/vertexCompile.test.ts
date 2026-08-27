import { compileEzslVertex } from "../src/compiler/index.js";
import { CompileError } from "../src/compiler/compile.js";
import type { VertexProgram } from "../src/codegen/types.js";

function bodyGlsl(program: VertexProgram): string[] {
  return program.body.map((l) => l.glsl);
}

describe("compileEzslVertex", () => {
  it("compiles a minimal passthrough vertex program", () => {
    const program = compileEzslVertex("glPosition = projectionMatrix * modelViewMatrix * vec4(position, 1.0)");
    expect(program.outPosition.type).toBe("vec4");
    // '*' is left-associative in EZSL grammar, so this is (projectionMatrix * modelViewMatrix) * vec4(...) —
    // mat4 * mat4 = mat4, then mat4 * vec4 = vec4, so the overall type is correctly vec4 with no re-wrapping.
    expect(program.outPosition.glsl).toBe("((projectionMatrix * modelViewMatrix) * vec4(position, 1.0))");
  });

  it("recognizes position and normal as vec3 attributes without declaring them as uniforms", () => {
    const program = compileEzslVertex(
      "n = normal\np = position\nglPosition = projectionMatrix * modelViewMatrix * vec4(p + n * 0.1, 1.0)",
    );
    expect(program.uniforms).toEqual([]);
  });

  it("recognizes Three.js's standard matrix uniforms by their real names, without a u_ prefix", () => {
    const program = compileEzslVertex("glPosition = projectionMatrix * modelViewMatrix * vec4(position, 1.0)");
    expect(bodyGlsl(program).join("\n") + program.outPosition.glsl).not.toContain("u_projectionMatrix");
    expect(program.outPosition.glsl).toContain("projectionMatrix");
    expect(program.outPosition.glsl).toContain("modelViewMatrix");
  });

  it("recognizes modelMatrix and normalMatrix too", () => {
    const program = compileEzslVertex(
      "worldPos = modelMatrix * vec4(position, 1.0)\nworldNormal = normalMatrix * normal\nglPosition = projectionMatrix * modelViewMatrix * vec4(position, 1.0)",
    );
    expect(bodyGlsl(program)).toContain("vec4 worldPos = (modelMatrix * vec4(position, 1.0));");
    expect(bodyGlsl(program)).toContain("vec3 worldNormal = (normalMatrix * normal);");
  });

  it("still treats an unrecognized identifier as an implicit user uniform", () => {
    const program = compileEzslVertex("x = amplitude\nglPosition = projectionMatrix * modelViewMatrix * vec4(position + vec3(0.0, x, 0.0), 1.0)");
    expect(program.uniforms).toEqual([{ name: "amplitude", glslName: "u_amplitude", type: "float" }]);
  });

  it("throws CompileError when the program never assigns to glPosition", () => {
    expect(() => compileEzslVertex("x = position")).toThrow(CompileError);
  });

  it("does NOT treat 'color' as special in vertex stage (fragment-only concept)", () => {
    // 'color' with no glPosition assignment should still fail — color has no special meaning here.
    expect(() => compileEzslVertex("color = vec4(1.0)")).toThrow(CompileError);
  });

  it("supports ordinary EZSL control flow (for/if) in vertex source", () => {
    const program = compileEzslVertex(
      "displaced = position\nfor i in 0..1 {\n  displaced = displaced + normal * 0.01\n}\nglPosition = projectionMatrix * modelViewMatrix * vec4(displaced, 1.0)",
    );
    expect(bodyGlsl(program).some((l) => l.includes("for (int i"))).toBe(true);
  });

  it("supports swizzling position/normal like any other vec3", () => {
    const program = compileEzslVertex("x = position.x\nglPosition = projectionMatrix * modelViewMatrix * vec4(position.x, position.y, position.z, 1.0)");
    expect(bodyGlsl(program)).toContain("float x = position.x;");
  });
});
