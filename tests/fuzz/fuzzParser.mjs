// Parser fuzz-testing pass (ROADMAP.md v1.0.x Quality & Coverage:
// "Fuzz-testing pass on the parser (malformed input -> graceful error,
// never a silent crash)"). A hand-rolled, dependency-free, seeded
// property-based fuzzer — see docs/architecture/fuzzing.md for why a
// generator/mutation approach was chosen over a fuzzing library, and for
// the one real crash bug this found and led to fixing.
//
// The property under test: for ANY string fed through tokenize -> parse
// -> compile, the result is EITHER a successful compile OR one of the
// three documented pipeline exceptions (LexError, ParseError,
// CompileError) — never any other kind of thrown error (a TypeError, a
// RangeError from unbounded recursion, etc.) and never an uncaught crash
// of the fuzzer process itself.
import { tokenize, LexError } from "../../dist/lexer/tokenizer.js";
import { parse, ParseError } from "../../dist/parser/parser.js";
import { compile, CompileError } from "../../dist/compiler/compile.js";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const EXAMPLES_ROOT = join(HERE, "..", "..", "examples");

// Fixed seed for reproducibility — a failing run must be re-runnable with
// the exact same generated inputs, not "sometimes fails, can't pin down
// why." A simple deterministic LCG (no crypto needed, no dependency) —
// same algorithm shape as many textbook fuzzers' default RNG.
function makeRng(seed) {
  let state = seed >>> 0;
  return function next() {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function loadCorpus() {
  const corpus = [];
  for (const dir of readdirSync(EXAMPLES_ROOT, { withFileTypes: true })) {
    if (!dir.isDirectory() || dir.name.startsWith("_")) continue;
    const dirPath = join(EXAMPLES_ROOT, dir.name);
    for (const file of readdirSync(dirPath)) {
      if (file.endsWith(".ezsl")) {
        corpus.push(readFileSync(join(dirPath, file), "utf-8"));
      }
    }
  }
  return corpus;
}

const EZSL_TOKENS = [
  "for", "in", "if", "else", "glsl", "fn", "return", "struct", "array",
  "color", "uv", "time", "resolution", "position", "normal", "glPosition",
  "+", "-", "*", "/", "=", "==", "<", "<=", ">", ">=", "(", ")", "[", "]",
  "{", "}", ",", ".", "..", ":", "0.0", "1.0", "-1.0", "3.14159",
  "vec2", "vec3", "vec4", "mat2", "mat3", "mat4", "float", "sin", "cos",
  "length", "mix", "smoothstep", "\n", "\n\n", " ", "\t",
];

function randomInt(rng, max) {
  return Math.floor(rng() * max);
}

function pick(rng, arr) {
  return arr[randomInt(rng, arr.length)];
}

/** Mutates one seed string via a randomly chosen strategy — the actual "fuzzing" (small, targeted corruptions of a known-parseable-shaped input, which tends to find more real bugs per input than pure random noise). */
function mutate(rng, seed) {
  const strategy = randomInt(rng, 6);
  const chars = [...seed];
  switch (strategy) {
    case 0: {
      // Delete a random contiguous slice.
      const start = randomInt(rng, chars.length);
      const len = randomInt(rng, Math.max(1, chars.length - start));
      chars.splice(start, len);
      return chars.join("");
    }
    case 1: {
      // Insert a random EZSL token/keyword at a random position.
      const pos = randomInt(rng, chars.length + 1);
      chars.splice(pos, 0, pick(rng, EZSL_TOKENS));
      return chars.join("");
    }
    case 2: {
      // Duplicate a random contiguous slice.
      const start = randomInt(rng, chars.length);
      const len = randomInt(rng, Math.max(1, chars.length - start));
      const slice = chars.slice(start, start + len);
      chars.splice(start, 0, ...slice);
      return chars.join("");
    }
    case 3: {
      // Truncate to a random prefix length — a very common real-world
      // "malformed input" shape (a file cut off mid-write, a partial paste).
      return seed.slice(0, randomInt(rng, seed.length + 1));
    }
    case 4: {
      // Swap two random characters.
      if (chars.length < 2) return seed;
      const i = randomInt(rng, chars.length);
      const j = randomInt(rng, chars.length);
      [chars[i], chars[j]] = [chars[j], chars[i]];
      return chars.join("");
    }
    default: {
      // Insert raw random bytes (non-EZSL-shaped noise) — covers input
      // that doesn't even look like a corrupted EZSL token stream.
      const pos = randomInt(rng, chars.length + 1);
      const noise = String.fromCharCode(32 + randomInt(rng, 95));
      chars.splice(pos, 0, noise);
      return chars.join("");
    }
  }
}

/** Applies `depth` mutations in sequence — deeper corruption for later iterations, matching the common fuzzing heuristic that both shallow and deep mutations find distinct classes of bug. */
function mutateDeep(rng, seed, depth) {
  let current = seed;
  for (let i = 0; i < depth; i++) {
    current = mutate(rng, current);
  }
  return current;
}

/** Runs the full pipeline against one input, classifying the outcome. */
function runOne(source) {
  try {
    const tokens = tokenize(source);
    const ast = parse(tokens);
    compile(ast);
    return { kind: "compiled" };
  } catch (err) {
    if (err instanceof LexError || err instanceof ParseError || err instanceof CompileError) {
      return { kind: "expected-error", errorClass: err.constructor.name };
    }
    return { kind: "unexpected-crash", error: err };
  }
}

export function runFuzzPass({ iterations = 5000, seed = 42 } = {}) {
  const rng = makeRng(seed);
  const corpus = loadCorpus();
  const counts = { compiled: 0, "expected-error": 0, "unexpected-crash": 0 };
  const crashes = [];

  for (let i = 0; i < iterations; i++) {
    const baseSeed = pick(rng, corpus);
    const depth = 1 + randomInt(rng, 5);
    const input = mutateDeep(rng, baseSeed, depth);

    const result = runOne(input);
    counts[result.kind]++;

    if (result.kind === "unexpected-crash") {
      crashes.push({ iteration: i, input, error: result.error });
    }
  }

  return { iterations, seed, counts, crashes };
}

// Allow running directly: `node tests/fuzz/fuzzParser.mjs [iterations] [seed]`
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const iterations = Number(process.argv[2]) || 5000;
  const seed = Number(process.argv[3]) || 42;
  const result = runFuzzPass({ iterations, seed });

  console.log(`Fuzz pass: ${result.iterations} iterations, seed=${result.seed}`);
  console.log(`  compiled successfully: ${result.counts.compiled}`);
  console.log(`  expected error (Lex/Parse/CompileError): ${result.counts["expected-error"]}`);
  console.log(`  UNEXPECTED CRASH: ${result.counts["unexpected-crash"]}`);

  if (result.crashes.length > 0) {
    console.log("\n--- Unexpected crashes (first 5) ---");
    for (const c of result.crashes.slice(0, 5)) {
      console.log(`\n[iteration ${c.iteration}] input:\n${JSON.stringify(c.input)}`);
      console.log(`error: ${c.error?.stack ?? c.error}`);
    }
    process.exitCode = 1;
  } else {
    console.log("\nNo unexpected crashes — every input either compiled or raised a documented pipeline error.");
  }
}
