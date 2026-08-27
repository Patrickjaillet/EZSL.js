import { compileEzsl, mount } from "../../src/index.js";
import shaderSource from "./shader.ezsl?raw";

const canvas = document.getElementById("canvas") as HTMLCanvasElement;
canvas.width = 400;
canvas.height = 300;

const program = compileEzsl(shaderSource);

const resultEl = document.getElementById("result")!;
try {
  mount(canvas, program, { ezslSource: shaderSource });
  resultEl.textContent = "mounted without error (unexpected for this demo)";
} catch (err) {
  resultEl.textContent = err instanceof Error ? err.message : String(err);
  (window as unknown as { __errorMessage: string }).__errorMessage = resultEl.textContent;
}
