import { readFile, writeFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compileSourceToGlsl, runBuild, runCheck } from "../src/cli/commands.js";
import { formatCliError, isEzslPipelineError } from "../src/cli/formatCliError.js";
import { CompileError } from "../src/compiler/compile.js";
import { LexError } from "../src/lexer/tokenizer.js";
import { ParseError } from "../src/parser/parser.js";

describe("compileSourceToGlsl", () => {
  it("compiles a valid fragment-stage program to GLSL text", () => {
    const result = compileSourceToGlsl("color = [1.0, 0.0, 0.0]", "test.ezsl");
    expect(result.ok).toBe(true);
    expect(result.glsl).toContain("#version 300 es");
    expect(result.glsl).toContain("fragColor = vec4(vec3(1.0, 0.0, 0.0), 1.0);");
  });

  it("compiles a valid vertex-stage program to GLSL text when vertex: true", () => {
    const result = compileSourceToGlsl("glPosition = vec4(position, 1.0)", "test.ezsl", { vertex: true });
    expect(result.ok).toBe(true);
    expect(result.glsl).toContain("gl_Position = vec4(position, 1.0);");
  });

  it("returns ok: false with a formatted error block for an EZSL-side CompileError", () => {
    const result = compileSourceToGlsl("color = unknownFn(1.0)", "test.ezsl");
    expect(result.ok).toBe(false);
    expect(result.errorText).toContain("error in test.ezsl at");
    expect(result.errorText).toContain("unknown function 'unknownFn'");
  });

  it("returns ok: false for a ParseError (malformed syntax)", () => {
    const result = compileSourceToGlsl("color = ", "test.ezsl");
    expect(result.ok).toBe(false);
    expect(result.errorText).toContain("error in test.ezsl at");
  });

  it("rethrows a non-pipeline error rather than swallowing it", () => {
    expect(() => compileSourceToGlsl(null as unknown as string, "test.ezsl")).toThrow();
  });
});

describe("formatCliError", () => {
  it("renders a source snippet with a caret at the error's column", () => {
    const error = new CompileError("unknown function 'foo'", 2, 8);
    const source = "x = 1.0\ny = foo(x)";
    const text = formatCliError(error, source, "shader.ezsl");
    expect(text).toContain("error in shader.ezsl at 2:8");
    expect(text).toContain("2 | y = foo(x)");
    expect(text.split("\n")[2]).toBe(`${" ".repeat("2 | ".length + 7)}^`);
    expect(text).toContain("unknown function 'foo'");
  });

  it("omits the snippet lines gracefully when the line number is out of range", () => {
    const error = new ParseError("unexpected end of input", 99, 1);
    const text = formatCliError(error, "x = 1.0", "shader.ezsl");
    expect(text).toContain("error in shader.ezsl at 99:1");
    expect(text).toContain("unexpected end of input");
  });
});

describe("isEzslPipelineError", () => {
  it("recognizes LexError, ParseError, and CompileError", () => {
    expect(isEzslPipelineError(new LexError("m", 1, 1))).toBe(true);
    expect(isEzslPipelineError(new ParseError("m", 1, 1))).toBe(true);
    expect(isEzslPipelineError(new CompileError("m", 1, 1))).toBe(true);
  });

  it("rejects an unrelated error", () => {
    expect(isEzslPipelineError(new Error("plain"))).toBe(false);
    expect(isEzslPipelineError("not an error")).toBe(false);
  });
});

describe("runBuild / runCheck (real filesystem)", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "ezsl-cli-test-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("runBuild writes a sibling .glsl file and returns exit code 0 for valid source", async () => {
    const ezslPath = join(dir, "shader.ezsl");
    await writeFile(ezslPath, "color = [0.2, 0.4, 0.6]", "utf-8");

    const code = await runBuild(ezslPath);
    expect(code).toBe(0);

    const glsl = await readFile(join(dir, "shader.glsl"), "utf-8");
    expect(glsl).toContain("fragColor = vec4(vec3(0.2, 0.4, 0.6), 1.0);");
  });

  it("runBuild returns exit code 1 and writes no file for invalid source", async () => {
    const ezslPath = join(dir, "broken.ezsl");
    await writeFile(ezslPath, "color = unknownFn(1.0)", "utf-8");

    const code = await runBuild(ezslPath);
    expect(code).toBe(1);

    await expect(readFile(join(dir, "broken.glsl"), "utf-8")).rejects.toThrow();
  });

  it("runCheck returns exit code 0 and writes nothing for valid source", async () => {
    const ezslPath = join(dir, "shader.ezsl");
    await writeFile(ezslPath, "color = [1.0, 1.0, 1.0]", "utf-8");

    const code = await runCheck(ezslPath);
    expect(code).toBe(0);

    await expect(readFile(join(dir, "shader.glsl"), "utf-8")).rejects.toThrow();
  });

  it("runCheck returns exit code 1 for invalid source", async () => {
    const ezslPath = join(dir, "broken.ezsl");
    await writeFile(ezslPath, "color = unknownFn(1.0)", "utf-8");

    const code = await runCheck(ezslPath);
    expect(code).toBe(1);
  });
});
