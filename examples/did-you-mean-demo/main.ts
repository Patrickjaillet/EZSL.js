import { compileEzsl } from "../../src/index.js";
import shaderSource from "./shader.ezsl?raw";

const resultEl = document.getElementById("result")!;
try {
  compileEzsl(shaderSource);
  resultEl.textContent = "compiled without error (unexpected for this demo)";
} catch (err) {
  resultEl.textContent = err instanceof Error ? err.message : String(err);
}
(window as unknown as { __errorMessage: string }).__errorMessage = resultEl.textContent ?? "";
