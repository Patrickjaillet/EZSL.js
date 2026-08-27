import { compileEzsl, defineFunction, mount } from "../../src/index.js";
import shaderSource from "./shader.ezsl?raw";

const canvas = document.getElementById("canvas") as HTMLCanvasElement;

function resize() {
  canvas.width = canvas.clientWidth;
  canvas.height = canvas.clientHeight;
}
resize();
window.addEventListener("resize", resize);

const hueShift = defineFunction(
  "hueShift",
  `vec3 hueShift(float t) {
  return 0.5 + 0.5 * cos(6.2831 * (t + vec3(0.0, 0.33, 0.67)));
}`,
  { params: ["float"], returns: "vec3" },
);

const program = compileEzsl(shaderSource, { customFunctions: [hueShift] });
mount(canvas, program);
