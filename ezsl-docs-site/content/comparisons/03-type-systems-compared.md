# Type systems compared

| | EZSL | GLSL | Shadertoy | WGSL <span class="badge badge-experimental">Experimental</span> |
|---|---|---|---|---|
| Declaration | `d = length(uv)` — first assignment declares and infers the type | `float d = length(uv);` — explicit type required | Same as GLSL | `let d: f32 = length(uv);` — type can be inferred, but the syntax is still explicit (`let`/`var`) |
| Reassignment | `d = d + 1.0` — same name, no re-declaration | `d = d + 1.0;` — no re-declaration either, same as EZSL | Same as GLSL | `d = d + 1.0;` — `let` bindings are immutable; a reassignable value needs `var` instead |
| Vectors | `[x, y, z]` infers `vec3` from literal shape | `vec3(x, y, z)` — explicit constructor always required | Same as GLSL | `vec3<f32>(x, y, z)` — explicit constructor, explicit element type |
| Implicit conversions | A `for`-loop counter is `int`; using it as `float` needs an explicit `float(i)` cast (see [Variables and control flow](../beginner/03-variables-and-control-flow.md)) | Same `int`→`float` cast requirement | Same as GLSL | Stricter still — WGSL has essentially no implicit numeric conversions anywhere, not just loop counters |
| Function parameters | Always inferred `float` — there's currently no parameter type annotation syntax in EZSL | Explicit, e.g. `float falloff(float d)` | Same as GLSL | Explicit, e.g. `fn falloff(d: f32) -> f32` |

## The practical difference

EZSL's inference exists specifically to remove the "declare the type before you can use the value" step for beginners — you write `d = length(uv)` and move on. GLSL (and Shadertoy, which is just GLSL) requires you to know and write `float` up front. WGSL sits at the strict end: even where it *can* infer a type, its syntax still requires you to say `let` or `var`, and it has essentially no implicit conversions at all, which catches more bugs at compile time at the cost of more typing.
