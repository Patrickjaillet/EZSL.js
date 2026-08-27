import { createPipeline } from "../../src/index.js";
import bufferASource from "./BufferA.ezsl?raw";
import imageSource from "./Image.ezsl?raw";

const canvas = document.getElementById("canvas") as HTMLCanvasElement;

function resize() {
  canvas.width = canvas.clientWidth;
  canvas.height = canvas.clientHeight;
}
resize();
window.addEventListener("resize", resize);

createPipeline(canvas, {
  passes: {
    BufferA: { source: bufferASource },
    Image: { source: imageSource },
  },
});
