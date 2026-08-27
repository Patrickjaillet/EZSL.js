import { compileEzsl, mount } from "../../src/index.js";
import shaderSource from "./shader.ezsl?raw";

const canvas = document.getElementById("canvas") as HTMLCanvasElement;

function resize() {
  canvas.width = canvas.clientWidth;
  canvas.height = canvas.clientHeight;
}
resize();
window.addEventListener("resize", resize);

const program = compileEzsl(shaderSource);
mount(canvas, program);
