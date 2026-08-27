// Extracts the full public API surface of src/index.ts as a stable, JSON
// snapshot — one entry per exported name, with its resolved TypeScript
// type text (via the real Compiler API's TypeChecker, not a textual
// re-export list like dist/index.d.ts, which only shows re-export
// statements and never the actual resolved shape). This is the mechanism
// backing docs/architecture/api-diff-ci.md's CI check: a real shape
// change (not just a renamed internal file) shows up as a changed
// snapshot entry.
import ts from "typescript";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const ENTRY = join(ROOT, "src", "index.ts");

function loadProgram() {
  const configPath = ts.findConfigFile(ROOT, ts.sys.fileExists, "tsconfig.json");
  if (!configPath) throw new Error("extractApiSurface: could not find tsconfig.json");
  const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(configFile.config, ts.sys, ROOT);
  return ts.createProgram({ rootNames: [ENTRY], options: parsed.options });
}

/** Strips this machine's absolute repo path from `import("<abs path>")` references so snapshots are portable across machines/CI, comparing only relative module paths. */
function toPortablePath(text) {
  const escapedRoot = ROOT.replace(/\\/g, "/").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return text.replace(new RegExp(`import\\("${escapedRoot}/`, "g"), 'import("');
}

/**
 * Renders one exported symbol's full resolved type as stable text. For a
 * function this includes every overload's parameter/return types; for a
 * type/interface it's the resolved member shape. A plain
 * `getDeclaredTypeOfSymbol(symbol)` call was tried first, but returns
 * `any` for a symbol coming from a bare `export type { X } from
 * "./mod.js"` re-export — that symbol is only an *alias*, with no local
 * declaration of its own; `checker.getAliasedSymbol` resolves through to
 * the real originating symbol (in `./mod.js`) first, which does have a
 * declaration to check against. `undefined` return (skipped by the
 * caller) only happens for a symbol the checker genuinely can't resolve —
 * not expected in practice for anything actually exported.
 */
function describeExport(checker, symbol) {
  const aliased = symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
  const declarations = aliased.getDeclarations() ?? symbol.getDeclarations() ?? [];
  const first = declarations[0];
  if (!first) return undefined;

  const isType = Boolean(aliased.flags & (ts.SymbolFlags.Interface | ts.SymbolFlags.TypeAlias));

  let text;
  if (isType) {
    const type = checker.getDeclaredTypeOfSymbol(aliased);
    // An interface's own type prints as just its name (typeToString
    // doesn't expand members unless explicitly asked); InTypeAlias alone
    // is enough for a `type X = ...` alias (whose "declared type" already
    // *is* the expanded shape) but not for `interface X { ... }`, where
    // the declared type is nominal. checker.typeToString has no flag that
    // forces interface-member expansion, so members are rendered directly
    // via getPropertiesOfType instead — every property's own resolved
    // type text, sorted by name for stable output regardless of
    // declaration order changes that don't affect the actual shape.
    const isInterface = Boolean(aliased.flags & ts.SymbolFlags.Interface);
    if (isInterface) {
      const props = checker
        .getPropertiesOfType(type)
        .map((prop) => {
          const propType = checker.getTypeOfSymbolAtLocation(prop, first);
          const optional = prop.flags & ts.SymbolFlags.Optional ? "?" : "";
          return `${prop.getName()}${optional}: ${checker.typeToString(propType, first, ts.TypeFormatFlags.NoTruncation)}`;
        })
        .sort();
      text = `{ ${props.join("; ")} }`;
    } else {
      text = checker.typeToString(type, first, ts.TypeFormatFlags.NoTruncation | ts.TypeFormatFlags.InTypeAlias);
    }
  } else {
    // A value export (function, const, class-as-value): resolve its type
    // at the declaration site, which captures the full callable signature
    // (including overloads) for a function.
    const type = checker.getTypeOfSymbolAtLocation(aliased, first);
    text = checker.typeToString(type, first, ts.TypeFormatFlags.NoTruncation | ts.TypeFormatFlags.WriteArrowStyleSignature);
  }
  return toPortablePath(text);
}

export function extractApiSurface() {
  const program = loadProgram();
  const checker = program.getTypeChecker();
  const sourceFile = program.getSourceFile(ENTRY);
  if (!sourceFile) throw new Error(`extractApiSurface: could not load ${ENTRY} into the TS program`);

  const moduleSymbol = checker.getSymbolAtLocation(sourceFile);
  if (!moduleSymbol) throw new Error("extractApiSurface: src/index.ts has no resolvable module symbol");

  const exports = checker.getExportsOfModule(moduleSymbol);
  const surface = {};

  for (const symbol of exports) {
    const name = symbol.getName();
    const description = describeExport(checker, symbol);
    if (description !== undefined) {
      surface[name] = description;
    }
  }

  return surface;
}

// Allow running directly: `node scripts/extractApiSurface.mjs` prints the
// current surface as JSON (used by checkApiDiff.mjs and available for
// manual inspection / regenerating the baseline). Compares real
// filesystem paths (via fileURLToPath), not raw file:// URL strings —
// the latter differ in leading-slash form between Windows and POSIX and
// would make this check never recognize a direct invocation on Windows.
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  console.log(JSON.stringify(extractApiSurface(), null, 2));
}
