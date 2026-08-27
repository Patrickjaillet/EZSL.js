// The v1.0.x "Semantic versioning enforcement via automated API-diff CI
// check" roadmap deliverable. Compares the current public API surface
// (extractApiSurface.mjs, run against src/index.ts) against a committed
// baseline snapshot (scripts/api-surface-baseline.json — the surface as
// of the last version bump), and fails (exit 1) if anything on the frozen
// surface (see docs/API_STABILITY.md) was removed or changed shape
// without package.json's version having a bumped major component to
// match. See docs/architecture/api-diff-ci.md.
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { extractApiSurface } from "./extractApiSurface.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const BASELINE_PATH = join(HERE, "api-surface-baseline.json");

// Names whose shape is allowed to change in a minor version without
// triggering a major-bump requirement — the WGSL/WebGPU target, still
// explicitly experimental (see docs/architecture/webgpu-target.md and
// docs/API_STABILITY.md's "Explicitly excluded" section). Kept as an
// explicit, visible list here (not inferred from a naming convention)
// so a reviewer can see exactly what's exempted and why, in one place.
const EXPERIMENTAL_EXEMPT = new Set([
  "generateWgslFragmentShader",
  "WgslGenerationResult",
  "layoutUniformBuffer",
  "wgslAlignmentFor",
  "WgslAlignment",
  "LaidOutMember",
  "UboLayout",
]);

async function loadBaseline() {
  try {
    const text = await readFile(BASELINE_PATH, "utf-8");
    return JSON.parse(text);
  } catch (err) {
    if (err.code === "ENOENT") return null;
    throw err;
  }
}

async function loadPackageVersion() {
  const text = await readFile(join(ROOT, "package.json"), "utf-8");
  return JSON.parse(text).version;
}

function majorOf(version) {
  return Number(version.split(".")[0]);
}

async function main() {
  const baseline = await loadBaseline();
  const current = extractApiSurface();

  if (baseline === null) {
    console.log(
      `No baseline found at ${BASELINE_PATH} yet — this is expected before the first frozen release.\n` +
        "Run `node scripts/checkApiDiff.mjs --write-baseline` to create one (do this deliberately, at a real version boundary, not as a way to silence this check).",
    );
    return;
  }

  const removed = [];
  const changed = [];
  const added = [];

  for (const name of Object.keys(baseline)) {
    if (!(name in current)) {
      removed.push(name);
    } else if (baseline[name] !== current[name] && !EXPERIMENTAL_EXEMPT.has(name)) {
      changed.push({ name, before: baseline[name], after: current[name] });
    }
  }
  for (const name of Object.keys(current)) {
    if (!(name in baseline)) added.push(name);
  }

  if (added.length > 0) {
    console.log(`Added exports (non-breaking, fine in a minor release): ${added.join(", ")}`);
  }

  if (removed.length === 0 && changed.length === 0) {
    console.log(`API surface check passed — no breaking changes vs. the committed baseline (${Object.keys(baseline).length} exports checked).`);
    return;
  }

  const currentVersion = await loadPackageVersion();
  const baselineVersionPath = join(HERE, "api-surface-baseline.version.txt");
  let baselineVersion = "0.0.0";
  try {
    baselineVersion = (await readFile(baselineVersionPath, "utf-8")).trim();
  } catch {
    // No recorded baseline version — treat as if a major bump is always required below.
  }

  const majorBumped = majorOf(currentVersion) > majorOf(baselineVersion);

  console.log("\n--- Breaking API changes detected vs. the committed baseline ---\n");
  for (const name of removed) {
    console.log(`  REMOVED: ${name}`);
  }
  for (const { name, before, after } of changed) {
    console.log(`  CHANGED: ${name}`);
    console.log(`    before: ${before}`);
    console.log(`    after:  ${after}`);
  }

  if (majorBumped) {
    console.log(
      `\npackage.json's major version (${currentVersion}) is ahead of the baseline's (${baselineVersion}) — ` +
        "this looks like a deliberate major release. Run `node scripts/checkApiDiff.mjs --write-baseline` to accept these changes into a new baseline.",
    );
    process.exitCode = 0;
    return;
  }

  console.log(
    `\npackage.json's version (${currentVersion}) does not have a major bump over the baseline's (${baselineVersion}), ` +
      "but the API surface changed in a breaking way (see docs/API_STABILITY.md's breaking-change definition). " +
      "Either this change needs a major version bump, or it wasn't actually meant to be breaking — check the diff above.",
  );
  process.exitCode = 1;
}

if (process.argv.includes("--write-baseline")) {
  const { writeFile } = await import("node:fs/promises");
  const surface = extractApiSurface();
  const version = await loadPackageVersion();
  await writeFile(BASELINE_PATH, JSON.stringify(surface, null, 2) + "\n", "utf-8");
  await writeFile(join(HERE, "api-surface-baseline.version.txt"), version + "\n", "utf-8");
  console.log(`Wrote baseline (${Object.keys(surface).length} exports) at package.json version ${version}.`);
} else {
  await main();
}
