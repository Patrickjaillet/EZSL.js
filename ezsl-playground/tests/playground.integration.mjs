// Real-browser integration check for the Online Playground (v1.0.x
// Ecosystem Launch). Mirrors the main repo's tests/integration/run.mjs
// pattern (start Vite, drive a real Chromium via Playwright) — not a
// unit test, since the whole point here is confirming CodeMirror, the
// live-recompile debounce, the split-view GLSL panel, the error overlay,
// and the URL-fragment-based share/reload round-trip all actually work
// together in a real browser. See docs/architecture/online-playground.md.
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = join(HERE, "..");
const PORT = 5296;

function startViteServer() {
  const command = `npx vite --port ${PORT} --strictPort`;
  return spawn(command, { stdio: "pipe", shell: true, cwd: PACKAGE_ROOT });
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

function fail(message) {
  console.log(`FAIL: ${message}`);
  process.exitCode = 1;
}

async function main() {
  const server = startViteServer();
  let serverOutput = "";
  server.stdout.on("data", (d) => (serverOutput += d.toString()));
  server.stderr.on("data", (d) => (serverOutput += d.toString()));

  try {
    await waitForServer(`http://localhost:${PORT}`);

    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1400, height: 700 } });
    const pageErrors = [];
    page.on("pageerror", (err) => pageErrors.push(err.message));

    await page.goto(`http://localhost:${PORT}/`, { waitUntil: "load" });
    await page.waitForTimeout(1200);

    const initialGlsl = await page.evaluate(() => document.getElementById("glsl-output")?.textContent ?? "");
    if (!initialGlsl.includes("#version 300 es")) fail("initial GLSL split-view is not populated with real GLSL");
    else console.log("PASS: initial load populates the GLSL split-view");

    // Gallery: every curated entry renders, clicking one loads it into the
    // editor and recompiles, and the clicked item is marked active.
    const galleryCount = await page.evaluate(() => document.querySelectorAll(".gallery-item").length);
    if (galleryCount < 15) fail(`expected a real gallery with many curated entries, got ${galleryCount}`);
    else console.log(`PASS: gallery renders ${galleryCount} curated entries`);

    await page.click(".gallery-item >> text=Plasma");
    await page.waitForTimeout(500);
    const plasmaLineCount = await page.evaluate(() => document.querySelectorAll(".cm-line").length);
    const plasmaFirstLine = await page.evaluate(() => document.querySelector(".cm-line")?.textContent ?? "");
    const plasmaGlsl = await page.evaluate(() => document.getElementById("glsl-output")?.textContent ?? "");
    const activeItem = await page.evaluate(() => document.querySelector(".gallery-item.active")?.textContent);
    if (plasmaLineCount < 5 || !plasmaFirstLine.startsWith("a = sin(") || !plasmaGlsl.includes("float b = sin(") || activeItem !== "Plasma") {
      fail(
        `clicking a gallery entry did not correctly load it: lines=${plasmaLineCount} firstLine=${JSON.stringify(plasmaFirstLine)} activeItem=${JSON.stringify(activeItem)} glslHasB=${plasmaGlsl.includes("float b = sin(")}`,
      );
    } else {
      console.log("PASS: clicking a gallery entry loads its real multi-line source and recompiles it, marking it active");
    }

    // The gallery panel actually collapses when toggled.
    await page.click("#gallery-toggle");
    await page.waitForTimeout(250);
    const collapsedWidth = await page.evaluate(() => document.getElementById("gallery-panel")?.getBoundingClientRect().width ?? -1);
    if (collapsedWidth > 5) fail(`gallery panel did not collapse when toggled (width=${collapsedWidth})`);
    else console.log("PASS: the gallery panel collapses when toggled");
    await page.click("#gallery-toggle"); // reopen for the rest of the checks below, to leave state predictable

    // Real-time recompile: edit the source, confirm the GLSL panel updates.
    await page.click(".cm-content");
    await page.keyboard.press("Control+A");
    await page.keyboard.type("color = [1.0, 0.0, 0.0]", { delay: 5 });
    await page.waitForTimeout(500);
    const editedGlsl = await page.evaluate(() => document.getElementById("glsl-output")?.textContent ?? "");
    if (!editedGlsl.includes("1.0, 0.0, 0.0")) fail("editing the source did not update the GLSL split-view");
    else console.log("PASS: real-time recompile updates the GLSL split-view");

    // Compile error handling: the overlay shows and the source-mapped message is correct.
    await page.keyboard.press("Control+A");
    await page.keyboard.type("color = unknownFn(1.0)", { delay: 5 });
    await page.waitForTimeout(500);
    const errorVisible = await page.evaluate(() => document.getElementById("error-overlay")?.style.display === "block");
    const errorText = await page.evaluate(() => document.getElementById("error-overlay")?.textContent ?? "");
    if (!errorVisible || !errorText.includes("unknown function")) fail(`compile error overlay incorrect: visible=${errorVisible} text=${JSON.stringify(errorText)}`);
    else console.log("PASS: a real CompileError shows a correctly formatted overlay");

    // Recovery: fixing the shader hides the overlay again.
    await page.keyboard.press("Control+A");
    await page.keyboard.type("color = [0.0, 1.0, 1.0]", { delay: 5 });
    await page.waitForTimeout(500);
    const errorHiddenAfterFix = await page.evaluate(() => document.getElementById("error-overlay")?.style.display !== "block");
    if (!errorHiddenAfterFix) fail("error overlay did not hide after fixing the shader");
    else console.log("PASS: fixing a broken shader hides the error overlay");

    // Shareable URL: the fragment reflects the current shader, and reloading from it restores the editor content.
    const urlAfterEdit = page.url();
    if (!urlAfterEdit.includes("#shader=")) fail("URL fragment does not contain the shader state after editing");
    else console.log("PASS: the URL fragment updates live to reflect the current shader");

    await page.goto(urlAfterEdit, { waitUntil: "load" });
    await page.waitForTimeout(1000);
    const restoredContent = await page.evaluate(() => document.querySelector(".cm-content")?.textContent ?? "");
    if (!restoredContent.includes("0.0, 1.0, 1.0")) fail(`reloading a share URL did not restore the shader (got: ${JSON.stringify(restoredContent)})`);
    else console.log("PASS: reloading a shareable URL restores the exact shader source");

    if (pageErrors.length > 0) {
      fail(`uncaught page errors: ${JSON.stringify(pageErrors)}`);
    }

    await browser.close();
  } finally {
    server.kill();
    if (process.exitCode) {
      console.log("\n--- vite server output ---\n" + serverOutput);
    }
  }

  if (!process.exitCode) {
    console.log("\nAll Online Playground integration checks passed.");
  }
}

main();
