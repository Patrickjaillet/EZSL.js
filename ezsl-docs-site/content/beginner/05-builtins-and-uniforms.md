# 5. Builtins and uniforms

## Builtins

Always in scope, no need to reference a uniform or declare anything:

- `uv` (`vec2`) — normalized pixel coordinate, `(0,0)` top-left, `(1,1)` bottom-right (Y-flipped from raw GLSL convention on purpose).
- `time` (`float`) — seconds elapsed since the shader started.
- `resolution` (`vec2`) — canvas size in pixels.

Function builtins (GLSL names, same semantics): `sin cos tan atan sqrt length dot abs mix clamp smoothstep fract floor mod max min pow exp normalize cross reflect step`, plus constructor/cast functions `float() vec2() vec3() vec4() mat2() mat3() mat4()`.

Swizzles work as in GLSL: `.x .y .z .w`, `.r .g .b .a`, and any combination/repetition thereof up to 4 letters (`v.xyx`, `v.rgb`, etc.), as long as every letter used is a valid component of the source's type.

```ezsl
p = uv - [0.5, 0.5]
d = length(p)
ring = smoothstep(0.02, 0.0, abs(d - 0.3))
color = [ring, ring, ring]
```

## Uniforms

Any name you use that isn't `uv`/`time`/`resolution` and hasn't been assigned yet is automatically treated as a **uniform** — a value supplied from JavaScript, not computed in the shader:

```ezsl
color = [speed, speed, speed]
```

```ts
const handle = mount(canvas, program);
handle.setUniform("speed", 2.0);
```

No separate declaration syntax exists for uniforms — first use *is* the declaration, inferred as `float` by default.

## Errors

A mistake caught by EZSL itself (before any GLSL is generated) throws a `CompileError`/`ParseError`/`LexError` naming a `.ezsl` line and column directly. A mistake that only the GLSL driver catches is, when you `mount(canvas, program, { ezslSource })`, translated into a plain-English explanation with a `.ezsl`-relative source snippet.

## What's next

You've now covered the beginner track. From here:

- **[Intermediate: Three.js integration →](../intermediate/three-js-scene.md)** — use EZSL to author both the vertex and fragment shaders of a real Three.js material.
- **[Intermediate: Shadertoy-style multi-pass →](../intermediate/multi-pass-shadertoy.md)** — feedback buffers and multi-pass rendering.
- **[Intermediate: Canvas2D compositing →](../intermediate/canvas2d-compositing.md)** — layer a shader with ordinary 2D drawing.
- **[Advanced: the Escape Hatch →](../advanced/escape-hatch.md)** — drop into raw GLSL when EZSL doesn't have the syntax you need yet.
