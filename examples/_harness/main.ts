import * as THREE from "three";
import { compileEzsl, createPipeline, createThreeMaterial, defineFunction, mount, mountToCanvas2D } from "../../src/index.js";
import multiPassBufferASource from "../multi-pass/BufferA.ezsl?raw";
import multiPassImageSource from "../multi-pass/Image.ezsl?raw";
import threeVertexSource from "../three-integration/vertex.ezsl?raw";
import threeFragmentSource from "../three-integration/fragment.ezsl?raw";

const shaderModules = import.meta.glob("../*/shader.ezsl", { query: "?raw", import: "default", eager: true }) as Record<string, string>;

// Examples with special compile requirements, mirrored from their own main.ts:
const EXPECTED_TO_FAIL = new Set([
  "error-demo", // deliberately triggers a WebGL compile failure to demo v0.4 error translation.
  "did-you-mean-demo", // deliberately triggers an EZSL CompileError (typo'd builtin call) to demo "did you mean?" suggestions.
]);

function customFunctionsFor(name: string) {
  if (name !== "escape-hatch") return undefined;
  return [
    defineFunction(
      "hueShift",
      `vec3 hueShift(float t) {\n  return 0.5 + 0.5 * cos(6.2831 * (t + vec3(0.0, 0.33, 0.67)));\n}`,
      { params: ["float"], returns: "vec3" },
    ),
  ];
}

interface HarnessResult {
  name: string;
  ok: boolean;
  expectedToFail: boolean;
  error?: string;
}

const results: HarnessResult[] = [];

for (const [path, source] of Object.entries(shaderModules)) {
  const name = path.split("/")[1];
  const expectedToFail = EXPECTED_TO_FAIL.has(name);
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  try {
    const program = compileEzsl(source, { customFunctions: customFunctionsFor(name) });
    const handle = mount(canvas, program);
    handle.stop();
    results.push({ name, ok: !expectedToFail, expectedToFail });
  } catch (err) {
    results.push({
      name,
      ok: expectedToFail,
      expectedToFail,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// multi-pass/ isn't a single shader.ezsl (it's a BufferA.ezsl + Image.ezsl
// pipeline compiled via createPipeline, not compileEzsl+mount), so it's not
// picked up by the glob above — exercised separately here instead.
try {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const handle = createPipeline(canvas, {
    passes: {
      BufferA: { source: multiPassBufferASource },
      Image: { source: multiPassImageSource },
    },
  });
  handle.stop();
  results.push({ name: "multi-pass", ok: true, expectedToFail: false });
} catch (err) {
  results.push({
    name: "multi-pass",
    ok: false,
    expectedToFail: false,
    error: err instanceof Error ? err.message : String(err),
  });
}

// three-integration/ isn't a single shader.ezsl either (vertex.ezsl +
// fragment.ezsl compiled via createThreeMaterial), so it's exercised
// separately here too, the same way multi-pass/ is above.
try {
  const { material } = createThreeMaterial(THREE.RawShaderMaterial, {
    vertexSource: threeVertexSource,
    fragmentSource: threeFragmentSource,
    materialOptions: { glslVersion: THREE.GLSL3 },
  });
  const renderer = new THREE.WebGLRenderer({ canvas: document.createElement("canvas") });
  renderer.setSize(16, 16, false);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
  camera.position.set(0, 0, 3);
  scene.add(new THREE.Mesh(new THREE.IcosahedronGeometry(1, 1), material));
  renderer.render(scene, camera);
  results.push({ name: "three-integration", ok: true, expectedToFail: false });
} catch (err) {
  results.push({
    name: "three-integration",
    ok: false,
    expectedToFail: false,
    error: err instanceof Error ? err.message : String(err),
  });
}

// mountToCanvas2D specifically (not just "does canvas2d-interop's shader.ezsl
// compile", which the glob loop above already covers) — the readback path
// itself (offscreen WebGL2 -> readPixels -> putImageData) is the part worth
// exercising here, since a real 2D-context/onFrame regression wouldn't show
// up from compiling the shader alone.
try {
  const canvas2dInteropSource = shaderModules["../canvas2d-interop/shader.ezsl"];
  const program = compileEzsl(canvas2dInteropSource);
  const canvas2d = document.createElement("canvas");
  canvas2d.width = 32;
  canvas2d.height = 32;
  let frameRan = false;
  const handle = mountToCanvas2D(canvas2d, program, {
    once: true,
    onFrame() {
      frameRan = true;
    },
  });
  handle.stop();
  if (!frameRan) throw new Error("mountToCanvas2D: onFrame never fired");
  results.push({ name: "canvas2d-interop (mountToCanvas2D readback path)", ok: true, expectedToFail: false });
} catch (err) {
  results.push({
    name: "canvas2d-interop (mountToCanvas2D readback path)",
    ok: false,
    expectedToFail: false,
    error: err instanceof Error ? err.message : String(err),
  });
}

(window as unknown as { __harnessResults: HarnessResult[] }).__harnessResults = results;
(window as unknown as { __harnessDone: boolean }).__harnessDone = true;
