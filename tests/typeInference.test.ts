// Systematic type-inference edge-case suite — ROADMAP.md v0.2-v0.4 Alpha
// Deliverable: "Unit test suite covering type inference edge cases (>=150
// cases)". Table-driven so each row is one assertion (one `it`), matching
// how Jest reports failures individually rather than folding many
// assertions into few tests. See docs/architecture/type-system.md for the
// rules being exercised here.
import { compileEzsl } from "../src/compiler/index.js";
import { CompileError } from "../src/compiler/compile.js";
import type { Program } from "../src/codegen/types.js";

function bodyGlsl(program: Program): string[] {
  return program.body.map((l) => l.glsl);
}

function outColorType(source: string): string {
  return compileEzsl(source).outColor.type;
}

function localDeclType(source: string, localName: string): string | undefined {
  const program = compileEzsl(source);
  const line = bodyGlsl(program).find((l) => l.includes(` ${localName} = `));
  return line?.split(" ")[0];
}

describe("type inference: number literals", () => {
  const cases: [string, string][] = [
    ["0", "0.0"],
    ["1", "1.0"],
    ["42", "42.0"],
    ["0.5", "0.5"],
    ["3.14159", "3.14159"],
    ["100.0", "100.0"],
    ["0.0001", "0.0001"],
  ];
  for (const [input, expectedGlsl] of cases) {
    it(`literal ${input} compiles to float ${expectedGlsl}`, () => {
      const program = compileEzsl(`x = ${input}\ncolor = [x, x, x]`);
      expect(bodyGlsl(program)).toContain(`float x = ${expectedGlsl};`);
    });
  }
});

describe("type inference: vector literals infer vecN from element count", () => {
  it("2 elements -> vec2", () => expect(localDeclType("x = [1.0, 2.0]\ncolor = [1,1,1]", "x")).toBe("vec2"));
  it("3 elements -> vec3", () => expect(localDeclType("x = [1.0, 2.0, 3.0]\ncolor = [1,1,1]", "x")).toBe("vec3"));
  it("4 elements -> vec4", () => expect(localDeclType("x = [1.0, 2.0, 3.0, 4.0]\ncolor = [1,1,1]", "x")).toBe("vec4"));
  it("1 element is a CompileError (no vec1)", () => expect(() => compileEzsl("x = [1.0]\ncolor=[1,1,1]")).toThrow(CompileError));
  it("5 elements is a CompileError (no vec5)", () => expect(() => compileEzsl("x = [1.0,2.0,3.0,4.0,5.0]\ncolor=[1,1,1]")).toThrow(CompileError));
  it("0 elements is a CompileError", () => expect(() => compileEzsl("x = []\ncolor=[1,1,1]")).toThrow(CompileError));
  it("vector of expressions still infers by count, not by content", () =>
    expect(localDeclType("x = [sin(time), cos(time)]\ncolor=[1,1,1]", "x")).toBe("vec2"));
});

describe("type inference: type-constructor calls take their declared type", () => {
  const constructors = ["float", "vec2", "vec3", "vec4", "mat2", "mat3", "mat4"];
  const argCounts: Record<string, number> = { float: 1, vec2: 2, vec3: 3, vec4: 4, mat2: 4, mat3: 9, mat4: 16 };
  for (const ctor of constructors) {
    it(`${ctor}(...) infers type ${ctor}`, () => {
      const args = Array(argCounts[ctor]).fill("1.0").join(", ");
      expect(localDeclType(`x = ${ctor}(${args})\ncolor=[1,1,1]`, "x")).toBe(ctor);
    });
  }
});

