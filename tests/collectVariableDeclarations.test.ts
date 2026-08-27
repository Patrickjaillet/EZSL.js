import { collectVariableDeclarations } from "../src/compiler/index.js";

describe("collectVariableDeclarations", () => {
  it("returns every local declaration with its inferred type", () => {
    const declarations = collectVariableDeclarations("a = 1.0\nb = vec2(a, a)\ncolor = [b.x, b.y, 0.0]");
    expect(declarations).toEqual([
      { name: "a", type: "float", line: 1, column: 1 },
      { name: "b", type: "vec2", line: 2, column: 1 },
    ]);
  });

  it("returns an empty array for a program with no intermediate locals", () => {
    expect(collectVariableDeclarations("color = [1.0, 0.0, 0.0]")).toEqual([]);
  });

  it("returns declarations collected before a later CompileError, rather than throwing", () => {
    // `d` is declared successfully; the second line references an unknown
    // function and would throw from compileEzsl — collectVariableDeclarations
    // must still report `d`, since a hover provider needs partial results
    // from a document mid-edit rather than nothing at all.
    const declarations = collectVariableDeclarations("d = length(uv)\ncolor = unknownFn(d)");
    expect(declarations).toEqual([{ name: "d", type: "float", line: 1, column: 1 }]);
  });

  it("returns an empty array (not a throw) for a ParseError", () => {
    expect(() => collectVariableDeclarations("color = ")).not.toThrow();
    expect(collectVariableDeclarations("color = ")).toEqual([]);
  });

  it("returns an empty array (not a throw) for a LexError", () => {
    expect(() => collectVariableDeclarations("color = @#$")).not.toThrow();
  });

  it("still calls a caller-supplied onVariableDeclared alongside its own collection", () => {
    const seen: string[] = [];
    const declarations = collectVariableDeclarations("a = 1.0\ncolor = [a, a, a]", {
      onVariableDeclared: (name) => seen.push(name),
    });
    expect(seen).toEqual(["a"]);
    expect(declarations).toEqual([{ name: "a", type: "float", line: 1, column: 1 }]);
  });

  it("passes through other CompileOptions (e.g. bufferNames)", () => {
    const declarations = collectVariableDeclarations("prev = BufferA.sample(uv)\ncolor = prev", {
      bufferNames: ["BufferA"],
    });
    expect(declarations).toEqual([{ name: "prev", type: "vec4", line: 1, column: 1 }]);
  });
});
