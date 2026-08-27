import { tokenize } from "../src/lexer/tokenizer.js";
import { parse, ParseError } from "../src/parser/parser.js";
import type { AssignmentStatement } from "../src/parser/ast.js";

function parseSource(source: string) {
  return parse(tokenize(source));
}

function assertAssignment(statement: unknown): asserts statement is AssignmentStatement {
  expect((statement as { kind: string }).kind).toBe("AssignmentStatement");
}

describe("parse", () => {
  it("parses a single assignment statement", () => {
    const program = parseSource("x = 1");
    expect(program.statements).toHaveLength(1);
    const statement = program.statements[0];
    assertAssignment(statement);
    expect(statement.name).toBe("x");
    expect(statement.value).toEqual({
      kind: "NumberLiteral",
      value: 1,
      pos: { line: 1, column: 5 },
    });
  });

  it("respects + - vs * / precedence", () => {
    const program = parseSource("x = 1 + 2 * 3");
    const statement = program.statements[0];
    assertAssignment(statement);
    const value = statement.value;
    expect(value.kind).toBe("BinaryExpression");
    if (value.kind === "BinaryExpression") {
      expect(value.operator).toBe("+");
      expect(value.right.kind).toBe("BinaryExpression");
    }
  });

  it("parses vector literals", () => {
    const program = parseSource("color = [1, 2, 3]");
    const statement = program.statements[0];
    assertAssignment(statement);
    const value = statement.value;
    expect(value.kind).toBe("VectorLiteral");
    if (value.kind === "VectorLiteral") {
      expect(value.elements).toHaveLength(3);
    }
  });

  it("parses function calls with multiple arguments", () => {
    const program = parseSource("x = mix(1, 2, 0.5)");
    const statement = program.statements[0];
    assertAssignment(statement);
    const value = statement.value;
    expect(value.kind).toBe("CallExpression");
    if (value.kind === "CallExpression") {
      expect(value.callee).toBe("mix");
      expect(value.args).toHaveLength(3);
    }
  });

  it("parses chained member access (swizzle)", () => {
    const program = parseSource("x = uv.xy");
    const statement = program.statements[0];
    assertAssignment(statement);
    const value = statement.value;
    expect(value.kind).toBe("MemberExpression");
    if (value.kind === "MemberExpression") {
      expect(value.property).toBe("xy");
      expect(value.object).toEqual({ kind: "Identifier", name: "uv", pos: { line: 1, column: 5 } });
    }
  });

  it("desugars unary minus into a binary subtraction from zero", () => {
    const program = parseSource("x = -uv.x");
    const statement = program.statements[0];
    assertAssignment(statement);
    const value = statement.value;
    expect(value.kind).toBe("BinaryExpression");
    if (value.kind === "BinaryExpression") {
      expect(value.operator).toBe("-");
      expect(value.left).toEqual({ kind: "NumberLiteral", value: 0, pos: { line: 1, column: 5 } });
    }
  });

  it("parses multiple statements across lines", () => {
    const program = parseSource("d = length(uv)\ncolor = [d, d, d]");
    expect(program.statements).toHaveLength(2);
    const [first, second] = program.statements;
    assertAssignment(first);
    assertAssignment(second);
    expect(first.name).toBe("d");
    expect(second.name).toBe("color");
  });

  it("throws ParseError on malformed input", () => {
    expect(() => parseSource("x = ")).toThrow(ParseError);
    expect(() => parseSource("= 1")).toThrow(ParseError);
  });

  it("parses an if/else statement with a comparison condition", () => {
    const program = parseSource("if d < 0.5 {\n  x = 1\n} else {\n  x = 2\n}");
    const statement = program.statements[0];
    expect(statement.kind).toBe("IfStatement");
    if (statement.kind === "IfStatement") {
      expect(statement.condition.kind).toBe("ComparisonExpression");
      expect(statement.consequent).toHaveLength(1);
      expect(statement.alternate).toHaveLength(1);
    }
  });

  it("parses an if statement without an else branch", () => {
    const program = parseSource("if d < 0.5 {\n  x = 1\n}");
    const statement = program.statements[0];
    expect(statement.kind).toBe("IfStatement");
    if (statement.kind === "IfStatement") {
      expect(statement.alternate).toBeNull();
    }
  });

  it("parses a bounded for-loop", () => {
    const program = parseSource("for i in 0..8 {\n  x = 1\n}");
    const statement = program.statements[0];
    expect(statement.kind).toBe("ForStatement");
    if (statement.kind === "ForStatement") {
      expect(statement.variable).toBe("i");
      expect(statement.from).toBe(0);
      expect(statement.to).toBe(8);
      expect(statement.body).toHaveLength(1);
    }
  });

  it("parses all comparison operators", () => {
    for (const op of ["<", "<=", ">", ">=", "=="]) {
      const program = parseSource(`if x ${op} 1 {\n  y = 1\n}`);
      const statement = program.statements[0];
      expect(statement.kind).toBe("IfStatement");
      if (statement.kind === "IfStatement" && statement.condition.kind === "ComparisonExpression") {
        expect(statement.condition.operator).toBe(op);
      }
    }
  });

  it("parses a glsl { ... } Escape Hatch statement", () => {
    const program = parseSource("glsl {\n  float x = 1.0;\n}");
    expect(program.statements).toHaveLength(1);
    const statement = program.statements[0];
    expect(statement.kind).toBe("RawGlslStatement");
    if (statement.kind === "RawGlslStatement") {
      expect(statement.source).toContain("float x = 1.0;");
    }
  });

  it("parses a glsl block interleaved with regular EZSL statements", () => {
    const program = parseSource("x = 1.0\nglsl {\n  x = x + 1.0;\n}\ncolor = [x, x, x]");
    expect(program.statements).toHaveLength(3);
    expect(program.statements[1].kind).toBe("RawGlslStatement");
  });
});
