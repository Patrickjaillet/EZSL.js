import { createBabylonMaterial, dispatchBabylonUniform } from "../src/integrations/babylon.js";
import type { BabylonShaderMaterialLike } from "../src/integrations/babylon.js";

/**
 * A minimal stand-in for BABYLON.ShaderMaterial — structurally compatible
 * (constructed the same 4-positional-argument way, exposes the setter
 * methods createBabylonMaterial actually calls) without depending on the
 * real `@babylonjs/core` package. Unlike Three's FakeShaderMaterial (which
 * only needs to record `.uniforms[name].value`), this records every
 * `{method, name, value}` call — necessary to test setUniform's
 * type-dispatch correctness (which setter fired, not just that some
 * mutation happened), and to inspect the constructor's own captured
 * `attributes`/`uniforms` arrays for the missing-builtin regression test.
 */
class FakeShaderMaterial implements BabylonShaderMaterialLike {
  name: string;
  scene: unknown;
  vertexSource: string;
  fragmentSource: string;
  attributes: string[];
  uniforms: string[];
  calls: { method: string; name: string; value: unknown }[] = [];

  constructor(
    name: string,
    scene: unknown,
    shaderPath: { vertexSource: string; fragmentSource: string },
    options: { attributes: string[]; uniforms: string[] },
  ) {
    this.name = name;
    this.scene = scene;
    this.vertexSource = shaderPath.vertexSource;
    this.fragmentSource = shaderPath.fragmentSource;
    this.attributes = options.attributes;
    this.uniforms = options.uniforms;
  }

  setFloat(name: string, value: number) {
    this.calls.push({ method: "setFloat", name, value });
  }
  setInt(name: string, value: number) {
    this.calls.push({ method: "setInt", name, value });
  }
  setVector2(name: string, value: unknown) {
    this.calls.push({ method: "setVector2", name, value });
  }
  setVector3(name: string, value: unknown) {
    this.calls.push({ method: "setVector3", name, value });
  }
  setVector4(name: string, value: unknown) {
    this.calls.push({ method: "setVector4", name, value });
  }
  setMatrix(name: string, value: unknown) {
    this.calls.push({ method: "setMatrix", name, value });
  }
  setTexture(name: string, value: unknown) {
    this.calls.push({ method: "setTexture", name, value });
  }
}

const VERTEX_SOURCE = "glPosition = worldViewProjection * vec4(position, 1.0)";
const FRAGMENT_SOURCE = "color = [1.0, 0.0, 0.0]";

