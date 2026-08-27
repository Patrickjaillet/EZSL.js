import { compileEzsl, compileEzslVertex } from "../compiler/index.js";
import type { CompileOptions } from "../compiler/index.js";
import { generateFragmentShaderMapped, generateThreeVertexShaderMapped } from "../codegen/glslGenerator.js";

/**
 * Minimal structural shape of the constructor options
 * `THREE.ShaderMaterial`/`THREE.RawShaderMaterial` accept, and of the
 * material instance itself, sufficient for `createThreeMaterial` to build
 * and hand back. Deliberately not `import type * as THREE from "three"` —
 * `ezsl` has no dependency on the `three` package (see
 * docs/architecture/three-integration.md for why); a caller passes their
 * own `THREE.ShaderMaterial` (or `RawShaderMaterial`) *constructor*, and
 * this module only relies on the small slice of its shape it actually
 * uses. A real `THREE.ShaderMaterial` instance satisfies this interface
 * structurally without any cast on the caller's side.
 */
export interface ThreeShaderMaterialLike {
  uniforms: Record<string, { value: unknown }>;
}

export type ThreeShaderMaterialConstructor<TMaterial extends ThreeShaderMaterialLike> = new (options: {
  vertexShader: string;
  fragmentShader: string;
  uniforms: Record<string, { value: unknown }>;
  [key: string]: unknown;
}) => TMaterial;

export interface CreateThreeMaterialOptions {
  vertexSource: string;
  fragmentSource: string;
  /** Custom GLSL functions available to the *fragment* stage — see `defineFunction` / docs/architecture/escape-hatch.md. Not currently supported for the vertex stage (see docs/architecture/three-integration.md). */
  customFunctions?: CompileOptions["customFunctions"];
  /**
   * Extra properties merged into the constructor options passed to
   * `MaterialCtor` — e.g. `{ glslVersion: THREE.GLSL3 }`, **required** when
   * `MaterialCtor` is `THREE.RawShaderMaterial` (see the doc comment on
   * `createThreeMaterial` and docs/architecture/three-integration.md: EZSL
   * always generates GLSL ES 3.00 output, and without this flag Three.js
   * prepends its own `#define`s before your `#version 300 es` line, which
   * is a hard compile error — caught via real browser validation while
   * building this feature). Merged *after* `vertexShader`/`fragmentShader`/
   * `uniforms`, so it cannot override those three.
   */
  materialOptions?: Record<string, unknown>;
}

export interface ThreeMaterialHandle<TMaterial extends ThreeShaderMaterialLike> {
  material: TMaterial;
  /** Sets a uniform declared in either the vertex or fragment EZSL source, by its EZSL name (not the GLSL `u_`-prefixed one). Three.js's own builtins (`modelMatrix`, etc.) aren't settable this way — Three.js manages those itself every frame. */
  setUniform(name: string, value: unknown): void;
}

/**
 * Compiles separate vertex- and fragment-stage EZSL source into a
 * `THREE.ShaderMaterial` (v0.6 Three.js integration — see
 * docs/architecture/three-integration.md). `MaterialCtor` is the caller's
 * own `THREE.ShaderMaterial` (or `RawShaderMaterial`) class — pass it
 * explicitly rather than `ezsl` importing `three` itself.
 *
 * Fragment-stage `uv`/`time`/`resolution` builtins are auto-injected exactly
 * as in single-pass `mount()` (`uv` from `gl_FragCoord`, still Y-flipped —
 * see docs/architecture/transpiler-pipeline.md); a `u_time` uniform is
 * declared but **not auto-updated** — the caller is responsible for calling
 * `setUniform("time", elapsedSeconds)` each frame (Three.js has no
 * equivalent of EZSL's own `requestAnimationFrame` loop to hook into here;
 * see docs/architecture/three-integration.md).
 *
 * **Important**: EZSL always generates GLSL ES 3.00 (`#version 300 es`).
 * `THREE.ShaderMaterial` injects its own boilerplate (attribute/uniform
 * declarations, shader chunks) *before* your shader source, which both
 * duplicates EZSL's own `position`/`normal`/matrix declarations and pushes
 * `#version` out of the required first line — either failure mode is a
 * real compile error, not a warning (confirmed against the actual Three.js
 * runtime while building this feature). Use `THREE.RawShaderMaterial`
 * instead (no injected boilerplate), and pass `materialOptions: {
 * glslVersion: THREE.GLSL3 }` so Three.js places `#version 300 es`
 * correctly rather than prepending its own `#define`s first. See
 * docs/architecture/three-integration.md.
 */
export function createThreeMaterial<TMaterial extends ThreeShaderMaterialLike>(
  MaterialCtor: ThreeShaderMaterialConstructor<TMaterial>,
  options: CreateThreeMaterialOptions,
): ThreeMaterialHandle<TMaterial> {
  const vertexProgram = compileEzslVertex(options.vertexSource);
  const fragmentProgram = compileEzsl(options.fragmentSource, { customFunctions: options.customFunctions });

  // includeVersionDirective: false — Three.js (with glslVersion: THREE.GLSL3,
  // see the materialOptions doc above) supplies its own leading #version
  // 300 es line before this source; a second one anywhere else is a hard
  // GLSL compile error, not just redundant.
  const { source: vertexShader } = generateThreeVertexShaderMapped(vertexProgram, false);
  const { source: fragmentShader } = generateFragmentShaderMapped(fragmentProgram, false);

  const uniforms: Record<string, { value: unknown }> = {
    // The fragment codegen (generateFragmentShaderMapped) always declares
    // u_time/u_resolution as boilerplate, regardless of whether the EZSL
    // source references them — but they never appear in
    // fragmentProgram.uniforms (that list is only EZSL-declared user
    // uniforms; time/resolution are compiler-injected builtins, not
    // user-declared ones — see docs/architecture/transpiler-pipeline.md).
    // Registering them here explicitly is what makes `setUniform("time",
    // ...)` actually work; without it, the loop below would never see them.
    u_time: { value: 0 },
    u_resolution: { value: [1, 1] },
  };
  const glslNameByEzslName = new Map<string, string>([
    ["time", "u_time"],
    ["resolution", "u_resolution"],
  ]);
  for (const u of [...vertexProgram.uniforms, ...fragmentProgram.uniforms]) {
    uniforms[u.glslName] = { value: u.type === "float" ? 0 : [0, 0, 0, 0] };
    glslNameByEzslName.set(u.name, u.glslName);
  }

  const material = new MaterialCtor({ ...options.materialOptions, vertexShader, fragmentShader, uniforms });

  return {
    material,
    setUniform(name, value) {
      const glslName = glslNameByEzslName.get(name);
      if (!glslName) {
        throw new Error(`EZSL Three.js integration: '${name}' is not a uniform declared in either the vertex or fragment EZSL source`);
      }
      material.uniforms[glslName].value = value;
    },
  };
}
