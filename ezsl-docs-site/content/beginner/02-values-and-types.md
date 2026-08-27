# 2. Values and types

| Type | Meaning | Written as |
|---|---|---|
| `float` | scalar number | `1.0`, `0.5` |
| `vec2`/`vec3`/`vec4` | 2/3/4-component vector | `[x, y]`, `[x, y, z]`, `[x, y, z, w]`, or `vec3(x, y, z)` |
| `mat2`/`mat3`/`mat4` | 2×2/3×3/4×4 matrix | `mat3(...)` (9 values, column-major, same as GLSL) |
| `int` | integer — only ever appears as a `for`-loop counter | (not directly writable as a literal — see `for`) |
| `bool` | true/false — only usable as an `if` condition | produced by a comparison, e.g. `x < 1.0` |
| a fixed-size array | `N` values of the same type | `array[a, b, c]` |
| a struct instance | a named group of fields | `StructName(field1, field2, ...)` after `struct StructName { ... }` |

Every EZSL value has a type inferred at compile time — there's no way to declare a type explicitly for a local variable (only struct fields, and indirectly `for`-loop bounds, involve explicit type-shaped syntax).

**Vector literal vs. array literal**: `[1.0, 2.0, 3.0]` (2–4 elements) is a *vector* (`vec3` here). `array[1.0, 2.0, 3.0]` (any length ≥1) is a fixed-size *array*. These are different types and are not interchangeable — the `array` keyword is what distinguishes them, since a bare bracketed list is always read as a vector.

Try it:

```ezsl
a = [1.0, 0.5, 0.2]
color = a
```

## What's next

- [← Hello, gradient](./01-hello-gradient.md)
- [Variables and control flow →](./03-variables-and-control-flow.md)
