# 3. Variables, operators, and control flow

## Variables and assignment

```ezsl
d = length(uv - [0.5, 0.5])
d = d + 0.1
color = [d, d, d]
```

The **first** assignment to a name establishes its type (from whatever's assigned); every assignment after that **must** be the same type — assigning a different type to an already-used name is a compile error. There's no separate "declare" step; assignment is both.

`//` starts a comment, matching GLSL/C-style comments:

```ezsl
// this is a comment, to end of line
x = 1.0  // comments can trail a statement too
color = [x, x, x]
```

## Operators

`+ - * /` for arithmetic (matrix/vector combinations follow GLSL's own rules — e.g. `vec2 * mat2` is valid, `vec3 + vec2` is not). `< <= > >= ==` for comparisons — usable **only** as an `if`/`for` condition, not as a general boolean value you can store or combine (no `&&`/`||`/`!` yet). Unary `-x` is supported.

## Control flow

```ezsl
d = length(uv - [0.5, 0.5])
edge = 0.0
if d < 0.3 {
  edge = 1.0
} else {
  edge = 0.0
}
color = [edge, edge, edge]
```

```ezsl
total = 0.0
for i in 0..8 {
  total = total + float(i)
}
color = [total / 8.0, total / 8.0, total / 8.0]
```

- `if`'s condition is a single comparison (`a < b`, not `a < b and c < d` — there's no boolean connector syntax).
- `for i in a..b { ... }` — `a` and `b` must be literal integers (not expressions or variables) known at compile time; the loop counter `i` is an `int`, so use `float(i)` to use it in ordinary numeric math.
- Both compile to a real GLSL `if`/`for` — there's no performance or semantic difference from writing them in GLSL directly.

## What's next

- [← Values and types](./02-values-and-types.md)
- [Functions, structs, and arrays →](./04-functions-structs-arrays.md)
