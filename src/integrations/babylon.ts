import { compileEzsl, compileEzslVertex } from "../compiler/index.js";
import type { CompileOptions } from "../compiler/index.js";
import { generateFragmentShaderMapped, generateBabylonVertexShaderMapped } from "../codegen/glslGenerator.js";
import type { EzslType } from "../codegen/types.js";

/**
 * Minimal structural shape of the setter methods `createBabylonMaterial`
 * actually calls on a `BABYLON.ShaderMaterial` instance — see
 * docs/architecture/babylon-integration.md for why this is deliberately
 * not `import type * as BABYLON from "@babylonjs/core"` (mirrors
 * `src/integrations/three.ts`'s zero-npm-dependency rationale). Confirmed
 * against `@babylonjs/core@9.23.0`'s real source: `ShaderMaterial` has no
 * `setBool` — a `bool`-typed EZSL uniform is dispatched through `setInt`
 * (0/1) instead, and this interface has no `setBool` entry to reflect
 * that (not an oversight — see `setUniform`'s doc comment below).
 */
export interface BabylonShaderMaterialLike {
  setFloat(name: string, value: number): unknown;
  setInt(name: string, value: number): unknown;
  setVector2(name: string, value: { x: number; y: number }): unknown;
  setVector3(name: string, value: { x: number; y: number; z: number }): unknown;
  setVector4(name: string, value: { x: number; y: number; z: number; w: number }): unknown;
  setMatrix(name: string, value: unknown): unknown;
  setTexture(name: string, value: unknown): unknown;
}

/**
 * Structural shape of `BABYLON.ShaderMaterial`'s real constructor:
 * `new BABYLON.ShaderMaterial(name, scene, shaderPath, options)` — a real,
 * confirmed 4-positional-argument shape, structurally different from
 * Three.js's single-options-object constructor. `TScene` is left generic
 * (defaulting to `unknown`) since this module never dereferences the
 * scene itself — it only forwards whatever the caller passes.
 */
export type BabylonShaderMaterialConstructor<TMaterial extends BabylonShaderMaterialLike, TScene = unknown> = new (
  name: string,
  scene: TScene,
  shaderPath: { vertexSource: string; fragmentSource: string },
  options: {
    attributes: string[];
    uniforms: string[];
    [key: string]: unknown;
  },
) => TMaterial;

export interface CreateBabylonMaterialOptions<TScene = unknown> {
  name: string;
  scene: TScene;
  vertexSource: string;
  fragmentSource: string;
  /** Custom GLSL functions available to the *fragment* stage — see `defineFunction` / docs/architecture/escape-hatch.md. Not currently supported for the vertex stage (same scope limitation as the Three.js integration). */
  customFunctions?: CompileOptions["customFunctions"];
  /**
   * Extra properties merged into the constructor options passed to
   * `MaterialCtor` — merged **before** this module's own computed
   * `attributes`/`uniforms` arrays, the opposite merge order from
   * `createThreeMaterial`'s `materialOptions` (which merges after, so it
   * can't override `vertexShader`/`fragmentShader`/`uniforms` there
   * either, but for a different reason). Here it's deliberate: a
   * caller-supplied `attributes`/`uniforms` array missing a builtin the
   * compiled shader actually references is Babylon's silent-black-screen
   * failure mode (the value is just never bound — no compile error), not
   * a recoverable warning, so this module always wins that merge — its
   * own regex-scan-derived lists are provably complete for what the
   * compiled program references. See docs/architecture/babylon-integration.md.
   */
  materialOptions?: Record<string, unknown>;
}

export interface BabylonMaterialHandle<TMaterial extends BabylonShaderMaterialLike> {
  material: TMaterial;
  /** Sets a uniform declared in either the vertex or fragment EZSL source, by its EZSL name (not the GLSL `u_`-prefixed one), dispatching to the correct `BABYLON.ShaderMaterial` setter method for its EZSL-inferred type — `float`/`int` -> `setFloat`/`setInt`, `vec2`/`vec3`/`vec4` -> `setVectorN`, `mat2`/`mat3`/`mat4` -> `setMatrix`, `sampler2D` -> `setTexture`, `bool` -> `setInt(0|1)` (no `setBool` exists on `BABYLON.ShaderMaterial` — confirmed against real source, not assumed). Babylon's own builtins (`worldViewProjection`, etc.) aren't settable this way — Babylon manages those itself every frame via its own uniform-array auto-bind mechanism. */
  setUniform(name: string, value: unknown): void;
}

