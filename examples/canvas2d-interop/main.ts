import { compileEzsl, mountToCanvas2D } from "../../src/index.js";
import shaderSource from "./shader.ezsl?raw";

const canvas = document.getElementById("canvas") as HTMLCanvasElement;
canvas.width = 400;
canvas.height = 300;

const program = compileEzsl(shaderSource);
const ctx2d = canvas.getContext("2d")!;

mountToCanvas2D(canvas, program, {
  fps: 24,
  // After each shader frame is copied in via readPixels/putImageData, draw
  // ordinary Canvas2D content on top — this is the actual point of this
  // module: composing EZSL shader output with text/shapes/images in one
  // 2D scene, not just displaying the shader alone (mount() already does
  // that, directly, with no readback overhead).
  onFrame() {
    ctx2d.font = "bold 28px sans-serif";
    ctx2d.fillStyle = "white";
    ctx2d.strokeStyle = "black";
    ctx2d.lineWidth = 3;
    ctx2d.textAlign = "center";
    ctx2d.strokeText("EZSL + Canvas2D", canvas.width / 2, 40);
    ctx2d.fillText("EZSL + Canvas2D", canvas.width / 2, 40);
  },
});
