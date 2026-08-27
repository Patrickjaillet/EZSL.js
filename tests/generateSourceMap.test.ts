import { generateEzslSourceMap, sourceMapComment } from "../src/errors/generateSourceMap.js";
import { compileEzsl } from "../src/compiler/index.js";
import { generateFragmentShaderMapped } from "../src/codegen/glslGenerator.js";

describe("generateEzslSourceMap", () => {
  it("produces a version 3 map with the given URL as its one source", () => {
    const program = compileEzsl("x = 1.0\ncolor = [x, x, x]");
    const { sourceMap } = generateFragmentShaderMapped(program);
    const map = generateEzslSourceMap(sourceMap, "http://localhost:5173/shader.ezsl", "x = 1.0\ncolor = [x, x, x]");
    expect(map.version).toBe(3);
    expect(map.sources).toEqual(["http://localhost:5173/shader.ezsl"]);
  });

  it("embeds the original .ezsl text as sourcesContent", () => {
    const program = compileEzsl("color = [1.0, 0.0, 0.0]");
    const { sourceMap } = generateFragmentShaderMapped(program);
    const ezslSource = "color = [1.0, 0.0, 0.0]";
    const map = generateEzslSourceMap(sourceMap, "http://localhost/shader.ezsl", ezslSource);
    expect(map.sourcesContent).toEqual([ezslSource]);
  });

  it("produces one semicolon-separated group per generated GLSL line", () => {
    const program = compileEzsl("x = 1.0\ncolor = [x, x, x]");
    const { source, sourceMap } = generateFragmentShaderMapped(program);
    const map = generateEzslSourceMap(sourceMap, "http://localhost/shader.ezsl", "x = 1.0\ncolor = [x, x, x]");
    const generatedLineCount = source.split("\n").length;
    // mappings has one group per generated line the sourceMap actually
    // covers (1..maxGlslLine) — semicolon count is groups - 1.
    const maxMappedLine = Math.max(...sourceMap.keys());
    expect(map.mappings.split(";").length).toBe(maxMappedLine);
    expect(maxMappedLine).toBeLessThanOrEqual(generatedLineCount);
  });

  it("leaves unmapped generated lines (boilerplate) with an empty segment group", () => {
    const program = compileEzsl("color = [1.0, 0.0, 0.0]");
    const { sourceMap } = generateFragmentShaderMapped(program);
    const map = generateEzslSourceMap(sourceMap, "http://localhost/shader.ezsl", "color = [1.0, 0.0, 0.0]");
    const groups = map.mappings.split(";");
    // Line 1 is always "#version 300 es" — compiler-synthesized, unmapped.
    expect(sourceMap.get(1)).toBeNull();
    expect(groups[0]).toBe("");
  });

  it("produces a non-empty segment for a line mapped to a real .ezsl line", () => {
    const program = compileEzsl("color = [1.0, 0.0, 0.0]");
    const { sourceMap } = generateFragmentShaderMapped(program);
    const map = generateEzslSourceMap(sourceMap, "http://localhost/shader.ezsl", "color = [1.0, 0.0, 0.0]");
    const groups = map.mappings.split(";");
    let sawNonEmptySegment = false;
    for (const [glslLine, ezslLine] of sourceMap) {
      if (ezslLine !== null) {
        expect(groups[glslLine - 1]).not.toBe("");
        sawNonEmptySegment = true;
      }
    }
    expect(sawNonEmptySegment).toBe(true);
  });

  it("has no names (EZSL's line-granular mapping never needs symbol names)", () => {
    const program = compileEzsl("color = [1.0, 0.0, 0.0]");
    const { sourceMap } = generateFragmentShaderMapped(program);
    const map = generateEzslSourceMap(sourceMap, "http://localhost/shader.ezsl", "color = [1.0, 0.0, 0.0]");
    expect(map.names).toEqual([]);
  });
});

describe("sourceMapComment", () => {
  it("renders a sourceMappingURL comment with a base64 data: URL", () => {
    const map = generateEzslSourceMap(new Map([[1, 1]]), "http://localhost/shader.ezsl", "color = [1.0, 0.0, 0.0]");
    const comment = sourceMapComment(map);
    expect(comment).toMatch(/^\/\/# sourceMappingURL=data:application\/json;charset=utf-8;base64,[A-Za-z0-9+/=]+$/);
  });

  it("the embedded base64 payload decodes back to valid JSON matching the map", () => {
    const map = generateEzslSourceMap(new Map([[1, 1]]), "http://localhost/shader.ezsl", "color = [1.0, 0.0, 0.0]");
    const comment = sourceMapComment(map);
    const base64 = comment.split("base64,")[1];
    const decoded = JSON.parse(Buffer.from(base64, "base64").toString("utf-8"));
    expect(decoded).toEqual(map);
  });
});