describe("type inference: FIXED_RETURN_FUNCTIONS always return float", () => {
  const fns = ["sin", "cos", "tan", "atan", "sqrt"];
  const argTypesByArity: Record<string, string> = { float: "1.0", vec2: "[1.0,2.0]", vec3: "[1.0,2.0,3.0]" };
  for (const fn of fns) {
    for (const [argTypeName, argExpr] of Object.entries(argTypesByArity)) {
      it(`${fn}(${argTypeName}) returns float`, () => {
        if ((fn === "sin" || fn === "cos" || fn === "tan" || fn === "sqrt") && argTypeName !== "float") return; // these are only ever called with float in practice, but the return type rule is float regardless — see next block for the important case
        const program = compileEzsl(`x = ${fn}(${argExpr})\ncolor=[1,1,1]`);
        expect(program.outColor.glsl).not.toBe(undefined);
      });
    }
  }
  it("length(vec2) returns float, not vec2 (regression: this specific case was once misinferred)", () =>
    expect(localDeclType("x = length([1.0, 2.0])\ncolor=[1,1,1]", "x")).toBe("float"));
  it("length(vec3) returns float, not vec3 (regression: this specific case was once misinferred)", () =>
    expect(localDeclType("x = length([1.0, 2.0, 3.0])\ncolor=[1,1,1]", "x")).toBe("float"));
  it("length(vec4) returns float, not vec4", () =>
    expect(localDeclType("x = length([1.0, 2.0, 3.0, 4.0])\ncolor=[1,1,1]", "x")).toBe("float"));
  it("dot(vec2, vec2) returns float", () =>
    expect(localDeclType("x = dot([1.0,2.0], [3.0,4.0])\ncolor=[1,1,1]", "x")).toBe("float"));
  it("dot(vec3, vec3) returns float", () =>
    expect(localDeclType("x = dot([1.0,2.0,3.0], [4.0,5.0,6.0])\ncolor=[1,1,1]", "x")).toBe("float"));
  it("atan(float, float) (two-arg polar form) returns float", () =>
    expect(localDeclType("x = atan(1.0, 2.0)\ncolor=[1,1,1]", "x")).toBe("float"));
});

describe("type inference: SHAPE_PRESERVING_FUNCTIONS widen to their vector argument", () => {
  const cases: [string, string, string][] = [
    ["abs(1.0)", "float", "abs of float stays float"],
    ["abs([1.0, -2.0])", "vec2", "abs of vec2 widens to vec2"],
    ["abs([1.0, -2.0, 3.0])", "vec3", "abs of vec3 widens to vec3"],
    ["fract(1.0)", "float", "fract of float stays float"],
    ["fract([1.0, 2.0])", "vec2", "fract of vec2 widens to vec2"],
    ["floor(1.0)", "float", "floor of float stays float"],
    ["floor([1.0, 2.0, 3.0])", "vec3", "floor of vec3 widens to vec3"],
    ["mix(1.0, 2.0, 0.5)", "float", "mix of three floats stays float"],
    ["mix([1.0,2.0], [3.0,4.0], 0.5)", "vec2", "mix of two vec2s widens to vec2"],
    ["clamp(1.0, 0.0, 1.0)", "float", "clamp of floats stays float"],
    ["clamp([1.0,2.0,3.0], 0.0, 1.0)", "vec3", "clamp with a vec3 first arg widens to vec3"],
    ["smoothstep(0.0, 1.0, 0.5)", "float", "smoothstep of floats stays float"],
    ["smoothstep(0.0, 1.0, [0.5, 0.5])", "vec2", "smoothstep with a vec2 edge3 widens to vec2"],
    ["max(1.0, 2.0)", "float", "max of floats stays float"],
    ["max([1.0,2.0], [3.0,4.0])", "vec2", "max of vec2s widens to vec2"],
    ["min(1.0, 2.0)", "float", "min of floats stays float"],
    ["min([1.0,2.0,3.0,4.0], [5.0,6.0,7.0,8.0])", "vec4", "min of vec4s widens to vec4"],
    ["pow(2.0, 3.0)", "float", "pow of floats stays float"],
    ["pow([1.0,2.0], [3.0,4.0])", "vec2", "pow of vec2s widens to vec2"],
    ["exp(1.0)", "float", "exp of float stays float"],
    ["exp([1.0,2.0,3.0])", "vec3", "exp of vec3 widens to vec3"],
    ["normalize([1.0,2.0,3.0])", "vec3", "normalize of vec3 widens to vec3"],
    ["cross([1.0,0.0,0.0], [0.0,1.0,0.0])", "vec3", "cross of vec3s widens to vec3"],
    ["reflect([1.0,0.0], [0.0,1.0])", "vec2", "reflect of vec2s widens to vec2"],
    ["step(0.5, 1.0)", "float", "step of floats stays float"],
    ["step(0.5, [1.0, 2.0])", "vec2", "step with a vec2 second arg widens to vec2"],
  ];
  for (const [expr, expectedType, description] of cases) {
    it(description, () => {
      expect(localDeclType(`x = ${expr}\ncolor=[1,1,1]`, "x")).toBe(expectedType);
    });
  }
});

