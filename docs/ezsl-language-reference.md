# EZSL Language Reference (v0.4)

A user-facing reference to the EZSL language as implemented through v0.4.x. This is a draft — the "Alpha" phase deliverable named in `ROADMAP.md` — covering syntax and semantics for someone writing `.ezsl` shaders, not the compiler's internals. For implementation details, cross-referenced to source, see the `docs/architecture/` design docs: `transpiler-pipeline.md` (core pipeline, v0.1), `escape-hatch.md` (v0.2), `type-system.md` (v0.3), `error-translation.md` (v0.4), and the authoritative formal grammar in `docs/architecture/ezsl-grammar.ebnf.md`.

**Status**: draft, not yet API-stable. Breaking changes to the language are still expected before v1.0 (see `ROADMAP.md`'s "API Stability" section, targeted for v1.0.x). Nothing described here should be treated as a compatibility guarantee yet.

## Hello, gradient

```
color = [uv.x, uv.y, 0.5 + 0.5 * sin(time)]
```

Every `.ezsl` file is a fragment shader body. `uv`, `time`, and `resolution` are always available without declaring them (see Builtins below); the special variable `color` — assigned exactly once, anywhere at the top level of the file — becomes the shader's output pixel color.

## Values and types

| Type | Meaning | Written as |
|---|---|---|
| `float` | scalar number | `1.0`, `0.5` |
| `vec2`/`vec3`/`vec4` | 2/3/4-component vector | `[x, y]`, `[x, y, z]`, `[x, y, z, w]`, or `vec3(x, y, z)` |
| `mat2`/`mat3`/`mat4` | 2×2/3×3/4×4 matrix | `mat3(...)` (9 values, column-major, same as GLSL) |
| `int` | integer — only ever appears as a `for`-loop counter | (not directly writable as a literal — see `for`) |
| `bool` | true/false — only usable as an `if` condition | produced by a comparison, e.g. `x < 1.0` |
| a fixed-size array | `N` values of the same type | `array[a, b, c]` |
| a struct instance | a named group of fields | `StructName(field1, field2, ...)` after `struct StructName { ... }` |

Every EZSL value has a type inferred at compile time — there's no way to declare a type explicitly for a local variable (only struct fields and, indirectly, `for`-loop bounds involve explicit type-shaped syntax). See `docs/architecture/type-system.md` for the exact inference rules if you're debugging a "why did EZSL think this was type X" question.

**Vector literal vs. array literal**: `[1.0, 2.0, 3.0]` (2–4 elements) is a *vector* (`vec3` here). `array[1.0, 2.0, 3.0]` (any length ≥1) is a fixed-size *array*. These are different types and are not interchangeable — the `array` keyword is what distinguishes them, since a bare bracketed list is always read as a vector.

## Variables and assignment

```
d = length(uv - [0.5, 0.5])
d = d + 0.1        # re-assigns d, doesn't redeclare it
```

The **first** assignment to a name establishes its type (from whatever's assigned); every assignment after that **must** be the same type — assigning a different type to an already-used name is a compile error. There's no separate "declare" step; assignment is both.

`# comment` — sorry, actually EZSL uses `//`, matching GLSL/C-style comments, not `#`:

```
// this is a comment, to end of line
x = 1.0  // comments can trail a statement too
```

## Operators

`+ - * /` for arithmetic (matrix/vector combinations follow GLSL's own rules — e.g. `vec2 * mat2` is valid, `vec3 + vec2` is not). `< <= > >= ==` for comparisons — usable **only** as an `if`/`for` condition, not as a general boolean value you can store or combine (no `&&`/`||`/`!` yet). Unary `-x` is supported (desugars to `0 - x` internally, but reads and behaves like ordinary negation).

## Control flow

```
if d < 0.3 {
  edge = 1.0
} else {
  edge = 0.0
}

for i in 0..8 {
  total = total + float(i)
}
```

- `if`'s condition is a single comparison (`a < b`, not `a < b and c < d` — there's no boolean connector syntax).
- `for i in a..b { ... }` — `a` and `b` must be literal integers (not expressions or variables) known at compile time; the loop counter `i` is an `int`, so use `float(i)` to use it in ordinary numeric math.
- Both compile to a real GLSL `if`/`for` — there's no performance or semantic difference from writing them in GLSL directly.

## Functions

```
fn falloff(d) {
  return 1.0 / (1.0 + d * d)
}

brightness = falloff(distanceToLight)
```

`fn name(params) { ... }`, top-level only (can't be nested inside `if`/`for`, or inside another `fn`). The function's return type is inferred automatically from what it `return`s — you never write it. **Every parameter is treated as `float`** — there's currently no way to declare a `vec3` (or any other type) parameter; if a call site passes something else, the behavior depends on what GLSL itself does with that combination (it may compile with surprising results, or fail at the driver — see `docs/architecture/type-system.md`). A function that doesn't `return` anywhere is a compile error.

A function's own local variables are private to it — nothing it assigns leaks into the code that calls it, and it can't see the caller's locals either (only builtins and uniforms, which are effectively global).

## Structs

```
struct Light {
  position: vec3,
  intensity: float
}

l = Light([0.0, 1.0, 0.0], 0.8)
b = l.intensity
```

`struct Name { field: type, ... }`, top-level only. Field types are written explicitly (`float`, `vec3`, another struct's name, or `type[N]` for a fixed-size array field) — unlike a local variable's type, a struct field's type can't be inferred from anything, so it's always spelled out. Construct an instance by calling the struct's name positionally (`Light(pos, intensity)`, matching field declaration order); access a field with `.fieldName`.

## Arrays

```
weights = array[1.0, 0.6, 0.3]
w0 = weights[0]
```

`array[e1, e2, ...]` — every element must be the same type. Index with `expr[i]`; `i` must be a literal integer or an already-`int`-typed value (like a `for`-loop counter) — not a `float`, even a whole-number one. Arrays are fixed-size, matching GLSL ES (no push/pop/resize).

## Builtins

Always in scope, no need to reference a uniform or declare anything:

- `uv` (`vec2`) — normalized pixel coordinate, `(0,0)` top-left, `(1,1)` bottom-right (Y-flipped from raw GLSL convention on purpose — see `docs/architecture/transpiler-pipeline.md`'s v0.1 trap callout).
- `time` (`float`) — seconds elapsed since the shader started.
- `resolution` (`vec2`) — canvas size in pixels.

Function builtins (GLSL names, same semantics): `sin cos tan atan sqrt length dot abs mix clamp smoothstep fract floor mod max min pow exp normalize cross reflect step`, plus constructor/cast functions `float() vec2() vec3() vec4() mat2() mat3() mat4()`.

Swizzles work as in GLSL: `.x .y .z .w`, `.r .g .b .a`, and any combination/repetition thereof up to 4 letters (`v.xyx`, `v.rgb`, etc.), as long as every letter used is a valid component of the source's type (e.g. only `.x`/`.y` on a `vec2`).

## Uniforms

Any name you use that isn't `uv`/`time`/`resolution` and hasn't been assigned yet is automatically treated as a **uniform** — a value supplied from JavaScript, not computed in the shader:

```
color = [speed, speed, speed]
```

```ts
const handle = mount(canvas, program);
handle.setUniform("speed", 2.0);
```

No separate declaration syntax exists for uniforms — first use *is* the declaration, inferred as `float` by default.

## Escape Hatch: raw GLSL

```
glsl {
  float x = 1.0;
  // any raw GLSL statement(s), including #define / #ifdef
}
```

`glsl { ... }` drops into hand-written GLSL, verbatim — EZSL does not type-check or validate anything inside the braces (only a light collision check against EZSL variable names already in scope). Use this for anything EZSL doesn't have syntax for yet. It can read and write EZSL variables already declared before it (by their plain name — no special syntax needed), and its position matters: statements before it in the file have already run, statements after it haven't yet. See `docs/architecture/escape-hatch.md`.

To inject a reusable custom GLSL *function* (rather than inline logic), use `defineFunction` from JavaScript instead:

```ts
import { defineFunction, compileEzsl } from "@patrickjaillet/ezsl";

const square = defineFunction("square", `float square(float x) { return x * x; }`, {
  params: ["float"],
  returns: "float",
});

const program = compileEzsl(shaderSource, { customFunctions: [square] });
```

Then `square(...)` is callable from `.ezsl` source like any other function.

## Errors

A mistake caught by EZSL itself (before any GLSL is generated) throws a `CompileError`/`ParseError`/`LexError` naming a `.ezsl` line and column directly. A mistake that only the GLSL driver catches (most commonly, something inside a `glsl { ... }` block) is, when you `mount(canvas, program, { ezslSource })`, translated into a plain-English explanation with a `.ezsl`-relative source snippet and a suggested fix — see `docs/architecture/error-translation.md`. The original driver message is always included too, never hidden.

## What isn't in the language (yet)

- Boolean operators (`&&`/`||`/`!`) — an `if`/`for` condition is a single comparison only.
- Function parameter type annotations — every `fn` parameter is `float`.
- Nested/local `fn` or `struct` declarations — both are program-scope only.
- General-purpose loops (`while`, unbounded `for`) — only bounded `for i in a..b` with literal-integer bounds.
- Multi-pass rendering / buffers, vertex-stage EZSL authoring, WebGPU/WGSL output — later roadmap milestones (v0.5+).

## Where this doc will go next

This is a v0.4 draft, deliberately scoped to what's implemented today. It should be extended (not rewritten) as later milestones land — v0.5's multi-pass/buffer model, v0.6's framework integrations, and eventually a formal, versioned `EZSL Language Specification v1.0` per `ROADMAP.md`'s v1.0 "API Stability" section.
