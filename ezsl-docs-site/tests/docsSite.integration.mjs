// Real-browser integration check for the Interactive Documentation Site +
// Playground (v2 unified site — see docs/architecture/unified-site-v2.md).
// Mirrors the project's established pattern (start Vite, drive a real
// Chromium via Playwright) — the whole point here is confirming the nav
// (including the merged Playground route and the new Comparisons tier),
// hash-based routing, the Markdown-to-live-block rendering pipeline, the
// merged Shadertoy-style editor (gallery, GLSL split-view, share URLs),
// and mobile responsiveness all actually work together in a real browser.
// This suite absorbs the former standalone ezsl-playground package's own
// playground.integration.mjs checks — see the "Playground" section below.
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

    // The 4-tier nav renders all 15 pages, correctly grouped, plus the
    // always-visible Playground link outside the tier loop.
    const navLinks = await page.evaluate(() => Array.from(document.querySelectorAll(".nav-link")).map((a) => a.textContent));
    const expectedTitles = [
      "1. Hello, gradient",
      "2. Values and types",
      "3. Variables and control flow",
      "4. Functions, structs, arrays",
      "5. Builtins and uniforms",
      "Three.js scene",
      "Babylon.js scene",
      "Multi-pass (Shadertoy-style)",
      "Canvas2D compositing",
      "Overview",
      "Syntax side-by-side",
      "Type systems compared",
      "Uniforms & varyings compared",
      "Multi-pass compared",
      "The Escape Hatch",
    ];
    const navMatches = navLinks.length === expectedTitles.length && expectedTitles.every((t, i) => navLinks[i] === t);
    if (!navMatches) fail(`nav links do not match expected 15-page, 4-tier structure: ${JSON.stringify(navLinks)}`);
    else console.log("PASS: nav renders all 15 pages across Beginner/Intermediate/Comparisons/Advanced tiers, in order");

    const playgroundNavLink = await page.evaluate(() => document.querySelector(".nav-playground-link")?.textContent);
    if (playgroundNavLink !== "Playground") fail(`expected a Playground nav link, got ${JSON.stringify(playgroundNavLink)}`);
    else console.log("PASS: the Playground nav link is present, outside the tier loop");

    const tierHeadings = await page.evaluate(() => Array.from(document.querySelectorAll(".nav-tier-heading")).map((h) => h.textContent));
    if (JSON.stringify(tierHeadings) !== JSON.stringify(["Beginner", "Intermediate", "Comparisons", "Advanced"])) {
      fail(`expected 4 tier headings in order, got ${JSON.stringify(tierHeadings)}`);
    } else {
      console.log("PASS: the 4 tier headings render in order, including the new Comparisons tier");
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

    // Same check for the new Babylon.js tutorial (also loaded directly from
    // docs/tutorials/, not duplicated).
    await page.evaluate(() => (window.location.hash = "#/babylon-js-scene"));
    await page.waitForTimeout(800);
    const babylonJsLiveBlocks = await page.evaluate(() => document.querySelectorAll(".live-block").length);
    if (babylonJsLiveBlocks !== 2) fail(`expected 2 live blocks (vertex+fragment) on babylon-js-scene, got ${babylonJsLiveBlocks}`);
    else console.log("PASS: babylon-js-scene (loaded from docs/tutorials/, not duplicated) mounts exactly 2 live blocks");

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

    // --- Comparisons tier ---
    await page.evaluate(() => (window.location.hash = "#/syntax-side-by-side"));
    await page.waitForTimeout(800);
    const tabButtons = await page.evaluate(() => document.querySelectorAll("#syntax-tabs .tabs-nav button").length);
    if (tabButtons !== 4) fail(`expected 4 tabs (EZSL/GLSL/Shadertoy/WGSL) on syntax-side-by-side, got ${tabButtons}`);
    else console.log("PASS: syntax-side-by-side page renders all 4 language tabs");

    await page.click('#syntax-tabs .tabs-nav button[data-tab="wgsl"]');
    await page.waitForTimeout(200);
    const activeTabPanel = await page.evaluate(() => document.querySelector("#syntax-tabs .tabs-panel.active")?.dataset.tab);
    if (activeTabPanel !== "wgsl") fail(`expected clicking the WGSL tab to activate its panel, got active panel ${JSON.stringify(activeTabPanel)}`);
    else console.log("PASS: clicking a tab switches the active panel");

    const wgslBadgeVisible = await page.evaluate(() => document.querySelectorAll(".badge-experimental").length > 0);
    if (!wgslBadgeVisible) fail("expected an Experimental badge on the WGSL tab/content");
    else console.log("PASS: the WGSL Experimental badge is present");

    // --- Playground (merged from the former standalone ezsl-playground package) ---
    await page.evaluate(() => (window.location.hash = "#/playground"));
    await page.waitForTimeout(1000);

    const initialGlsl = await page.evaluate(() => document.getElementById("glsl-output")?.textContent ?? "");
    if (!initialGlsl.includes("#version 300 es")) fail("initial GLSL split-view is not populated with real GLSL on the Playground route");
    else console.log("PASS: Playground route populates the GLSL split-view on load");

    // The Playground is a full-screen app, not a doc page — the docs sidebar
    // must be hidden entirely so the 4-panel editor can use the full
    // viewport width (a real layout bug: the sidebar staying visible here
    // squeezed the editor into a narrow, unprofessional-looking column).
    const sidebarHiddenOnPlayground = await page.evaluate(() => getComputedStyle(document.getElementById("nav")).display === "none");
    if (!sidebarHiddenOnPlayground) fail("expected the docs sidebar to be hidden on the Playground route");
    else console.log("PASS: the docs sidebar is hidden on the Playground route");

    const playgroundFillsWidth = await page.evaluate(() => {
      const rect = document.getElementById("playground-app").getBoundingClientRect();
      return rect.width > window.innerWidth * 0.95;
    });
    if (!playgroundFillsWidth) fail("expected the Playground app to fill the viewport width, not be squeezed next to a sidebar");
    else console.log("PASS: the Playground app fills the full viewport width");

    const galleryCount = await page.evaluate(() => document.querySelectorAll(".gallery-item").length);
    if (galleryCount !== 33) fail(`expected 33 curated gallery entries (21 original + 12 new), got ${galleryCount}`);
    else console.log(`PASS: Playground gallery renders all 33 curated entries`);

    const categoryHeadings = await page.evaluate(() => Array.from(document.querySelectorAll(".gallery-category-heading")).map((h) => h.textContent));
    if (categoryHeadings.length !== 5) fail(`expected 5 gallery category headings, got ${JSON.stringify(categoryHeadings)}`);
    else console.log(`PASS: gallery is grouped under ${categoryHeadings.length} category headings`);

    await page.click(".gallery-item >> text=Voronoi");
    await page.waitForTimeout(500);
    const voronoiLineCount = await page.evaluate(() => document.querySelectorAll("#ezsl-editor .cm-line").length);
    const activeItem = await page.evaluate(() => document.querySelector(".gallery-item.active")?.textContent);
    if (voronoiLineCount < 3 || activeItem !== "Voronoi") {
      fail(`clicking a new gallery entry (Voronoi) did not correctly load it: lines=${voronoiLineCount} activeItem=${JSON.stringify(activeItem)}`);
    } else {
      console.log("PASS: clicking a newly-added gallery entry (Voronoi) loads it and marks it active");
    }

    await page.click("#gallery-toggle");
    await page.waitForTimeout(250);
    const collapsedWidth = await page.evaluate(() => document.getElementById("gallery-panel")?.getBoundingClientRect().width ?? -1);
    if (collapsedWidth > 5) fail(`gallery panel did not collapse when toggled (width=${collapsedWidth})`);
    else console.log("PASS: the Playground gallery panel collapses when toggled");
    await page.click("#gallery-toggle");

    await page.click("#ezsl-editor .cm-content");
    await page.keyboard.press("Control+A");
    await page.keyboard.type("color = [1.0, 0.0, 0.0]", { delay: 5 });
    await page.waitForTimeout(500);
    const editedGlsl = await page.evaluate(() => document.getElementById("glsl-output")?.textContent ?? "");
    if (!editedGlsl.includes("1.0, 0.0, 0.0")) fail("editing the Playground source did not update the GLSL split-view");
    else console.log("PASS: real-time recompile updates the Playground's GLSL split-view");

    await page.keyboard.press("Control+A");
    await page.keyboard.type("color = unknownFn(1.0)", { delay: 5 });
    await page.waitForTimeout(500);
    const errorVisible = await page.evaluate(() => document.getElementById("error-overlay")?.style.display === "block");
    const errorText = await page.evaluate(() => document.getElementById("error-overlay")?.textContent ?? "");
    if (!errorVisible || !errorText.includes("unknown function")) fail(`Playground compile error overlay incorrect: visible=${errorVisible} text=${JSON.stringify(errorText)}`);
    else console.log("PASS: a real CompileError shows a correctly formatted overlay on the Playground route");

    await page.keyboard.press("Control+A");
    await page.keyboard.type("color = [0.0, 1.0, 1.0]", { delay: 5 });
    await page.waitForTimeout(500);
    const errorHiddenAfterFix = await page.evaluate(() => document.getElementById("error-overlay")?.style.display !== "block");
    if (!errorHiddenAfterFix) fail("Playground error overlay did not hide after fixing the shader");
    else console.log("PASS: fixing a broken shader hides the Playground error overlay");

    const urlAfterEdit = page.url();
    if (!urlAfterEdit.includes("#/playground/")) fail("URL does not use the #/playground/<base64> scheme after editing");
    else console.log("PASS: the URL updates live to reflect the current shader under the #/playground/ route");

    await page.goto(urlAfterEdit, { waitUntil: "load" });
    await page.waitForTimeout(1000);
    const restoredContent = await page.evaluate(() => document.querySelector("#ezsl-editor .cm-content")?.textContent ?? "");
    if (!restoredContent.includes("1.0")) fail(`reloading a Playground share URL did not restore the shader (got: ${JSON.stringify(restoredContent)})`);
    else console.log("PASS: reloading a shareable Playground URL restores the shader source");

    // --- Mobile responsiveness ---
    await page.evaluate(() => (window.location.hash = "#/hello-gradient"));
    await page.setViewportSize({ width: 480, height: 800 });
    await page.waitForTimeout(500);
    const navHiddenOnMobile = await page.evaluate(() => !document.getElementById("app")?.classList.contains("nav-open"));
    if (!navHiddenOnMobile) fail("expected the nav to start closed on a mobile-width viewport");
    else console.log("PASS: the sidebar nav starts closed on a mobile-width viewport");

    await page.click("#nav-toggle");
    await page.waitForTimeout(300);
    const navOpenAfterToggle = await page.evaluate(() => document.getElementById("app")?.classList.contains("nav-open"));
    if (!navOpenAfterToggle) fail("clicking the hamburger nav toggle did not open the mobile nav");
    else console.log("PASS: the hamburger nav toggle opens the mobile nav overlay");

    await page.click("#nav-scrim");
    await page.waitForTimeout(300);
    const navClosedAfterScrim = await page.evaluate(() => !document.getElementById("app")?.classList.contains("nav-open"));
    if (!navClosedAfterScrim) fail("clicking the nav scrim did not close the mobile nav");
    else console.log("PASS: clicking the scrim closes the mobile nav overlay");

    // On mobile, the Playground route hides the (now-irrelevant) hamburger
    // toggle too, since there's no sidebar for it to open on that route.
    await page.evaluate(() => (window.location.hash = "#/playground"));
    await page.waitForTimeout(800);
    const hamburgerHiddenOnPlaygroundMobile = await page.evaluate(() => getComputedStyle(document.getElementById("nav-toggle")).display === "none");
    if (!hamburgerHiddenOnPlaygroundMobile) fail("expected the hamburger nav toggle to be hidden on the Playground route (mobile)");
    else console.log("PASS: the hamburger nav toggle is hidden on the Playground route on mobile");

    await page.setViewportSize({ width: 1200, height: 900 });

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
    console.log("\nAll Interactive Documentation Site + Playground integration checks passed.");
  }
}

main();
