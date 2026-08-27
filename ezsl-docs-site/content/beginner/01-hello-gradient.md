# 1. Hello, gradient

```ezsl
color = [uv.x, uv.y, 0.5 + 0.5 * sin(time)]
```

Every `.ezsl` file is a fragment shader body. `uv`, `time`, and `resolution` are always available without declaring them (see [Builtins](./05-builtins-and-uniforms.md)); the special variable `color` — assigned exactly once, anywhere at the top level of the file — becomes the shader's output pixel color.

Try editing the code block above — it's live. Change `sin(time)` to `cos(time * 2.0)`, or swap `uv.x`/`uv.y`, and watch the preview update as you type.

## What's next

- [Values and types →](./02-values-and-types.md)