describe("createBabylonMaterial", () => {
  it("compiles both stages and produces GLSL on the material", () => {
    const { material } = createBabylonMaterial(FakeShaderMaterial, {
      name: "mat",
      scene: {},
      vertexSource: VERTEX_SOURCE,
      fragmentSource: FRAGMENT_SOURCE,
    });
    expect(material.vertexSource).toContain("gl_Position =");
    expect(material.fragmentSource).toContain("fragColor =");
  });

  it("declares position attribute and referenced Babylon matrices in the vertex shader, but not unreferenced ones", () => {
    const { material } = createBabylonMaterial(FakeShaderMaterial, {
      name: "mat",
      scene: {},
      vertexSource: VERTEX_SOURCE,
      fragmentSource: FRAGMENT_SOURCE,
    });
    expect(material.vertexSource).toContain("in vec3 position;");
    expect(material.vertexSource).toContain("uniform mat4 worldViewProjection;");
    expect(material.vertexSource).not.toContain("uniform mat4 view;");
    expect(material.vertexSource).not.toContain("uniform vec3 cameraPosition;");
  });

  it("never emits a #version line for either stage (Babylon strips/re-adds its own — a regression here is a hard compile failure)", () => {
    const { material } = createBabylonMaterial(FakeShaderMaterial, {
      name: "mat",
      scene: {},
      vertexSource: VERTEX_SOURCE,
      fragmentSource: FRAGMENT_SOURCE,
    });
    expect(material.vertexSource).not.toContain("#version");
    expect(material.fragmentSource).not.toContain("#version");
  });

  it("emits an explicit layout(location = 0) qualifier on the fragment output (regression: a real, confirmed-in-a-real-browser bug — without this, Babylon's own shader processor injects a second, colliding fragColor-equivalent output and ANGLE rejects the shader with a real compile error, 'must explicitly specify all locations when using multiple fragment outputs' — see docs/architecture/babylon-integration.md)", () => {
    const { material } = createBabylonMaterial(FakeShaderMaterial, {
      name: "mat",
      scene: {},
      vertexSource: VERTEX_SOURCE,
      fragmentSource: FRAGMENT_SOURCE,
    });
    expect(material.fragmentSource).toContain("layout(location = 0) out vec4 fragColor;");
    expect(material.fragmentSource).not.toMatch(/^out vec4 fragColor;$/m);
  });

  it("computes an attributes array containing position, and a uniforms array containing every referenced Babylon builtin (regression: a missing name here is a silent Babylon black-screen failure, not a compile error)", () => {
    const { material } = createBabylonMaterial(FakeShaderMaterial, {
      name: "mat",
      scene: {},
      vertexSource: VERTEX_SOURCE,
      fragmentSource: FRAGMENT_SOURCE,
    });
    expect(material.attributes).toContain("position");
    expect(material.uniforms).toContain("worldViewProjection");
    expect(material.uniforms).toContain("u_time");
    expect(material.uniforms).toContain("u_resolution");
  });

  it("setUniform('time', ...) dispatches to setFloat('u_time', ...) (regression: this was originally unreachable in the Three.js integration this is modeled on)", () => {
    const { material, setUniform } = createBabylonMaterial(FakeShaderMaterial, {
      name: "mat",
      scene: {},
      vertexSource: VERTEX_SOURCE,
      fragmentSource: FRAGMENT_SOURCE,
    });
    setUniform("time", 3.5);
    expect(material.calls).toContainEqual({ method: "setFloat", name: "u_time", value: 3.5 });
  });

  it("dispatches a float user uniform to setFloat", () => {
    const { material, setUniform } = createBabylonMaterial(FakeShaderMaterial, {
      name: "mat",
      scene: {},
      vertexSource: VERTEX_SOURCE,
      fragmentSource: "color = [speed, speed, speed]",
    });
    setUniform("speed", 2.0);
    expect(material.calls).toContainEqual({ method: "setFloat", name: "u_speed", value: 2.0 });
  });

  // dispatchBabylonUniform's non-float branches (vec2/vec3/vec4/matN/
  // sampler2D/bool), tested directly against every EzslType — EZSL's
  // implicit-uniform inference always infers `float` on first reference
  // (see tests/typeInference.test.ts's "implicit uniform declaration"
  // cases), so no real .ezsl source can currently produce a user-declared
  // uniform of any other type; this is a real, current language
  // limitation (see docs/architecture/babylon-integration.md), not a
  // reason to leave the dispatch table's other branches untested — it's
  // correct dispatch logic today and ready for a future EZSL feature
  // (e.g. explicit uniform type annotations) that could reach it.
  describe("dispatchBabylonUniform (direct dispatch-table coverage)", () => {
    function callsOn(material: FakeShaderMaterial) {
      return material.calls;
    }

    it("dispatches int to setInt", () => {
      const material = new FakeShaderMaterial("m", {}, { vertexSource: "", fragmentSource: "" }, { attributes: [], uniforms: [] });
      dispatchBabylonUniform(material, "u_count", "int", 3);
      expect(callsOn(material)).toContainEqual({ method: "setInt", name: "u_count", value: 3 });
    });

    it("dispatches bool to setInt(0|1) (no setBool exists on BABYLON.ShaderMaterial)", () => {
      const material = new FakeShaderMaterial("m", {}, { vertexSource: "", fragmentSource: "" }, { attributes: [], uniforms: [] });
      dispatchBabylonUniform(material, "u_flag", "bool", true);
      expect(callsOn(material)).toContainEqual({ method: "setInt", name: "u_flag", value: 1 });
      dispatchBabylonUniform(material, "u_flag", "bool", false);
      expect(callsOn(material)).toContainEqual({ method: "setInt", name: "u_flag", value: 0 });
    });

    it("dispatches vec2 to setVector2", () => {
      const material = new FakeShaderMaterial("m", {}, { vertexSource: "", fragmentSource: "" }, { attributes: [], uniforms: [] });
      dispatchBabylonUniform(material, "u_offset", "vec2", { x: 1, y: 2 });
      expect(callsOn(material)).toContainEqual({ method: "setVector2", name: "u_offset", value: { x: 1, y: 2 } });
    });

    it("dispatches vec3 to setVector3", () => {
      const material = new FakeShaderMaterial("m", {}, { vertexSource: "", fragmentSource: "" }, { attributes: [], uniforms: [] });
      dispatchBabylonUniform(material, "u_tint", "vec3", { x: 1, y: 0, z: 0 });
      expect(callsOn(material)).toContainEqual({ method: "setVector3", name: "u_tint", value: { x: 1, y: 0, z: 0 } });
    });

    it("dispatches vec4 to setVector4", () => {
      const material = new FakeShaderMaterial("m", {}, { vertexSource: "", fragmentSource: "" }, { attributes: [], uniforms: [] });
      dispatchBabylonUniform(material, "u_rgba", "vec4", { x: 1, y: 1, z: 1, w: 0.5 });
      expect(callsOn(material)).toContainEqual({ method: "setVector4", name: "u_rgba", value: { x: 1, y: 1, z: 1, w: 0.5 } });
    });

    it("dispatches mat2/mat3/mat4 to setMatrix", () => {
      const material = new FakeShaderMaterial("m", {}, { vertexSource: "", fragmentSource: "" }, { attributes: [], uniforms: [] });
      dispatchBabylonUniform(material, "u_m2", "mat2", "M2");
      dispatchBabylonUniform(material, "u_m3", "mat3", "M3");
      dispatchBabylonUniform(material, "u_m4", "mat4", "M4");
      expect(callsOn(material)).toContainEqual({ method: "setMatrix", name: "u_m2", value: "M2" });
      expect(callsOn(material)).toContainEqual({ method: "setMatrix", name: "u_m3", value: "M3" });
      expect(callsOn(material)).toContainEqual({ method: "setMatrix", name: "u_m4", value: "M4" });
    });

    it("dispatches sampler2D to setTexture", () => {
      const material = new FakeShaderMaterial("m", {}, { vertexSource: "", fragmentSource: "" }, { attributes: [], uniforms: [] });
      dispatchBabylonUniform(material, "u_tex", "sampler2D", "TEXTURE");
      expect(callsOn(material)).toContainEqual({ method: "setTexture", name: "u_tex", value: "TEXTURE" });
    });
  });

  it("throws when setUniform is called with a name not declared in either stage", () => {
    const { setUniform } = createBabylonMaterial(FakeShaderMaterial, {
      name: "mat",
      scene: {},
      vertexSource: VERTEX_SOURCE,
      fragmentSource: FRAGMENT_SOURCE,
    });
    expect(() => setUniform("bogus", 1.0)).toThrow();
  });

  it("does not expose Babylon's own builtin matrices as settable EZSL uniforms", () => {
    const { setUniform } = createBabylonMaterial(FakeShaderMaterial, {
      name: "mat",
      scene: {},
      vertexSource: VERTEX_SOURCE,
      fragmentSource: FRAGMENT_SOURCE,
    });
    expect(() => setUniform("worldViewProjection", [])).toThrow();
  });

  it("still treats an identifier not in the Babylon builtin scope as an implicit user uniform, not a crash", () => {
    const { material } = createBabylonMaterial(FakeShaderMaterial, {
      name: "mat",
      scene: {},
      vertexSource: "glPosition = worldViewProjection * vec4(position + [notABuiltin, 0.0, 0.0], 1.0)",
      fragmentSource: FRAGMENT_SOURCE,
    });
    expect(material.uniforms).toContain("u_notABuiltin");
  });
});