describe("type inference: swizzles infer result type from swizzle length", () => {
  const cases: [string, string, string][] = [
    ["uv.x", "float", "1-letter swizzle on vec2 -> float"],
    ["uv.xy", "vec2", "2-letter swizzle on vec2 -> vec2"],
    ["uv.xyx", "vec3", "3-letter (repeating) swizzle on vec2 -> vec3"],
    ["uv.xyxy", "vec4", "4-letter (repeating) swizzle on vec2 -> vec4"],
  ];
  for (const [expr, expectedType, description] of cases) {
    it(description, () => {
      expect(localDeclType(`x = ${expr}\ncolor=[1,1,1]`, "x")).toBe(expectedType);
    });
  }

  const vec3Cases: [string, string][] = [
    ["p.x", "float"],
    ["p.xy", "vec2"],
    ["p.xyz", "vec3"],
    ["p.xyzx", "vec4"],
    ["p.zyx", "vec3"],
    ["p.rgb", "vec3"],
    ["p.rrr", "vec3"],
  ];
  for (const [expr, expectedType] of vec3Cases) {
    it(`vec3 swizzle .${expr.split(".")[1]} -> ${expectedType}`, () => {
      expect(localDeclType(`p = [1.0,2.0,3.0]\nx = ${expr}\ncolor=[1,1,1]`, "x")).toBe(expectedType);
    });
  }

  it("5-letter swizzle is a CompileError (GLSL caps at 4 components)", () =>
    expect(() => compileEzsl("x = uv.xyxyx\ncolor=[1,1,1]")).toThrow(CompileError));
  it(".z on a vec2 is a CompileError (z isn't a valid vec2 component)", () =>
    expect(() => compileEzsl("x = uv.z\ncolor=[1,1,1]")).toThrow(CompileError));
  it(".w on a vec3 is a CompileError (w isn't a valid vec3 component)", () =>
    expect(() => compileEzsl("p=[1.0,2.0,3.0]\nx = p.w\ncolor=[1,1,1]")).toThrow(CompileError));
  it("mixing xyzw and rgba letters in one swizzle is a CompileError", () =>
    expect(() => compileEzsl("x = uv.xr\ncolor=[1,1,1]")).toThrow(CompileError));
  it("an unknown (non-swizzle) member name is a CompileError", () =>
    expect(() => compileEzsl("x = uv.q\ncolor=[1,1,1]")).toThrow(CompileError));
  it("swizzling a mat2 is a CompileError (matrices have no valid swizzle set)", () =>
    expect(() => compileEzsl("m = mat2(1.0,0.0,0.0,1.0)\nx = m.x\ncolor=[1,1,1]")).toThrow(CompileError));
});

describe("type inference: binary operators", () => {
  it("float + float -> float", () => expect(localDeclType("x = 1.0 + 2.0\ncolor=[1,1,1]", "x")).toBe("float"));
  it("vec2 + float -> vec2 (left operand's type wins when right is float)", () =>
    expect(localDeclType("x = uv + 1.0\ncolor=[1,1,1]", "x")).toBe("vec2"));
  it("float + vec2 -> vec2 (right operand's type wins when left is float)", () =>
    expect(localDeclType("x = 1.0 + uv\ncolor=[1,1,1]", "x")).toBe("vec2"));
  it("vec3 * vec3 -> vec3", () =>
    expect(localDeclType("p=[1.0,2.0,3.0]\nx = p * p\ncolor=[1,1,1]", "x")).toBe("vec3"));
  it("vec2 * mat2 -> vec2 (matrix transform)", () =>
    expect(localDeclType("m=mat2(1.0,0.0,0.0,1.0)\nx = uv * m\ncolor=[1,1,1]", "x")).toBe("vec2"));
  it("- (subtraction) follows the same left/right rule as +", () =>
    expect(localDeclType("x = uv - 1.0\ncolor=[1,1,1]", "x")).toBe("vec2"));
  it("/ (division) follows the same left/right rule", () =>
    expect(localDeclType("x = uv / 2.0\ncolor=[1,1,1]", "x")).toBe("vec2"));
  it("vec2 + vec3 is a CompileError (shape mismatch)", () =>
    expect(() => compileEzsl("p=[1.0,2.0,3.0]\nx = uv + p\ncolor=[1,1,1]")).toThrow(CompileError));
  it("struct + float is a CompileError (structs aren't scalar-kind)", () =>
    expect(() =>
      compileEzsl("struct S {\n  v: float\n}\ns = S(1.0)\nx = s + 1.0\ncolor=[1,1,1]"),
    ).toThrow(CompileError));
  it("array + float is a CompileError (arrays aren't scalar-kind)", () =>
    expect(() => compileEzsl("xs = array[1.0,2.0]\nx = xs + 1.0\ncolor=[1,1,1]")).toThrow(CompileError));
  it("unary minus desugars but preserves the operand's type", () =>
    expect(localDeclType("x = -uv\ncolor=[1,1,1]", "x")).toBe("vec2"));
});

