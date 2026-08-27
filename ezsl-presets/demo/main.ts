import { compileEzsl, mount } from "../../src/index.js";
import { fbm2D } from "../src/noise.js";
import { sdfSphere } from "../src/sdf.js";
import { cosinePalette } from "../src/colorGrading.js";

const row = document.getElementById("row")!;

interface Demo {
  name: string;
  source: string;
  customFunctions: Parameters<typeof compileEzsl>[1] extends { customFunctions?: infer T } ? T : never;
}

const demos: Demo[] = [
  {
    name: "fbm2D",
    source: "n = fbm2D(uv * 3.0)\ncolor = [n, n, n]",
    customFunctions: [fbm2D],
  },
  {
    name: "sdfSphere (raymarched)",
    source: `ro = [0.0, 0.0, -3.0]
centered = uv - [0.5, 0.5]
rd = normalize([centered.x, centered.y, 1.0])
t = 0.0
hit = 0.0
for i in 0..64 {
  p = ro + rd * t
  d = sdfSphere(p, 1.0)
  if d < 0.001 {
    hit = 1.0
  }
  t = t + d * 0.5
}
shade = 1.0 - t * 0.15
color = [hit * shade, hit * shade, hit * shade]`,
    customFunctions: [sdfSphere],
  },
  {
    name: "cosinePalette",
    source: "c = cosinePalette(uv.x + time * 0.1)\ncolor = c",
    customFunctions: [cosinePalette],
  },
];

const results: { name: string; ok: boolean; error?: string }[] = [];

for (const demo of demos) {
  const label = document.createElement("div");
  label.style.color = "white";
  label.style.fontFamily = "monospace";
  label.style.fontSize = "10px";
  label.textContent = demo.name;

  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;

  const wrapper = document.createElement("div");
  wrapper.appendChild(label);
  wrapper.appendChild(canvas);
  row.appendChild(wrapper);

  try {
    const program = compileEzsl(demo.source, { customFunctions: demo.customFunctions });
    mount(canvas, program);
    results.push({ name: demo.name, ok: true });
  } catch (err) {
    results.push({ name: demo.name, ok: false, error: err instanceof Error ? err.message : String(err) });
  }
}

(window as unknown as { __presetDemoResults: typeof results }).__presetDemoResults = results;
(window as unknown as { __presetDemoDone: boolean }).__presetDemoDone = true;
