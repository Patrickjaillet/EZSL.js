import * as THREE from "three";
import { createThreeMaterial } from "../../src/index.js";
import vertexSource from "./vertex.ezsl?raw";
import fragmentSource from "./fragment.ezsl?raw";

const canvas = document.getElementById("canvas") as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(50, canvas.clientWidth / canvas.clientHeight, 0.1, 100);
camera.position.set(2, 1.5, 3);
camera.lookAt(0, 0, 0);

const { material, setUniform } = createThreeMaterial(THREE.RawShaderMaterial, {
  vertexSource,
  fragmentSource,
  materialOptions: { glslVersion: THREE.GLSL3 },
});

const geometry = new THREE.IcosahedronGeometry(1, 4);
const mesh = new THREE.Mesh(geometry, material);
scene.add(mesh);

function resize() {
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  setUniform("resolution", [width, height]);
}
window.addEventListener("resize", resize);
resize();

const startTime = performance.now();
function frame() {
  const elapsed = (performance.now() - startTime) / 1000;
  setUniform("time", elapsed);
  mesh.rotation.y = elapsed * 0.4;
  mesh.rotation.x = elapsed * 0.2;
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