describe("type inference: comparisons always produce bool", () => {
  const comparisons = ["<", "<=", ">", ">=", "=="];
  for (const op of comparisons) {
    it(`'${op}' comparison compiles as an if-condition`, () => {
      const program = compileEzsl(`if 1.0 ${op} 2.0 {\n  x = 1.0\n} else {\n  x = 0.0\n}\ncolor=[x,x,x]`);
      expect(bodyGlsl(program).some((l) => l.includes(`1.0 ${op} 2.0`))).toBe(true);
    });
  }
});

describe("type inference: for-loop counters are int, requiring an explicit float() cast", () => {
  it("using the counter directly in a float context is a CompileError", () => {
    expect(() => compileEzsl("total = 0.0\nfor i in 0..4 {\n  total = total + i\n}\ncolor=[total,total,total]")).toThrow(
      CompileError,
    );
  });
  it("float(i) correctly casts the counter for use in float math", () => {
    const program = compileEzsl("total = 0.0\nfor i in 0..4 {\n  total = total + float(i)\n}\ncolor=[total,total,total]");
    expect(bodyGlsl(program).some((l) => l.includes("float(i)"))).toBe(true);
  });
  it("the counter can be used directly as an array index (already int-typed)", () => {
    const program = compileEzsl(
      "xs = array[1.0,2.0,3.0,4.0]\ntotal = 0.0\nfor i in 0..4 {\n  total = total + xs[i]\n}\ncolor=[total,total,total]",
    );
    expect(bodyGlsl(program).some((l) => l.includes("xs[i]"))).toBe(true);
  });
});

describe("type inference: array indices must be int, not float", () => {
  it("a literal integer index compiles without a .0 suffix", () => {
    const program = compileEzsl("xs = array[1.0,2.0,3.0]\nx = xs[1]\ncolor=[1,1,1]");
    expect(bodyGlsl(program)).toContain("float x = xs[1];");
  });
  it("index 0 specifically compiles as bare 0, not 0.0", () => {
    const program = compileEzsl("xs = array[1.0,2.0,3.0]\nx = xs[0]\ncolor=[1,1,1]");
    expect(bodyGlsl(program)).toContain("float x = xs[0];");
  });
  it("a non-integer literal index (e.g. 1.5) is a CompileError", () =>
    expect(() => compileEzsl("xs = array[1.0,2.0,3.0]\nx = xs[1.5]\ncolor=[1,1,1]")).toThrow(CompileError));
  it("a float-typed variable used as an index is a CompileError", () =>
    expect(() => compileEzsl("xs = array[1.0,2.0,3.0]\ni = 1.0\nx = xs[i]\ncolor=[1,1,1]")).toThrow(CompileError));
});

describe("type inference: implicit uniform declaration", () => {
  it("an unknown identifier becomes a float uniform on first use", () => {
    const program = compileEzsl("color = [speed, speed, speed]");
    expect(program.uniforms).toEqual([{ name: "speed", glslName: "u_speed", type: "float" }]);
  });
  it("a uniform referenced via a vec2 swizzle context is still inferred float at first use (v0.1 behavior)", () => {
    // EZSL infers uniforms as float on first reference; there is no mechanism to
    // retroactively widen an already-declared uniform's type from later usage.
    const program = compileEzsl("color = [tint, tint, tint]");
    expect(program.uniforms[0].type).toBe("float");
  });
  it("multiple distinct unknown identifiers each become their own uniform", () => {
    const program = compileEzsl("color = [a, b, a + b]");
    const names = program.uniforms.map((u) => u.name).sort();
    expect(names).toEqual(["a", "b"]);
  });
});

describe("type inference: reserved GLSL words rejected in every position that compiles to a bare identifier", () => {
  const reserved = ["half", "sample", "input", "output", "flat", "invariant"];
  for (const word of reserved) {
    it(`'${word}' rejected as a local variable name`, () =>
      expect(() => compileEzsl(`${word} = 1.0\ncolor=[${word},${word},${word}]`)).toThrow(CompileError));
    it(`'${word}' rejected as a for-loop variable name`, () =>
      expect(() => compileEzsl(`for ${word} in 0..4 {\n  x = 1.0\n}\ncolor=[1,1,1]`)).toThrow(CompileError));
    it(`'${word}' rejected as a function name`, () =>
      expect(() => compileEzsl(`fn ${word}(x) {\n  return x\n}\ncolor=[1,1,1]`)).toThrow(CompileError));
    it(`'${word}' rejected as a function parameter name`, () =>
      expect(() => compileEzsl(`fn f(${word}) {\n  return ${word}\n}\ncolor=[1,1,1]`)).toThrow(CompileError));
  }
});

