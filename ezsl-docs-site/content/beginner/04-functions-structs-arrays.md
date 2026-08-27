# 4. Functions, structs, and arrays

## Functions

```ezsl
fn falloff(d) {
  return 1.0 / (1.0 + d * d)
}

d = length(uv - [0.5, 0.5])
brightness = falloff(d)
color = [brightness, brightness, brightness]
```

`fn name(params) { ... }`, top-level only (can't be nested inside `if`/`for`, or inside another `fn`). The function's return type is inferred automatically from what it `return`s — you never write it. **Every parameter is treated as `float`** — there's currently no way to declare a `vec3` (or any other type) parameter.

A function's own local variables are private to it — nothing it assigns leaks into the code that calls it, and it can't see the caller's locals either (only builtins and uniforms, which are effectively global).

## Structs

```ezsl
struct Light {
  position: vec3,
  intensity: float
}

l = Light([0.0, 1.0, 0.0], 0.8)
b = l.intensity
color = [b, b, b]
```

`struct Name { field: type, ... }`, top-level only. Field types are written explicitly — unlike a local variable's type, a struct field's type can't be inferred from anything, so it's always spelled out. Construct an instance by calling the struct's name positionally (`Light(pos, intensity)`, matching field declaration order); access a field with `.fieldName`.

## Arrays

```ezsl
weights = array[1.0, 0.6, 0.3]
w0 = weights[0]
color = [w0, w0, w0]
```

`array[e1, e2, ...]` — every element must be the same type. Index with `expr[i]`; `i` must be a literal integer or an already-`int`-typed value (like a `for`-loop counter) — not a `float`, even a whole-number one. Arrays are fixed-size, matching GLSL ES (no push/pop/resize).

## What's next

- [← Variables and control flow](./03-variables-and-control-flow.md)
- [Builtins and uniforms →](./05-builtins-and-uniforms.md)
