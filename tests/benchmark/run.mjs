// Performance benchmark suite (ROADMAP.md v0.5.x-v0.7.x Beta Deliverable:
// "Performance benchmark suite (transpile time, runtime FPS parity vs.
// hand-written GLSL)"). Two measurements, both run in a real Chromium
// browser via Playwright (not Node's own timers — a real browser's
// WebGL2 driver and requestAnimationFrame loop are what the roadmap item
// actually asks about): (1) how long compileEzsl + codegen takes over many
// iterations, (2) rendered FPS for EZSL-generated GLSL vs. independently
// hand-written GLSL for the same visual program, on the same measurement
// code path. See docs/architecture/performance-benchmarks.md.
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = 5298;

function startViteServer() {
  // See tests/integration/run.mjs for why shell:true + a pre-joined
  // command string is used here (Windows npx.cmd + no untrusted input).
  const command = `npx vite tests/benchmark/_harness --port ${PORT} --strictPort`;
  return spawn(command, { stdio: "pipe", shell: true, cwd: join(HERE, "..", "..") });
}

async function waitForServer(url, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await delay(200);
  }
  throw new Error(`Vite dev server did not become ready at ${url} within ${timeoutMs}ms`);
}

function formatTranspileTable(results) {
  const lines = ["Transpile time (compileEzsl + codegen), 500 iterations each after warmup:", ""];
  lines.push("  shader     iterations   mean (ms)   median (ms)");
  for (const r of results) {
    lines.push(`  ${r.name.padEnd(10)} ${String(r.iterations).padStart(10)}   ${r.meanMs.toFixed(4).padStart(9)}   ${r.medianMs.toFixed(4).padStart(11)}`);
  }
  return lines.join("\n");
}

function formatFpsTable(results) {
  const lines = ["Runtime FPS: EZSL-generated GLSL vs. independently hand-written GLSL (same measurement loop, 3000ms each):", ""];
  lines.push("  shader     EZSL fps   hand-written fps   parity");
  for (const r of results) {
    lines.push(
      `  ${r.name.padEnd(10)} ${r.ezslFps.toFixed(1).padStart(8)}   ${r.handwrittenFps.toFixed(1).padStart(17)}   ${r.parityPercent.toFixed(1)}%`,
    );
  }
  return lines.join("\n");
}

async function main() {
  const server = startViteServer();
  let serverOutput = "";
  server.stdout.on("data", (d) => (serverOutput += d.toString()));
  server.stderr.on("data", (d) => (serverOutput += d.toString()));

  try {
    await waitForServer(`http://localhost:${PORT}`);

    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 512, height: 512 } });
    const pageErrors = [];
    page.on("pageerror", (err) => pageErrors.push(err.message));

    await page.goto(`http://localhost:${PORT}`, { waitUntil: "load" });
    await page.waitForFunction(() => window.__benchmarkDone === true, { timeout: 60000 });
    const { transpile, fps } = await page.evaluate(() => window.__benchmarkResults);

    await browser.close();

    if (pageErrors.length > 0) {
      console.log("Uncaught page errors during benchmark run:", JSON.stringify(pageErrors));
      process.exitCode = 1;
      return;
    }

    console.log("\n" + formatTranspileTable(transpile));
    console.log("\n" + formatFpsTable(fps));
    console.log("\n(Full raw results also written to tests/benchmark/last-results.json)");

    await writeFile(
      join(HERE, "last-results.json"),
      JSON.stringify({ ranAt: new Date().toISOString(), transpile, fps }, null, 2),
      "utf-8",
    );
  } finally {
    server.kill();
    if (process.exitCode) {
      console.log("\n--- vite server output ---\n" + serverOutput);
    }
  }
}

main();
