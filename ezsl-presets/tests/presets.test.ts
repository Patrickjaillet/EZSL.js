import { compileEzsl } from "@patrickjaillet/ezsl";
import { generateFragmentShaderMapped } from "@patrickjaillet/ezsl";
import { hash2D, fbm2D } from "../src/noise.js";
import { sdfSphere, sdfBox, sdfCircle2D, sdfBox2D } from "../src/sdf.js";
import { cosinePalette, luminance, saturate, contrast } from "../src/colorGrading.js";
import { boxBlur9, gaussianBlur13, brightnessThreshold } from "../src/blurBloom.js";

/**
 * Each preset is exercised the way a real consumer would use it: a real
 * `.ezsl` source string calling the preset's EZSL-visible name, compiled
 * via `compileEzsl(source, { customFunctions: [preset] })`, with the
 * generated GLSL inspected for a sane shape (the function actually
 * appears in `topLevel`, the call site actually compiles to the expected
 * function-call GLSL). This is not just "does defineFunction() not
 * throw" — it's "does a real EZSL program that calls this preset compile
 * end-to-end."
 */
describe("noise presets", () => {
  it("hash2D compiles and is callable from EZSL source", () => {
    const program = compileEzsl("h = hash2D(uv)\ncolor = [h, h, h]", { customFunctions: [hash2D] });
    const { source } = generateFragmentShaderMapped(program);
    expect(source).toContain("float hash2D(vec2 p)");
    expect(source).toContain("hash2D(uv)");
  });

  it("fbm2D compiles and is callable from EZSL source", () => {
    const program = compileEzsl("n = fbm2D(uv * 3.0)\ncolor = [n, n, n]", { customFunctions: [fbm2D] });
    const { source } = generateFragmentShaderMapped(program);
    expect(source).toContain("float fbm2D(vec2 p)");
    expect(source).toContain("fbm2D(");
  });

  it("hash2D and fbm2D can both be registered together without a name collision", () => {
    expect(() =>
      compileEzsl("n = fbm2D(uv)\nh = hash2D(uv)\ncolor = [n, h, 0.0]", { customFunctions: [hash2D, fbm2D] }),
    ).not.toThrow();
  });
});

describe("SDF presets", () => {
  it("sdfSphere compiles with vec3 + float arguments", () => {
    const program = compileEzsl("d = sdfSphere([0.0, 0.0, 0.0], 1.0)\ncolor = [d, d, d]", { customFunctions: [sdfSphere] });
    const { source } = generateFragmentShaderMapped(program);
    expect(source).toContain("float sdfSphere(vec3 p, float radius)");
  });

  it("sdfBox compiles with vec3 + vec3 arguments", () => {
    const program = compileEzsl("d = sdfBox([0.0, 0.0, 0.0], [0.5, 0.5, 0.5])\ncolor = [d, d, d]", { customFunctions: [sdfBox] });
    const { source } = generateFragmentShaderMapped(program);
    expect(source).toContain("float sdfBox(vec3 p, vec3 halfExtents)");
  });

  it("sdfCircle2D compiles with vec2 + float arguments", () => {
    const program = compileEzsl("d = sdfCircle2D(uv, 0.3)\ncolor = [d, d, d]", { customFunctions: [sdfCircle2D] });
    expect(() => generateFragmentShaderMapped(program)).not.toThrow();
  });

  it("sdfBox2D compiles with vec2 + vec2 arguments", () => {
    const program = compileEzsl("d = sdfBox2D(uv, [0.2, 0.3])\ncolor = [d, d, d]", { customFunctions: [sdfBox2D] });
    expect(() => generateFragmentShaderMapped(program)).not.toThrow();
  });

  it("all four SDF presets can be registered together without collision", () => {
    expect(() =>
      compileEzsl(
        "a = sdfSphere([0.0,0.0,0.0], 1.0)\nb = sdfBox([0.0,0.0,0.0],[1.0,1.0,1.0])\nc = sdfCircle2D(uv, 0.5)\ne = sdfBox2D(uv, [0.5,0.5])\ncolor = [a, b, c + e]",
        { customFunctions: [sdfSphere, sdfBox, sdfCircle2D, sdfBox2D] },
      ),
    ).not.toThrow();
  });
});

