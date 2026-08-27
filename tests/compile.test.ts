import { compileEzsl, defineFunction } from "../src/compiler/index.js";
import { CompileError } from "../src/compiler/compile.js";
import { generateFragmentShader } from "../src/codegen/glslGenerator.js";
import type { Program } from "../src/codegen/types.js";

function bodyGlsl(program: Program): string[] {
  return program.body.map((l) => l.glsl);
}

describe("compileEzsl", () => {
  it("compiles the gradient example into a valid codegen Program", () => {
    const program = compileEzsl("color = [uv.x, uv.y, 0.5 + 0.5 * sin(time)]");
    expect(program.outColor.type).toBe("vec4");
    expect(program.outColor.glsl).toContain("vec3(uv.x, uv.y,");

    const glsl = generateFragmentShader(program);
    expect(glsl).toContain("fragColor = vec4(vec3(uv.x, uv.y,");
  });

  it("infers vec3 from a 3-element vector literal", () => {
    const program = compileEzsl("color = [1, 0, 0]");
    expect(program.outColor.glsl).toBe("vec4(vec3(1.0, 0.0, 0.0), 1.0)");
  });

  it("wraps a non-vec4 color expression in vec4(..., 1.0)", () => {
    const program = compileEzsl("color = length(uv)");
    expect(program.outColor.glsl).toBe("vec4(length(uv), 1.0)");
  });

  it("passes vec4 color expressions through unchanged", () => {
    const program = compileEzsl("color = vec4(uv.x, uv.y, 0.0, 1.0)");
    expect(program.outColor.glsl).toBe("vec4(uv.x, uv.y, 0.0, 1.0)");
  });

  it("emits intermediate assignments as typed GLSL body statements", () => {
    const program = compileEzsl("d = length(uv)\ncolor = [d, d, d]");
    expect(bodyGlsl(program)).toEqual(["float d = length(uv);"]);
  });

  it("declares unknown identifiers as float uniforms", () => {
    const program = compileEzsl("color = [speed, speed, speed]");
    expect(program.uniforms).toEqual([{ name: "speed", glslName: "u_speed", type: "float" }]);
  });

  it("throws CompileError when the program never assigns to color", () => {
    expect(() => compileEzsl("x = 1")).toThrow(CompileError);
  });

  it("throws CompileError on an unknown function call", () => {
    expect(() => compileEzsl("color = bogus(uv)")).toThrow(CompileError);
  });

  it("throws CompileError on an invalid swizzle", () => {
    expect(() => compileEzsl("x = uv.q\ncolor = [x, x, x]")).toThrow(CompileError);
  });

  it("compiles a bounded for-loop into a real GLSL for-loop with an int counter", () => {
    const program = compileEzsl(
      "d = 0.0\nfor i in 0..4 {\n  d = d + float(i)\n}\ncolor = [d, d, d]",
    );
    expect(bodyGlsl(program)).toEqual([
      "float d = 0.0;",
      "for (int i = 0; i < 4; i++) {",
      "  d = (d + float(i));",
      "}",
    ]);
  });

  it("compiles if/else into a real GLSL if/else block", () => {
    const program = compileEzsl(
      "d = length(uv)\nb = 0.0\nif d < 0.5 {\n  b = 1.0\n} else {\n  b = 0.0\n}\ncolor = [b, b, b]",
    );
    expect(bodyGlsl(program)).toContain("if ((d < 0.5)) {");
    expect(bodyGlsl(program)).toContain("} else {");
  });

  it("rejects an empty for-loop range at compile time", () => {
    expect(() => compileEzsl("for i in 4..4 {\n  x = 1\n}\ncolor = [0, 0, 0]")).toThrow(CompileError);
  });

  it("re-assigns an already-declared variable without re-declaring its type", () => {
    const program = compileEzsl("d = 1.0\nd = d + 1.0\ncolor = [d, d, d]");
    expect(bodyGlsl(program)).toEqual(["float d = 1.0;", "d = (d + 1.0);"]);
  });

  it("rejects a GLSL reserved keyword used as a local variable name", () => {
    expect(() => compileEzsl("half = 1.0\ncolor = [half, half, half]")).toThrow(CompileError);
    expect(() => compileEzsl("sample = 1.0\ncolor = [sample, sample, sample]")).toThrow(CompileError);
  });

  it("rejects a GLSL reserved keyword used as a for-loop variable name", () => {
    expect(() => compileEzsl("for input in 0..4 {\n  x = 1.0\n}\ncolor = [0, 0, 0]")).toThrow(CompileError);
  });

  it("tags each body line with its originating .ezsl source line", () => {
    const program = compileEzsl("d = length(uv)\ncolor = [d, d, d]");
    expect(program.body).toEqual([{ glsl: "float d = length(uv);", ezslLine: 1 }]);
  });

  it("tags each line of a multi-line if/for construct with its own source line, not a blanket parent line", () => {
    const program = compileEzsl("if 1.0 < 2.0 {\n  x = 1.0\n}\ncolor = [1, 1, 1]");
    // "if (...) {" and the closing "}" are attributed to the if-statement's own line (1);
    // the assignment inside the block is attributed to its own line (2), not the if's.
    expect(program.body[0]).toEqual({ glsl: "if ((1.0 < 2.0)) {", ezslLine: 1 });
    expect(program.body[1]).toEqual({ glsl: "  float x = 1.0;", ezslLine: 2 });
    expect(program.body[2]).toEqual({ glsl: "}", ezslLine: 1 });
  });

  describe("Escape Hatch (glsl { ... })", () => {
    it("injects a glsl block's source verbatim into the body with a source-map comment", () => {
      const program = compileEzsl("glsl {\n  float x = 1.0;\n}\ncolor = [1, 1, 1]");
      expect(bodyGlsl(program).some((l) => l.includes("ezsl:line 1"))).toBe(true);
      expect(bodyGlsl(program).some((l) => l.includes("float x = 1.0;"))).toBe(true);
    });

    it("preserves relative indentation inside a nested glsl block", () => {
      const program = compileEzsl(
        "if 1.0 < 2.0 {\n  glsl {\n    float x = 1.0;\n  }\n}\ncolor = [1, 1, 1]",
      );
      expect(bodyGlsl(program).some((l) => l.trim() === "float x = 1.0;" && l.startsWith("    "))).toBe(true);
    });

    it("rejects a glsl block that redeclares an existing EZSL variable name", () => {
      expect(() =>
        compileEzsl("d = 1.0\nglsl {\n  float d = 2.0;\n}\ncolor = [d, d, d]"),
      ).toThrow(CompileError);
    });

    it("allows a glsl block that does not collide with any EZSL name", () => {
      const program = compileEzsl("glsl {\n  float helper = 2.0;\n}\ncolor = [1, 1, 1]");
      expect(bodyGlsl(program).some((l) => l.includes("float helper = 2.0;"))).toBe(true);
    });

    it("supports #define / #ifdef preprocessor passthrough inside a glsl block", () => {
      const program = compileEzsl("glsl {\n#define FOO 1.0\n}\ncolor = [1, 1, 1]");
      expect(bodyGlsl(program).some((l) => l.includes("#define FOO 1.0"))).toBe(true);
    });
  });

  describe("defineFunction (custom GLSL function injection)", () => {
    it("makes a custom function callable from EZSL source and emits it at file scope", () => {
      const square = defineFunction("square", "float square(float x) {\n  return x * x;\n}", {
        params: ["float"],
        returns: "float",
      });
      const program = compileEzsl("y = square(2.0)\ncolor = [y, y, y]", { customFunctions: [square] });
      expect(program.topLevel).toEqual(["float square(float x) {\n  return x * x;\n}"]);
      expect(bodyGlsl(program)).toContain("float y = square(2.0);");
    });

    it("throws CompileError when a custom function's name collides with a builtin", () => {
      const sinClone = defineFunction("sin", "float sin(float x) { return x; }", { params: ["float"], returns: "float" });
      expect(() => compileEzsl("color = [1, 1, 1]", { customFunctions: [sinClone] })).toThrow(CompileError);
    });

    it("throws CompileError when called with the wrong number of arguments", () => {
      const square = defineFunction("square", "float square(float x) { return x * x; }", {
        params: ["float"],
        returns: "float",
      });
      expect(() =>
        compileEzsl("y = square(1.0, 2.0)\ncolor = [y, y, y]", { customFunctions: [square] }),
      ).toThrow(CompileError);
    });

    it("widens the result type to the function's declared return type", () => {
      const tint = defineFunction("tint", "vec3 tint(float x) { return vec3(x); }", {
        params: ["float"],
        returns: "vec3",
      });
      const program = compileEzsl("color = tint(0.5)", { customFunctions: [tint] });
      expect(program.outColor.glsl).toBe("vec4(tint(0.5), 1.0)");
    });
  });

  describe("mat2/mat3/mat4", () => {
    it("infers mat2/mat3/mat4 from their constructor calls", () => {
      const program = compileEzsl("m = mat3(1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0)\ncolor = [1, 1, 1]");
      expect(bodyGlsl(program)).toContain("mat3 m = mat3(1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0);");
    });

    it("rejects a binary operator between a matrix and something else", () => {
      expect(() => compileEzsl("m = mat2(1.0, 0.0, 0.0, 1.0)\nx = m + 1.0\ncolor = [1, 1, 1]")).not.toThrow();
    });
  });

  describe("user-defined EZSL functions (fn)", () => {
    it("infers a single-expression function's return type and makes it callable", () => {
      const program = compileEzsl("fn square(x) {\n  return x * x\n}\ny = square(2.0)\ncolor = [y, y, y]");
      expect(program.topLevel.some((l) => l.startsWith("float square(float x) {"))).toBe(true);
      expect(bodyGlsl(program)).toContain("float y = square(2.0);");
    });

    it("infers a vector return type from a multi-statement function body", () => {
      const program = compileEzsl(
        "fn palette(t) {\n  base = [t, t, t]\n  return base\n}\ncolor = palette(0.5)",
      );
      expect(program.topLevel.some((l) => l.startsWith("vec3 palette(float t) {"))).toBe(true);
    });

    it("throws CompileError when a function has no return statement", () => {
      expect(() => compileEzsl("fn broken(x) {\n  y = x * 2.0\n}\ncolor = [1, 1, 1]")).toThrow(CompileError);
    });

    it("throws CompileError when a function collides with a builtin name", () => {
      expect(() => compileEzsl("fn sin(x) {\n  return x\n}\ncolor = [1, 1, 1]")).toThrow(CompileError);
    });

    it("throws CompileError when called with the wrong number of arguments", () => {
      expect(() =>
        compileEzsl("fn square(x) {\n  return x * x\n}\ny = square(1.0, 2.0)\ncolor = [y, y, y]"),
      ).toThrow(CompileError);
    });

    it("does not leak a function's local variables into the caller's scope", () => {
      const program = compileEzsl(
        "fn square(x) {\n  helper = x * x\n  return helper\n}\ny = square(2.0)\ncolor = [y, y, y]",
      );
      // 'helper' is local to square() and must not appear as a top-level body declaration.
      expect(bodyGlsl(program).some((l) => l.includes("helper"))).toBe(false);
    });
  });

  describe("fixed-size arrays", () => {
    it("infers an array type from an array[...] literal and supports indexing", () => {
      const program = compileEzsl("xs = array[1.0, 2.0, 3.0]\ny = xs[0]\ncolor = [y, y, y]");
      expect(bodyGlsl(program)).toContain("float[3] xs = float[3](1.0, 2.0, 3.0);");
      expect(bodyGlsl(program)).toContain("float y = xs[0];");
    });

    it("throws CompileError on a mixed-type array literal", () => {
      expect(() => compileEzsl("xs = array[1.0, uv]\ncolor = [1, 1, 1]")).toThrow(CompileError);
    });

    it("throws CompileError when indexing a non-array value", () => {
      expect(() => compileEzsl("x = 1.0\ny = x[0]\ncolor = [1, 1, 1]")).toThrow(CompileError);
    });

    it("throws CompileError on an empty array literal", () => {
      expect(() => compileEzsl("xs = array[]\ncolor = [1, 1, 1]")).toThrow(CompileError);
    });
  });

  describe("structs", () => {
    it("compiles a struct declaration and constructor call, and supports field access", () => {
      const program = compileEzsl(
        "struct Light {\n  position: vec3,\n  intensity: float\n}\nl = Light(uv.xyx, 1.0)\ny = l.intensity\ncolor = [y, y, y]",
      );
      expect(program.topLevel).toContain("struct Light {\n  vec3 position;\n  float intensity;\n};");
      expect(bodyGlsl(program)).toContain("Light l = Light(uv.xyx, 1.0);");
      expect(bodyGlsl(program)).toContain("float y = l.intensity;");
    });

    it("throws CompileError on a struct constructor with the wrong argument count", () => {
      expect(() =>
        compileEzsl("struct Light {\n  position: vec3,\n  intensity: float\n}\nl = Light(uv.xyx)\ncolor = [1, 1, 1]"),
      ).toThrow(CompileError);
    });

    it("throws CompileError when accessing an unknown struct field", () => {
      expect(() =>
        compileEzsl(
          "struct Light {\n  position: vec3,\n  intensity: float\n}\nl = Light(uv.xyx, 1.0)\ny = l.bogus\ncolor = [1, 1, 1]",
        ),
      ).toThrow(CompileError);
    });

    it("throws CompileError on a duplicate struct declaration", () => {
      expect(() =>
        compileEzsl("struct Light {\n  intensity: float\n}\nstruct Light {\n  intensity: float\n}\ncolor = [1, 1, 1]"),
      ).toThrow(CompileError);
    });

    it("throws CompileError when a struct field references an unknown type", () => {
      expect(() => compileEzsl("struct Light {\n  glow: Bogus\n}\ncolor = [1, 1, 1]")).toThrow(CompileError);
    });
  });

  describe('"did you mean?" suggestions (ROADMAP.md v0.4 deliverable)', () => {
    it("suggests the closest builtin function name for a typo'd call", () => {
      expect(() => compileEzsl("x = smoothstp(0.0, 1.0, 0.5)\ncolor=[x,x,x]")).toThrow(
        /unknown function 'smoothstp' — did you mean 'smoothstep'\?/,
      );
    });

    it("suggests the closest user-defined fn name for a typo'd call", () => {
      expect(() =>
        compileEzsl("fn square(x) {\n  return x * x\n}\ny = squar(2.0)\ncolor=[y,y,y]"),
      ).toThrow(/unknown function 'squar' — did you mean 'square'\?/);
    });

    it("suggests the closest custom (defineFunction) name for a typo'd call", () => {
      const square = defineFunction("square", "float square(float x) { return x * x; }", {
        params: ["float"],
        returns: "float",
      });
      expect(() => compileEzsl("y = squaer(2.0)\ncolor=[y,y,y]", { customFunctions: [square] })).toThrow(
        /unknown function 'squaer' — did you mean 'square'\?/,
      );
    });

    it("suggests the closest struct constructor name for a typo'd call", () => {
      expect(() =>
        compileEzsl("struct Light {\n  intensity: float\n}\nl = Ligt(1.0)\ncolor=[1,1,1]"),
      ).toThrow(/unknown function 'Ligt' — did you mean 'Light'\?/);
    });

    it("gives no suggestion (and no dangling hint text) for a call with no close match", () => {
      try {
        compileEzsl("x = totallyUnrelatedFunctionName(1.0)\ncolor=[1,1,1]");
        throw new Error("expected compileEzsl to throw");
      } catch (err) {
        expect((err as Error).message).toContain("unknown function 'totallyUnrelatedFunctionName'");
        expect((err as Error).message).not.toContain("did you mean");
      }
    });

    it("suggests the closest struct field name for a typo'd field access", () => {
      expect(() =>
        compileEzsl(
          "struct Light {\n  position: vec3,\n  intensity: float\n}\nl = Light(uv.xyx, 1.0)\ny = l.intensty\ncolor=[1,1,1]",
        ),
      ).toThrow(/struct 'Light' has no field 'intensty' — did you mean '\.intensity'\?/);
    });

    it("suggests the closest struct field type name for a typo'd field type", () => {
      expect(() => compileEzsl("struct S {\n  v: floot\n}\ncolor=[1,1,1]")).toThrow(
        /has unknown type 'floot' — did you mean 'float'\?/,
      );
    });
  });
});
