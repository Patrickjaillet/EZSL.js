// Real-browser integration check for the Interactive Documentation Site
// (v1.0.x Ecosystem Launch). Mirrors ezsl-playground's own
// tests/playground.integration.mjs pattern (start Vite, drive a real
// Chromium via Playwright) — the whole point here is confirming the
// 3-tier nav, hash-based routing, the Markdown-to-live-block rendering
// pipeline (including pages whose content is loaded directly from
// docs/tutorials/*.md, not duplicated), and CodeMirror + WebGL2 preview
// mounting all actually work together in a real browser. See
// docs/architecture/interactive-docs-site.md. Formalizes the ad-hoc
// checks manually run during development (all of which passed).
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = join(HERE, "..");
const PORT = 5297;

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
    const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
    const pageErrors = [];
    page.on("pageerror", (err) => pageErrors.push(err.message));

    await page.goto(`http://localhost:${PORT}/`, { waitUntil: "load" });
    await page.waitForTimeout(1200);

    // Default route: the first beginner page loads with its one live block.
    const initialTitle = await page.evaluate(() => document.querySelector("#content h1")?.textContent);
    if (initialTitle !== "1. Hello, gradient") fail(`expected default page to be "1. Hello, gradient", got ${JSON.stringify(initialTitle)}`);
    else console.log("PASS: default route loads the first beginner page");

    const helloLiveBlocks = await page.evaluate(() => document.querySelectorAll(".live-block").length);
    if (helloLiveBlocks !== 1) fail(`expected 1 live block on hello-gradient, got ${helloLiveBlocks}`);
    else console.log("PASS: hello-gradient page mounts exactly 1 live block");

    // The 3-tier nav renders all 9 pages, correctly grouped.
    const navLinks = await page.evaluate(() => Array.from(document.querySelectorAll(".nav-link")).map((a) => a.textContent));
    const expectedTitles = [
      "1. Hello, gradient",
      "2. Values and types",
      "3. Variables and control flow",
      "4. Functions, structs, arrays",
      "5. Builtins and uniforms",
      "Three.js scene",
      "Multi-pass (Shadertoy-style)",
      "Canvas2D compositing",
      "The Escape Hatch",
    ];
    const navMatches = navLinks.length === expectedTitles.length && expectedTitles.every((t, i) => navLinks[i] === t);
    if (!navMatches) fail(`nav links do not match expected 9-page, 3-tier structure: ${JSON.stringify(navLinks)}`);
    else console.log("PASS: nav renders all 9 pages across Beginner/Intermediate/Advanced tiers, in order");

    // Headings render as "Beginner"/"Intermediate"/"Advanced" in the DOM;
    // CSS (text-transform: uppercase) is what visually renders them
    // upper-case, not the actual textContent.
    const tierHeadings = await page.evaluate(() => Array.from(document.querySelectorAll(".nav-tier-heading")).map((h) => h.textContent));
    if (JSON.stringify(tierHeadings) !== JSON.stringify(["Beginner", "Intermediate", "Advanced"])) {
      fail(`expected 3 tier headings in order, got ${JSON.stringify(tierHeadings)}`);
    } else {
      console.log("PASS: the 3 tier headings render in order");
    }

    // Navigating (hash route) to a beginner page with multiple live blocks.
    await page.evaluate(() => (window.location.hash = "#/functions-structs-arrays"));
    await page.waitForTimeout(800);
    const funcLiveBlocks = await page.evaluate(() => document.querySelectorAll(".live-block").length);
    if (funcLiveBlocks !== 3) fail(`expected 3 live blocks on functions-structs-arrays, got ${funcLiveBlocks}`);
    else console.log("PASS: functions-structs-arrays page mounts exactly 3 live blocks");

    const activeNavLink = await page.evaluate(() => document.querySelector(".nav-link.active")?.textContent);
    if (activeNavLink !== "4. Functions, structs, arrays") fail(`expected active nav link to update, got ${JSON.stringify(activeNavLink)}`);
    else console.log("PASS: the active nav link updates to match the current page");

    // Editing a live block's source triggers a real recompile (hot-swap, not remount).
    await page.click(".live-block .cm-content >> nth=0");
    await page.keyboard.press("Control+A");
    await page.keyboard.type("color = [1.0, 0.0, 0.0]\nbrightness = 1.0", { delay: 5 });
    await page.waitForTimeout(500);
    const editedBlockHasError = await page.evaluate(() => {
      const overlay = document.querySelectorAll(".live-block-error")[0];
      return overlay ? getComputedStyle(overlay).display === "block" : true;
    });
    if (editedBlockHasError) fail("editing a live block to valid EZSL source left the error overlay visible");
    else console.log("PASS: editing a live block recompiles without showing an error");

    // Intermediate tier: content loaded directly from docs/tutorials/*.md (not duplicated)
    // still correctly distinguishes ```ezsl fences (live) from ```typescript/```bash (static).
    await page.evaluate(() => (window.location.hash = "#/three-js-scene"));
    await page.waitForTimeout(800);
    const threeJsLiveBlocks = await page.evaluate(() => document.querySelectorAll(".live-block").length);
    if (threeJsLiveBlocks !== 2) fail(`expected 2 live blocks (vertex+fragment) on three-js-scene, got ${threeJsLiveBlocks}`);
    else console.log("PASS: three-js-scene (loaded from docs/tutorials/, not duplicated) mounts exactly 2 live blocks");

    const staticCodeBlocks = await page.evaluate(() => document.querySelectorAll("#content pre code").length);
    if (staticCodeBlocks < 1) fail("expected at least one static (non-ezsl) code block on three-js-scene page");
    else console.log(`PASS: three-js-scene page also renders ${staticCodeBlocks} static (non-live) code block(s) correctly`);

    // Cross-linking: the "What's next" link on a beginner page (a real
    // Markdown link, unlike the plain backtick-quoted .md filenames used
    // as prose references elsewhere) rewrites to a working hash route.
    await page.evaluate(() => (window.location.hash = "#/hello-gradient"));
    await page.waitForTimeout(800);
    const firstContentLinkHref = await page.evaluate(() => document.querySelector("#content a[href^='#/']")?.getAttribute("href"));
    if (!firstContentLinkHref) fail("expected at least one in-content link rewritten to a #/ hash route");
    else console.log(`PASS: in-content Markdown links rewrite to hash routes (e.g. ${firstContentLinkHref})`);

    // Advanced tier.
    await page.evaluate(() => (window.location.hash = "#/escape-hatch"));
    await page.waitForTimeout(800);
    const advancedTitle = await page.evaluate(() => document.querySelector("#content h1")?.textContent);
    if (advancedTitle !== "Advanced: the Escape Hatch") fail(`expected advanced page title, got ${JSON.stringify(advancedTitle)}`);
    else console.log("PASS: the advanced Escape Hatch page loads with its correct title");

    const escapeHatchLiveBlocks = await page.evaluate(() => document.querySelectorAll(".live-block").length);
    if (escapeHatchLiveBlocks !== 1) fail(`expected 1 live block on escape-hatch, got ${escapeHatchLiveBlocks}`);
    else console.log("PASS: escape-hatch page mounts exactly 1 live block");

    if (pageErrors.length > 0) {
      fail(`uncaught page errors: ${JSON.stringify(pageErrors)}`);
    } else {
      console.log("PASS: zero uncaught page errors across the whole flow");
    }

    await browser.close();
  } finally {
    server.kill();
    if (process.exitCode) {
      console.log("\n--- vite server output ---\n" + serverOutput);
    }
  }

  if (!process.exitCode) {
    console.log("\nAll Interactive Documentation Site integration checks passed.");
  }
}

main();