describe("color grading presets", () => {
  it("cosinePalette compiles and returns a vec3", () => {
    const program = compileEzsl("c = cosinePalette(0.5)\ncolor = c", { customFunctions: [cosinePalette] });
    const { source } = generateFragmentShaderMapped(program);
    expect(source).toContain("vec3 cosinePalette(float t)");
  });

  it("luminance compiles and returns a float", () => {
    const program = compileEzsl("l = luminance([1.0, 0.5, 0.2])\ncolor = [l, l, l]", { customFunctions: [luminance] });
    expect(() => generateFragmentShaderMapped(program)).not.toThrow();
  });

  it("saturate compiles with vec3 + float arguments", () => {
    const program = compileEzsl("c = saturate([1.0, 0.5, 0.2], 0.5)\ncolor = c", { customFunctions: [saturate] });
    expect(() => generateFragmentShaderMapped(program)).not.toThrow();
  });

  it("contrast compiles with vec3 + float arguments", () => {
    const program = compileEzsl("c = contrast([1.0, 0.5, 0.2], 1.2)\ncolor = c", { customFunctions: [contrast] });
    expect(() => generateFragmentShaderMapped(program)).not.toThrow();
  });

  it("saturate and luminance can be registered together (saturate internally uses its own renamed luminance copy, avoiding collision)", () => {
    expect(() =>
      compileEzsl("s = saturate([1.0, 0.5, 0.2], 0.5)\nl = luminance([1.0, 0.5, 0.2])\ncolor = [s.x, s.y, l]", {
        customFunctions: [saturate, luminance],
      }),
    ).not.toThrow();
  });
});

describe("blur/bloom presets", () => {
  // These take a sampler2D parameter, only meaningful inside a real
  // multi-pass buffer-sampling context — see blurBloom.ts's own doc
  // comment. Compiling them standalone (no real .sample()-eligible buffer
  // in scope) isn't representative of real usage, but confirms the
  // preset's own GLSL text is at least well-formed enough to appear in
  // topLevel without breaking compilation of the rest of the program.
  it("boxBlur9's signature is registered correctly", () => {
    const program = compileEzsl("color = [1.0, 0.0, 0.0]", { customFunctions: [boxBlur9] });
    const { source } = generateFragmentShaderMapped(program);
    expect(source).toContain("vec4 boxBlur9(sampler2D tex, vec2 uv, vec2 texelSize)");
  });

  it("gaussianBlur13's signature is registered correctly", () => {
    const program = compileEzsl("color = [1.0, 0.0, 0.0]", { customFunctions: [gaussianBlur13] });
    const { source } = generateFragmentShaderMapped(program);
    expect(source).toContain("vec4 gaussianBlur13(sampler2D tex, vec2 uv, vec2 texelSize)");
  });

  it("brightnessThreshold's signature is registered correctly", () => {
    const program = compileEzsl("color = [1.0, 0.0, 0.0]", { customFunctions: [brightnessThreshold] });
    const { source } = generateFragmentShaderMapped(program);
    expect(source).toContain("vec4 brightnessThreshold(sampler2D tex, vec2 uv, float threshold)");
  });
});

describe("blur/bloom presets used from a glsl {} block against a real multi-pass buffer uniform", () => {
  it("boxBlur9 is callable from a glsl {} block referencing u_buffer_<Name> directly", () => {
    // EZSL's own .sample(uv) syntax has no way to pass a buffer as an
    // ordinary function argument -- see blurBloom.ts's doc comment -- so
    // a real consumer calls a blur/bloom preset from inside a glsl {}
    // block, referencing the compiler-generated u_buffer_<Name> uniform
    // directly. This only confirms it *compiles* (a real WebGL2 link
    // requires a browser context this Jest run doesn't have) -- see
    // demo/ for the real-browser-rendered proof.
    const imageSource = `blurred = [0.0, 0.0, 0.0, 1.0]
glsl {
  blurred = boxBlur9(u_buffer_BufferA, uv, 1.0 / resolution);
}
color = blurred`;
    expect(() =>
      compileEzsl(imageSource, { bufferNames: ["BufferA"], customFunctions: [boxBlur9] }),
    ).not.toThrow();
  });
});
