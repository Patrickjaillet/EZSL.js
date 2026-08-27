/** @type {import('jest').Config} */
export default {
  preset: "ts-jest/presets/default-esm",
  extensionsToTreatAsEsm: [".ts"],
  testEnvironment: "node",
  moduleNameMapper: {
    "^(\\.{1,2}/.*)\\.js$": "$1",
  },
  transform: {
    "^.+\\.ts$": ["ts-jest", { useESM: true }],
  },
  testMatch: ["**/tests/**/*.test.ts"],
  // Sibling packages (ezsl-presets/, vscode-extension/) have their own
  // package.json + jest config + tsconfig with a different rootDir — a
  // bare testMatch glob would otherwise also pick up their tests/*.test.ts
  // files here, which ts-jest then rejects (those files import from
  // outside this project's own src/ rootDir). Run each sibling package's
  // own tests via its own `npm test` inside that directory instead.
  testPathIgnorePatterns: ["/node_modules/", "/ezsl-presets/", "/vscode-extension/", "/ezsl-docs-site/"],
  // v1.0.x "≥90% unit test coverage on the transpiler core" — only active
  // when --coverage is passed (npm run coverage), not on a plain `npm test`
  // run, since instrumenting every file on every ordinary test run has a
  // real speed cost this project doesn't want to pay by default. Scoped to
  // lexer/parser/compiler/codegen (the actual transpiler: tokenize -> parse
  // -> compile -> GLSL codegen) — runtime/cli/errors/integrations are
  // deliberately excluded, since "the transpiler core" is what the roadmap
  // item names, and src/runtime/pipeline.ts specifically is WebGL2-execution
  // code only meaningfully exercised by a real browser (npm run
  // test:integration), not Jest — see docs/architecture/coverage.md. Pure
  // type-declaration files (types.ts/tokens.ts/ast.ts: interfaces and type
  // aliases only, zero runtime statements) are excluded too — v8's coverage
  // collector flags them as 0% simply because nothing ever executes a type
  // declaration at runtime, which would otherwise drag the number down for
  // a reason that has nothing to do with actual test gaps.
  collectCoverageFrom: [
    "src/lexer/**/*.ts",
    "src/parser/**/*.ts",
    "src/compiler/**/*.ts",
    "src/codegen/**/*.ts",
    "!src/**/types.ts",
    "!src/**/tokens.ts",
    "!src/**/ast.ts",
  ],
  coverageThreshold: {
    global: {
      statements: 90,
      lines: 90,
    },
  },
};