/**
 * Adds an explicit `layout(location = 0)` qualifier to the fragment
 * shader's `out vec4 fragColor;` declaration — a real bug found and fixed
 * while building this integration, confirmed against Babylon's own real
 * source (`WebGL2ShaderProcessor.postProcessor`,
 * `packages/dev/core/src/Engines/WebGL/webGL2ShaderProcessors.ts`).
 * Babylon's fragment post-processor unconditionally checks the input
 * source for the literal pattern `layout(location = 0) out` (a plain
 * string/regex match, unrelated to whether the shader references
 * `gl_FragColor`) — `generateFragmentShaderMapped`'s own output,
 * `out vec4 fragColor;`, has no such qualifier, so Babylon's check fails
 * and it *injects a second* `layout(location = 0) out vec4 glFragColor;`
 * declaration right before `void main(`. ANGLE then sees two fragment
 * outputs, neither with `EXT_blend_func_extended` support, and rejects
 * the shader with `'fragColor' : when EXT_blend_func_extended extension
 * is not enabled, must explicitly specify all locations when using
 * multiple fragment outputs` — a genuine, confirmed-in-a-real-browser
 * compile failure, not a hypothetical. Adding the qualifier ourselves
 * (keeping the name `fragColor` — no collision with Babylon's own
 * `glFragColor`, confirmed) makes Babylon's own check pass and skip its
 * injection entirely. This transform is deliberately scoped to this
 * integration module only, not `generateFragmentShaderMapped` itself —
 * Three.js's integration and plain `mount()` have no equivalent
 * output-collision detector and don't need this qualifier.
 */
function addFragmentOutputLocation(fragmentSource: string): string {
  return fragmentSource.replace(/^out vec4 fragColor;$/m, "layout(location = 0) out vec4 fragColor;");
}

interface UniformInfo {
  glslName: string;
  type: EzslType;
}

/**
 * Dispatches a single uniform update to the correct `BABYLON.ShaderMaterial`
 * setter method for its EZSL-inferred type. Extracted as its own pure
 * function (rather than inlined in `setUniform`'s closure) specifically so
 * it's unit-testable directly against every `EzslType`, independent of
 * whether real `.ezsl` source can currently produce a user-declared
 * uniform of that type — EZSL's implicit-uniform inference always infers
 * `float` on first reference (see docs/architecture/type-system.md /
 * tests/typeInference.test.ts's "implicit uniform declaration" cases), so
 * a plain user uniform can never actually be `vec2`/`vec3`/`vec4`/`matN`
 * in practice today; the only non-float uniforms EZSL ever produces are
 * the vertex-builtin matrices, which are deliberately NOT settable via
 * `setUniform` at all (see docs/architecture/babylon-integration.md). This
 * function's `vec2`/`vec3`/`vec4`/`mat2`/`mat3`/`mat4`/`sampler2D`
 * branches are real, forward-looking dispatch logic — correct for the
 * type system today and ready for a future EZSL feature (e.g. explicit
 * uniform type annotations) that could actually produce one — not dead
 * code, even though no current `.ezsl` source can reach them end-to-end.
 */
export function dispatchBabylonUniform(material: BabylonShaderMaterialLike, glslName: string, type: EzslType, value: unknown): void {
  switch (type) {
    case "float":
      material.setFloat(glslName, value as number);
      break;
    case "int":
      material.setInt(glslName, value as number);
      break;
    case "bool":
      // No setBool on BABYLON.ShaderMaterial — confirmed against real
      // source, not assumed. setInt(0|1) is Babylon's own real
      // convention for boolean uniforms.
      material.setInt(glslName, value ? 1 : 0);
      break;
    case "vec2":
      material.setVector2(glslName, value as { x: number; y: number });
      break;
    case "vec3":
      material.setVector3(glslName, value as { x: number; y: number; z: number });
      break;
    case "vec4":
      material.setVector4(glslName, value as { x: number; y: number; z: number; w: number });
      break;
    case "mat2":
    case "mat3":
    case "mat4":
      material.setMatrix(glslName, value);
      break;
    case "sampler2D":
      material.setTexture(glslName, value);
      break;
  }
}

