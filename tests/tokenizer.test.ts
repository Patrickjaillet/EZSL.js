import { tokenize, LexError } from "../src/lexer/tokenizer.js";

describe("tokenize", () => {
  it("tokenizes an assignment with a vector literal and a function call", () => {
    const tokens = tokenize("color = [uv.x, uv.y, sin(time)]");
    const types = tokens.map((t) => t.type);
    expect(types).toEqual([
      "IDENTIFIER", "EQUAL", "LBRACKET",
      "IDENTIFIER", "DOT", "IDENTIFIER", "COMMA",
      "IDENTIFIER", "DOT", "IDENTIFIER", "COMMA",
      "IDENTIFIER", "LPAREN", "IDENTIFIER", "RPAREN",
      "RBRACKET", "EOF",
    ]);
  });

  it("tokenizes integer and decimal numbers", () => {
    const tokens = tokenize("0.5 1 3.14");
    expect(tokens.slice(0, 3).map((t) => t.value)).toEqual(["0.5", "1", "3.14"]);
  });

  it("strips line comments", () => {
    const tokens = tokenize("x = 1 // this is a comment\ny = 2");
    expect(tokens.map((t) => t.value)).not.toContain("comment");
  });

  it("collapses consecutive newlines into one NEWLINE token", () => {
    const tokens = tokenize("x = 1\n\n\ny = 2");
    const newlineCount = tokens.filter((t) => t.type === "NEWLINE").length;
    expect(newlineCount).toBe(1);
  });

  it("throws LexError on an unrecognized character", () => {
    expect(() => tokenize("x = 1 @ 2")).toThrow(LexError);
  });

  it("tracks line and column numbers", () => {
    const tokens = tokenize("x = 1\ny = 2");
    const yToken = tokens.find((t) => t.value === "y");
    expect(yToken?.line).toBe(2);
    expect(yToken?.column).toBe(1);
  });

  it("captures a glsl { ... } block as a single RAW_GLSL_BLOCK token", () => {
    const tokens = tokenize("glsl {\n  float x = 1.0;\n}");
    const types = tokens.map((t) => t.type);
    expect(types).toEqual(["GLSL", "RAW_GLSL_BLOCK", "EOF"]);
    expect(tokens[1].value).toBe("\n  float x = 1.0;\n");
  });

  it("tracks brace depth so nested braces inside a glsl block don't close it early", () => {
    const tokens = tokenize("glsl {\n  if (true) {\n    float x = 1.0;\n  }\n}");
    expect(tokens.map((t) => t.type)).toEqual(["GLSL", "RAW_GLSL_BLOCK", "EOF"]);
    expect(tokens[1].value).toContain("if (true) {");
  });

  it("throws LexError on an unterminated glsl block", () => {
    expect(() => tokenize("glsl {\n  float x = 1.0;")).toThrow(LexError);
  });

  it("does not treat 'glsl' as a keyword unless followed by '{'", () => {
    const tokens = tokenize("glsl = 1");
    expect(tokens.map((t) => t.type)).toEqual(["GLSL", "EQUAL", "NUMBER", "EOF"]);
  });
});
