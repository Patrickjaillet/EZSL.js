import { generateFragmentShader, generateFragmentShaderMapped, generateVertexShader } from "../src/codegen/glslGenerator.js";
import type { Program } from "../src/codegen/types.js";

describe("generateFragmentShader", () => {
  const gradientProgram: Program = {
    uniforms: [],
    body: [],
    outColor: { type: "vec4", glsl: "vec4(uv.x, uv.y, 0.5 + 0.5 * sin(time), 1.0)" },
    outColorLine: null,
    topLevel: [],
  };

  it("produces a valid GLSL ES 3.00 shader header", () => {
    const source = generateFragmentShader(gradientProgram);
    expect(source).toContain("#version 300 es");
    expect(source).toContain("out vec4 fragColor;");
  });

  it("auto-injects uv, time and resolution boilerplate", () => {
    const source = generateFragmentShader(gradientProgram);
    expect(source).toContain("uniform float u_time;");
    expect(source).toContain("uniform vec2 u_resolution;");
    expect(source).toContain("vec2 uv = gl_FragCoord.xy / u_resolution;");
    expect(source).toContain("uv.y = 1.0 - uv.y;");
  });

  it("writes the final expression to fragColor", () => {
    const source = generateFragmentShader(gradientProgram);
    expect(source).toContain("fragColor = vec4(uv.x, uv.y, 0.5 + 0.5 * sin(time), 1.0);");
  });

  it("declares user uniforms in addition to the auto-injected ones", () => {
    const program: Program = {
      uniforms: [{ name: "tint", glslName: "u_tint", type: "vec3" }],
      body: [],
      outColor: { type: "vec4", glsl: "vec4(u_tint, 1.0)" },
      outColorLine: null,
      topLevel: [],
    };
    const source = generateFragmentShader(program);
    expect(source).toContain("uniform vec3 u_tint;");
  });

  it("emits intermediate body statements before the color write", () => {
    const program: Program = {
      uniforms: [],
      body: [{ glsl: "float d = length(uv - 0.5);", ezslLine: 1 }],
      outColor: { type: "vec4", glsl: "vec4(vec3(d), 1.0)" },
      outColorLine: null,
      topLevel: [],
    };
    const source = generateFragmentShader(program);
    const bodyIndex = source.indexOf("float d = length");
    const colorIndex = source.indexOf("fragColor =");
    expect(bodyIndex).toBeGreaterThan(-1);
    expect(bodyIndex).toBeLessThan(colorIndex);
  });

  it("emits topLevel GLSL (custom functions) above main()", () => {
    const program: Program = {
      uniforms: [],
      body: [],
      outColor: { type: "vec4", glsl: "vec4(1.0)" },
      outColorLine: null,
      topLevel: ["float square(float x) {\n  return x * x;\n}"],
    };
    const source = generateFragmentShader(program);
    const topLevelIndex = source.indexOf("float square(float x)");
    const mainIndex = source.indexOf("void main()");
    expect(topLevelIndex).toBeGreaterThan(-1);
    expect(topLevelIndex).toBeLessThan(mainIndex);
  });
});

describe("generateFragmentShaderMapped", () => {
  it("maps a body line's GLSL line number back to its .ezsl source line", () => {
    const program: Program = {
      uniforms: [],
      body: [{ glsl: "float d = length(uv - 0.5);", ezslLine: 7 }],
      outColor: { type: "vec4", glsl: "vec4(vec3(d), 1.0)" },
      outColorLine: null,
      topLevel: [],
    };
    const { source, sourceMap } = generateFragmentShaderMapped(program);
    const glslLines = source.split("\n");
    const glslLineNumber = glslLines.findIndex((l) => l.includes("float d = length")) + 1;
    expect(glslLineNumber).toBeGreaterThan(0);
    expect(sourceMap.get(glslLineNumber)).toBe(7);
  });

  it("maps boilerplate/structural lines to null (no single .ezsl source line)", () => {
    const program: Program = {
      uniforms: [],
      body: [],
      outColor: { type: "vec4", glsl: "vec4(1.0)" },
      outColorLine: null,
      topLevel: [],
    };
    const { sourceMap } = generateFragmentShaderMapped(program);
    expect(sourceMap.get(1)).toBeNull();
  });

  it("omits the #version line when includeVersionDirective is false (host, e.g. Three.js, supplies its own)", () => {
    const program: Program = {
      uniforms: [],
      body: [],
      outColor: { type: "vec4", glsl: "vec4(1.0)" },
      outColorLine: null,
      topLevel: [],
    };
    const source = generateFragmentShaderMapped(program, false).source;
    expect(source).not.toContain("#version 300 es");
    expect(source).toContain("precision highp float;");
  });
});

describe("generateVertexShader", () => {
  it("produces a fullscreen-quad passthrough vertex shader", () => {
    const source = generateVertexShader();
    expect(source).toContain("#version 300 es");
    expect(source).toContain("in vec2 a_position;");
    expect(source).toContain("gl_Position = vec4(a_position, 0.0, 1.0);");
  });
});
