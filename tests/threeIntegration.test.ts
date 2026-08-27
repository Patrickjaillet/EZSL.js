import { createThreeMaterial } from "../src/integrations/three.js";
import type { ThreeShaderMaterialLike } from "../src/integrations/three.js";

// A minimal stand-in for THREE.ShaderMaterial — structurally compatible
// (constructed the same way, exposes .uniforms) without depending on the
// real `three` package. createThreeMaterial only ever touches the shape
// described by ThreeShaderMaterialLike, so this is a faithful test double.
class FakeShaderMaterial implements ThreeShaderMaterialLike {
  vertexShader: string;
  fragmentShader: string;
  uniforms: Record<string, { value: unknown }>;

  constructor(options: { vertexShader: string; fragmentShader: string; uniforms: Record<string, { value: unknown }> }) {
    this.vertexShader = options.vertexShader;
    this.fragmentShader = options.fragmentShader;
    this.uniforms = options.uniforms;
  }
}

const VERTEX_SOURCE = "glPosition = projectionMatrix * modelViewMatrix * vec4(position, 1.0)";
const FRAGMENT_SOURCE = "color = [1.0, 0.0, 0.0]";

describe("createThreeMaterial", () => {
  it("compiles both stages and produces GLSL on the material", () => {
    const { material } = createThreeMaterial(FakeShaderMaterial, {
      vertexSource: VERTEX_SOURCE,
      fragmentSource: FRAGMENT_SOURCE,
    });
    expect(material.vertexShader).toContain("gl_Position =");
    expect(material.fragmentShader).toContain("fragColor =");
  });

  it("declares position/normal attributes and Three.js matrices in the vertex shader", () => {
    const { material } = createThreeMaterial(FakeShaderMaterial, {
      vertexSource: VERTEX_SOURCE,
      fragmentSource: FRAGMENT_SOURCE,
    });
    expect(material.vertexShader).toContain("in vec3 position;");
    expect(material.vertexShader).toContain("uniform mat4 modelViewMatrix;");
    expect(material.vertexShader).toContain("uniform mat4 projectionMatrix;");
  });

  it("registers u_time and u_resolution uniforms even though EZSL source never explicitly declares them", () => {
    const { material } = createThreeMaterial(FakeShaderMaterial, {
      vertexSource: VERTEX_SOURCE,
      fragmentSource: FRAGMENT_SOURCE,
    });
    expect(material.uniforms).toHaveProperty("u_time");
    expect(material.uniforms).toHaveProperty("u_resolution");
  });

  it("setUniform('time', ...) actually updates u_time on the material (regression: this was originally unreachable)", () => {
    const { material, setUniform } = createThreeMaterial(FakeShaderMaterial, {
      vertexSource: VERTEX_SOURCE,
      fragmentSource: FRAGMENT_SOURCE,
    });
    setUniform("time", 3.5);
    expect(material.uniforms.u_time.value).toBe(3.5);
  });

  it("setUniform works for a user-declared fragment uniform", () => {
    const { material, setUniform } = createThreeMaterial(FakeShaderMaterial, {
      vertexSource: VERTEX_SOURCE,
      fragmentSource: "color = [speed, speed, speed]",
    });
    setUniform("speed", 2.0);
    expect(material.uniforms.u_speed.value).toBe(2.0);
  });

  it("setUniform works for a user-declared vertex uniform", () => {
    const { material, setUniform } = createThreeMaterial(FakeShaderMaterial, {
      vertexSource:
        "displaced = position + normal * amplitude\nglPosition = projectionMatrix * modelViewMatrix * vec4(displaced, 1.0)",
      fragmentSource: FRAGMENT_SOURCE,
    });
    setUniform("amplitude", 0.5);
    expect(material.uniforms.u_amplitude.value).toBe(0.5);
  });

  it("throws when setUniform is called with a name not declared in either stage", () => {
    const { setUniform } = createThreeMaterial(FakeShaderMaterial, {
      vertexSource: VERTEX_SOURCE,
      fragmentSource: FRAGMENT_SOURCE,
    });
    expect(() => setUniform("bogus", 1.0)).toThrow();
  });

  it("does not expose Three.js's own builtin matrices as settable EZSL uniforms", () => {
    const { setUniform } = createThreeMaterial(FakeShaderMaterial, {
      vertexSource: VERTEX_SOURCE,
      fragmentSource: FRAGMENT_SOURCE,
    });
    expect(() => setUniform("modelViewMatrix", [])).toThrow();
  });
});
