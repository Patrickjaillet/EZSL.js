// Cross-browser integration test. Originally the ROADMAP.md v0.2-v0.4 Alpha
// Deliverable ("Integration test suite: transpile + compile on Chrome,
// Firefox, Safari WebGL2 contexts"); this same suite is also the v1.0.x
// Quality & Coverage "Cross-browser compatibility matrix validated (Chrome,
// Firefox, Safari, Edge — desktop + mobile)" deliverable — one script, one
// source of truth, reused rather than duplicated across the two roadmap
// items. Compiles every example shader in examples/ through the full EZSL
// pipeline and mounts it in a real WebGL2 context, in each of Chromium,
// Firefox, WebKit, and (real, installed) Microsoft Edge — not a mock, an
// actual browser process per engine. See docs/architecture/integration-testing.md
// for what this can and can't stand in for (WebKit via Playwright is not
// real Safari, there is no macOS available to run actual Safari here; and
// there is no mobile coverage at all — see that doc's "What 'desktop +
// mobile' means here" section for why a real mobile GPU driver can't be
// exercised from this environment).
import { chromium, firefox, webkit } from "playwright";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

const PORT = 5299;
const ENGINES = [
  { name: "Chromium", launch: chromium },
  { name: "Firefox", launch: firefox },
  { name: "WebKit", launch: webkit },
  // Real, installed Microsoft Edge (not a Chromium-with-a-different-name
  // assumption) — Playwright's chromium.launch({ channel: "msedge" })
  // drives the actual locally installed Edge binary, per Playwright's own
  // documented "browser channels" mechanism. Edge and Chromium share
  // ANGLE as their GLSL-to-native translation layer, so this is a real
  // engine-level check even though a difference from plain Chromium is
  // less likely here than the Firefox/WebKit comparisons — see
  // docs/architecture/integration-testing.md. Skipped gracefully (not a
  // hard failure) if Edge isn't installed on the machine running this.
  { name: "Edge", launch: chromium, launchOptions: { channel: "msedge" } },
];

function startViteServer() {
  // On Windows, `npx` resolves to npx.cmd, which node's spawn() cannot
  // invoke directly without a shell (confirmed: spawn("npx.cmd", args)
  // fails with EINVAL in this environment even with the .cmd extension
  // explicit). shell:true is required here; every argument is a fixed
  // literal (never user input), so passing them as a single pre-joined
  // command string (rather than an args array, which node/npm warns is
  // unsafe under shell:true since it's concatenated, not escaped) avoids
  // that warning while keeping this call impossible to abuse — there is no
  // untrusted data anywhere in this string.
  const command = `npx vite examples/_harness --port ${PORT} --strictPort`;
  return spawn(command, { stdio: "pipe", shell: true });
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

async function runInEngine(engineName, launcher, url, launchOptions = {}) {
  const browser = await launcher.launch(launchOptions);
  const page = await browser.newPage({ viewport: { width: 64, height: 64 } });
  const pageErrors = [];
  page.on("pageerror", (err) => pageErrors.push(err.message));

  await page.goto(url, { waitUntil: "load" });
  await page.waitForFunction(() => (window).__harnessDone === true, { timeout: 20000 });
  const results = await page.evaluate(() => (window).__harnessResults);

  await browser.close();
  return { engineName, results, pageErrors };
}

async function main() {
  const server = startViteServer();
  let serverOutput = "";
  server.stdout.on("data", (d) => (serverOutput += d.toString()));
  server.stderr.on("data", (d) => (serverOutput += d.toString()));

  try {
    await waitForServer(`http://localhost:${PORT}`);

    let anyFailed = false;
    for (const engine of ENGINES) {
      let outcome;
      try {
        outcome = await runInEngine(engine.name, engine.launch, `http://localhost:${PORT}`, engine.launchOptions);
      } catch (err) {
        // Edge specifically is a real, separately-installed browser, not a
        // Playwright-managed one (unlike Chromium/Firefox/WebKit, which
        // `npx playwright install` always provides) — its absence on a
        // given machine is a real, expected possibility, not a suite
        // failure. Every other engine's launch failure is still a hard
        // failure, since those are expected to always be available once
        // installed per docs/architecture/integration-testing.md.
        const isOptionalEdge = engine.name === "Edge" && /executable doesn't exist|Failed to launch/i.test(err.message);
        if (isOptionalEdge) {
          console.log(`\n=== ${engine.name}: SKIPPED — not installed on this machine (${err.message.split("\n")[0]}) ===`);
          continue;
        }
        console.log(`\n=== ${engine.name}: FAILED TO RUN — ${err.message} ===`);
        anyFailed = true;
        continue;
      }

      const { results, pageErrors } = outcome;
      const failures = results.filter((r) => !r.ok);
      console.log(`\n=== ${engine.name}: ${results.length - failures.length}/${results.length} examples passed ===`);
      for (const f of failures) {
        anyFailed = true;
        console.log(`  FAIL ${f.name}${f.expectedToFail ? " (expected to fail, but didn't)" : ""}: ${f.error ?? "(mounted but should not have)"}`);
      }
      if (pageErrors.length > 0) {
        anyFailed = true;
        console.log(`  Uncaught page errors: ${JSON.stringify(pageErrors)}`);
      }
    }

    if (anyFailed) {
      console.log("\nIntegration test FAILED.");
      process.exitCode = 1;
    } else {
      console.log("\nAll examples compiled and linked successfully in every available browser engine.");
    }
  } finally {
    server.kill();
    if (process.exitCode) {
      console.log("\n--- vite server output ---\n" + serverOutput);
    }
  }
}

main();
