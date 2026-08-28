import * as BABYLON from "@babylonjs/core";
import { createBabylonMaterial } from "../../src/index.js";
import vertexSource from "./vertex.ezsl?raw";
import fragmentSource from "./fragment.ezsl?raw";

const canvas = document.getElementById("canvas") as HTMLCanvasElement;
const engine = new BABYLON.Engine(canvas, true);
const scene = new BABYLON.Scene(engine);

const camera = new BABYLON.ArcRotateCamera("camera", Math.PI / 3, Math.PI / 3, 3, BABYLON.Vector3.Zero(), scene);
camera.attachControl(canvas, true);

const { material, setUniform } = createBabylonMaterial(BABYLON.ShaderMaterial, {
  name: "ezsl-babylon-material",
  scene,
  vertexSource,
  fragmentSource,
});

const sphere = BABYLON.MeshBuilder.CreateSphere("sphere", { diameter: 1.5, segments: 32 }, scene);
sphere.material = material;

function resize() {
  engine.resize();
  // Babylon's setVector2 expects a real {x, y}-shaped value (or a
  // BABYLON.Vector2), unlike Three.js's own setUniform (which accepts a
  // plain [w, h] array since it just assigns to .value with no shape
  // conversion) — a real, confirmed structural difference between the two
  // integrations' typed-setter vs. object-mutation uniform models. See
  // docs/architecture/babylon-integration.md.
  setUniform("resolution", { x: canvas.clientWidth, y: canvas.clientHeight });
}
window.addEventListener("resize", resize);
resize();

const startTime = performance.now();
scene.registerBeforeRender(() => {
  const elapsed = (performance.now() - startTime) / 1000;
  setUniform("time", elapsed);
});

engine.runRenderLoop(() => {
  scene.render();
});