/**
 * Compiles separate vertex- and fragment-stage EZSL source into a
 * `BABYLON.ShaderMaterial` (Babylon.js integration — see
 * docs/architecture/babylon-integration.md, modeled on
 * `src/integrations/three.ts`'s Three.js integration but adapted for
 * several confirmed, real structural differences: Babylon has no "raw"
 * material variant, must never receive a `#version` line from EZSL at
 * all, requires attribute/uniform names to be explicitly listed at
 * construction time (unlike Three's "just reference it in source" model —
 * a name missing from these lists is silently never bound, not a compile
 * error), and updates uniforms via a typed setter API rather than
 * object-mutation.
 *
 * Fragment-stage `uv`/`time`/`resolution` builtins are auto-injected
 * exactly as in single-pass `mount()`; `u_time` is declared but **not
 * auto-updated** — the caller is responsible for calling
 * `setUniform("time", elapsedSeconds)` each frame (e.g. from
 * `scene.registerBeforeRender`), the same responsibility Three's
 * integration places on its caller.
 */
export function createBabylonMaterial<TMaterial extends BabylonShaderMaterialLike, TScene = unknown>(
  MaterialCtor: BabylonShaderMaterialConstructor<TMaterial, TScene>,
  options: CreateBabylonMaterialOptions<TScene>,
): BabylonMaterialHandle<TMaterial> {
  const vertexProgram = compileEzslVertex(options.vertexSource, {}, "babylon");
  const fragmentProgram = compileEzsl(options.fragmentSource, { customFunctions: options.customFunctions });

  const { source: vertexShader, referencedAttributes, referencedUniforms: referencedVertexBuiltinUniforms } =
    generateBabylonVertexShaderMapped(vertexProgram);
  // includeVersionDirective: false — Babylon's shader processor strips any
  // #version line found in the input and the real engine always prepends
  // its own at compile time regardless (see generateBabylonVertexShaderMapped's
  // doc comment); a leading version line here would just be stripped, but
  // omitting it keeps this module's output consistent with the vertex
  // generator's own "never emit one" rule.
  const { source: fragmentShaderRaw } = generateFragmentShaderMapped(fragmentProgram, false);
  const fragmentShader = addFragmentOutputLocation(fragmentShaderRaw);

  const uniformInfoByEzslName = new Map<string, UniformInfo>([
    // u_time/u_resolution are always declared in the generated fragment
    // shader's boilerplate regardless of whether the .ezsl source
    // references them, but never appear in fragmentProgram.uniforms (that
    // list is only EZSL-*declared* user uniforms) — registering them
    // here explicitly is what makes setUniform("time", ...) actually
    // work; the identical gap was a real bug in the Three.js integration
    // (see docs/architecture/three-integration.md), fixed the same way
    // here from the start rather than rediscovered.
    ["time", { glslName: "u_time", type: "float" }],
    ["resolution", { glslName: "u_resolution", type: "vec2" }],
  ]);
  for (const u of [...vertexProgram.uniforms, ...fragmentProgram.uniforms]) {
    uniformInfoByEzslName.set(u.name, { glslName: u.glslName, type: u.type });
  }

  const userUniformGlslNames = [...vertexProgram.uniforms, ...fragmentProgram.uniforms].map((u) => u.glslName);

  // position is always included — Babylon's own ShaderMaterial default —
  // even for a vertex program that happens not to reference it in its
  // compiled GLSL (which would be unusual, since every real vertex
  // program needs to place its geometry somehow, but not enforced).
  const attributes = ["position", ...referencedAttributes.filter((name) => name !== "position")];
  // u_time/u_resolution are unconditionally included for the same reason
  // they're unconditionally seeded into uniformInfoByEzslName above.
  const uniforms = [...referencedVertexBuiltinUniforms, "u_time", "u_resolution", ...userUniformGlslNames];

  const material = new MaterialCtor(
    options.name,
    options.scene,
    { vertexSource: vertexShader, fragmentSource: fragmentShader },
    { ...options.materialOptions, attributes, uniforms },
  );

  return {
    material,
    setUniform(name, value) {
      const info = uniformInfoByEzslName.get(name);
      if (!info) {
        throw new Error(`EZSL Babylon.js integration: '${name}' is not a uniform declared in either the vertex or fragment EZSL source`);
      }
      dispatchBabylonUniform(material, info.glslName, info.type, value);
    },
  };
}
