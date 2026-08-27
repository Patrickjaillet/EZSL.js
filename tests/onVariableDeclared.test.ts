import { compileEzsl, compile, tokenize, parse } from "../src/compiler/index.js";

interface Declaration {
  name: string;
  type: string;
  line: number;
  column: number;
}

function collectDeclarations(source: string): Declaration[] {
  const declarations: Declaration[] = [];
  compileEzsl(source, {
    onVariableDeclared: (name, type, pos) => {
      declarations.push({ name, type, line: pos.line, column: pos.column });
    },
  });
  return declarations;
}

describe("CompileOptions.onVariableDeclared", () => {
  it("is not called for a purely top-level program with no intermediate locals", () => {
    expect(collectDeclarations("color = [1.0, 0.0, 0.0]")).toEqual([]);
  });

  it("fires once for a single local declaration, with its inferred type", () => {
    const declarations = collectDeclarations("d = length(uv)\ncolor = [d, d, d]");
    expect(declarations).toEqual([{ name: "d", type: "float", line: 1, column: 1 }]);
  });

  it("fires for a vector-typed local", () => {
    const declarations = collectDeclarations("trail = vec3(1.0, 0.0, 0.0)\ncolor = trail");
    expect(declarations).toEqual([{ name: "trail", type: "vec3", line: 1, column: 1 }]);
  });

  it("fires once per distinct local, in source order, but not again on re-assignment", () => {
    const declarations = collectDeclarations("total = 0.0\ntotal = total + 1.0\ncolor = [total, total, total]");
    expect(declarations).toEqual([{ name: "total", type: "float", line: 1, column: 1 }]);
  });

  it("fires for a for-loop counter, typed int, at the loop header's position", () => {
    const declarations = collectDeclarations("total = 0.0\nfor i in 0..4 {\n  total = total + float(i)\n}\ncolor = [total, total, total]");
    expect(declarations.map((d) => d.name)).toContain("i");
    const counter = declarations.find((d) => d.name === "i")!;
    expect(counter.type).toBe("int");
    expect(counter.line).toBe(2);
  });

  it("fires for multiple distinct locals in source order", () => {
    const declarations = collectDeclarations("a = 1.0\nb = vec2(a, a)\ncolor = [b.x, b.y, 0.0]");
    expect(declarations.map((d) => d.name)).toEqual(["a", "b"]);
  });

  it("is not called for uniforms (implicit, undeclared identifiers)", () => {
    const declarations = collectDeclarations("color = [speed, speed, speed]");
    expect(declarations).toEqual([]);
  });

  it("does not affect the compiled Program's shape or content when provided", () => {
    const source = "d = length(uv)\ncolor = [d, d, d]";
    const withoutHook = compileEzsl(source);
    const withHook = compileEzsl(source, { onVariableDeclared: () => {} });
    expect(withHook).toEqual(withoutHook);
  });

  it("is usable via the lower-level tokenize/parse/compile pipeline too", () => {
    const declarations: Declaration[] = [];
    const tokens = tokenize("x = 2.0\ncolor = [x, x, x]");
    const ast = parse(tokens);
    compile(ast, {
      onVariableDeclared: (name, type, pos) => declarations.push({ name, type, line: pos.line, column: pos.column }),
    });
    expect(declarations).toEqual([{ name: "x", type: "float", line: 1, column: 1 }]);
  });
});
