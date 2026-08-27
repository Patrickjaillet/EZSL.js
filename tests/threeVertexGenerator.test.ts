import { compileEzslVertex } from "../src/compiler/index.js";
import { generateThreeVertexShaderMapped } from "../src/codegen/glslGenerator.js";

describe("generateThreeVertexShaderMapped", () => {
  it("declares position and normal as vec3 in attributes", () => {
    const program = compileEzslVertex("glPosition = projectionMatrix * modelViewMatrix * vec4(position, 1.0)");
    const { source } = generateThreeVertexShaderMapped(program);
    expect(source).toContain("in vec3 position;");
    expect(source).toContain("in vec3 normal;");
  });

  it("declares only the Three.js matrix uniforms actually referenced", () => {
    const program = compileEzslVertex("glPosition = projectionMatrix * modelViewMatrix * vec4(position, 1.0)");
    const { source } = generateThreeVertexShaderMapped(program);
    expect(source).toContain("uniform mat4 modelViewMatrix;");
    expect(source).toContain("uniform mat4 projectionMatrix;");
    expect(source).not.toContain("uniform mat4 modelMatrix;");
    expect(source).not.toContain("uniform mat3 normalMatrix;");
  });

  it("declares modelMatrix and normalMatrix when referenced", () => {
    const program = compileEzslVertex(
      "worldPos = modelMatrix * vec4(position, 1.0)\nworldNormal = normalMatrix * normal\nglPosition = projectionMatrix * modelViewMatrix * vec4(position, 1.0)",
    );
    const { source } = generateThreeVertexShaderMapped(program);
    expect(source).toContain("uniform mat4 modelMatrix;");
    expect(source).toContain("uniform mat3 normalMatrix;");
  });

  it("declares user uniforms without the Three.js builtins interfering", () => {
    const program = compileEzslVertex(
      "x = amplitude\nglPosition = projectionMatrix * modelViewMatrix * vec4(position + vec3(0.0, x, 0.0), 1.0)",
    );
    const { source } = generateThreeVertexShaderMapped(program);
    expect(source).toContain("uniform float u_amplitude;");
  });

  it("writes the final expression to gl_Position", () => {
    const program = compileEzslVertex("glPosition = projectionMatrix * modelViewMatrix * vec4(position, 1.0)");
    const { source } = generateThreeVertexShaderMapped(program);
    expect(source).toContain("gl_Position = ((projectionMatrix * modelViewMatrix) * vec4(position, 1.0));");
  });

  it("produces a source map with a valid #version line and no crash on an empty body", () => {
    const program = compileEzslVertex("glPosition = vec4(position, 1.0)");
    const { source, sourceMap } = generateThreeVertexShaderMapped(program);
    expect(source).toContain("#version 300 es");
    expect(sourceMap.size).toBeGreaterThan(0);
  });

  it("maps a body line's GLSL line back to its .ezsl source line", () => {
    const program = compileEzslVertex("d = position * 2.0\nglPosition = vec4(d, 1.0)");
    const { source, sourceMap } = generateThreeVertexShaderMapped(program);
    const glslLines = source.split("\n");
    const lineNumber = glslLines.findIndex((l) => l.includes("vec3 d =")) + 1;
    expect(lineNumber).toBeGreaterThan(0);
    expect(sourceMap.get(lineNumber)).toBe(1);
  });

  it("omits the #version line when includeVersionDirective is false (regression: Three.js + glslVersion GLSL3 supplies its own, and a second one anywhere else is a hard compile error)", () => {
    const program = compileEzslVertex("glPosition = vec4(position, 1.0)");
    const source = generateThreeVertexShaderMapped(program, false).source;
    expect(source).not.toContain("#version 300 es");
    expect(source).toContain("in vec3 position;");
  });
});