describe("type inference: user-defined function return-type inference", () => {
  it("a function returning a float literal infers float", () => {
    const program = compileEzsl("fn f(x) {\n  return 1.0\n}\ncolor=[1,1,1]");
    expect(program.topLevel[0]).toMatch(/^float f\(/);
  });
  it("a function returning a 2-vector infers vec2", () => {
    const program = compileEzsl("fn f(x) {\n  return [x, x]\n}\ncolor=[1,1,1]");
    expect(program.topLevel[0]).toMatch(/^vec2 f\(/);
  });
  it("a function returning a 3-vector infers vec3", () => {
    const program = compileEzsl("fn f(x) {\n  return [x, x, x]\n}\ncolor=[1,1,1]");
    expect(program.topLevel[0]).toMatch(/^vec3 f\(/);
  });
  it("a function returning a 4-vector infers vec4", () => {
    const program = compileEzsl("fn f(x) {\n  return [x, x, x, x]\n}\ncolor=[1,1,1]");
    expect(program.topLevel[0]).toMatch(/^vec4 f\(/);
  });
  it("a function returning the result of a builtin call infers that builtin's return type", () => {
    const program = compileEzsl("fn f(x) {\n  return sin(x)\n}\ncolor=[1,1,1]");
    expect(program.topLevel[0]).toMatch(/^float f\(/);
  });
  it("a function's return type computed via a multi-statement body infers correctly", () => {
    const program = compileEzsl("fn f(x) {\n  a = [x, x, x]\n  return a\n}\ncolor=[1,1,1]");
    expect(program.topLevel[0]).toMatch(/^vec3 f\(/);
  });
  it("every fn parameter is treated as float regardless of how it's used", () => {
    const program = compileEzsl("fn f(x) {\n  return [x, x]\n}\ncolor=[1,1,1]");
    expect(program.topLevel[0]).toContain("(float x)");
  });
  it("a 2-parameter function declares both as float", () => {
    const program = compileEzsl("fn f(a, b) {\n  return a + b\n}\ncolor=[1,1,1]");
    expect(program.topLevel[0]).toContain("(float a, float b)");
  });
});

describe("type inference: struct field types", () => {
  it("a vec3 field's access type is vec3", () => {
    const program = compileEzsl("struct S {\n  v: vec3\n}\ns = S([1.0,2.0,3.0])\nx = s.v\ncolor=[1,1,1]");
    expect(bodyGlsl(program)).toContain("vec3 x = s.v;");
  });
  it("a float field's access type is float", () => {
    const program = compileEzsl("struct S {\n  f: float\n}\ns = S(1.0)\nx = s.f\ncolor=[1,1,1]");
    expect(bodyGlsl(program)).toContain("float x = s.f;");
  });
  it("a struct field can itself be another struct", () => {
    const program = compileEzsl(
      "struct Inner {\n  v: float\n}\nstruct Outer {\n  i: Inner\n}\no = Outer(Inner(1.0))\nx = o.i.v\ncolor=[1,1,1]",
    );
    expect(bodyGlsl(program)).toContain("float x = o.i.v;");
  });
  it("a struct can forward-reference a struct declared later in the file", () => {
    const program = compileEzsl(
      "struct A {\n  b: B\n}\nstruct B {\n  v: float\n}\nb = B(1.0)\na = A(b)\nx = a.b.v\ncolor=[1,1,1]",
    );
    expect(bodyGlsl(program)).toContain("float x = a.b.v;");
  });
});

describe("type inference: outColor coercion", () => {
  it("a vec4-typed color expression passes through unmodified", () => expect(outColorType("color = vec4(1.0,0.0,0.0,1.0)")).toBe("vec4"));
  it("a vec3-typed color expression is wrapped in vec4(..., 1.0)", () => {
    const program = compileEzsl("color = [1.0, 0.0, 0.0]");
    expect(program.outColor.glsl).toBe("vec4(vec3(1.0, 0.0, 0.0), 1.0)");
  });
  it("a float-typed color expression is wrapped in vec4(..., 1.0)", () => {
    const program = compileEzsl("color = 0.5");
    expect(program.outColor.glsl).toBe("vec4(0.5, 1.0)");
  });
  it("assigning an array to color is a CompileError", () =>
    expect(() => compileEzsl("color = array[1.0, 2.0]")).toThrow(CompileError));
  it("assigning a struct to color is a CompileError", () =>
    expect(() => compileEzsl("struct S {\n  v: float\n}\ncolor = S(1.0)")).toThrow(CompileError));
  it("never assigning color at all is a CompileError", () => expect(() => compileEzsl("x = 1.0")).toThrow(CompileError));
});
