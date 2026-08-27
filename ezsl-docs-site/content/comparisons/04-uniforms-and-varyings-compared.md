# Uniforms and varyings compared

Every shader needs data from the outside world — the current time, the canvas size, a texture to sample. Each of the four handles this differently.

| | EZSL | GLSL | Shadertoy | WGSL <span class="badge badge-experimental">Experimental</span> |
|---|---|---|---|---|
| Time | `time` — auto-injected builtin, no declaration | `uniform float u_time;` — you declare and bind it yourself | `iTime` — fixed name, supplied by the Shadertoy runtime | `u.time` — a field on a `struct` you declare, bound via `@group`/`@binding` |
| Canvas size | `resolution` — auto-injected builtin | `uniform vec2 u_resolution;` | `iResolution` (`vec3` — includes a pixel aspect ratio component Shadertoy always sets to 1.0) | `u.resolution` field, same struct pattern as time |
| Screen position | `uv` — auto-injected, already normalized *and* Y-flipped to a top-left-origin convention | `gl_FragCoord.xy / u_resolution` — you compute and flip it yourself | `fragCoord / iResolution.xy` — same manual computation, no flip (Shadertoy's convention is already top-left) | `@builtin(position)` — a special function parameter, still needs manual normalization |
| Your own uniforms | Any identifier that isn't a builtin or a local becomes an implicit `float` uniform on first reference — no declaration at all | `uniform float u_myValue;` | Declared exactly like GLSL, then set via Shadertoy's UI | Every uniform must be a field in an explicit `struct`, bound as a whole block — no individual loose uniforms |

## Why WGSL's model is structurally different

GLSL (and by extension Shadertoy) lets you declare uniforms one at a time, each with its own binding slot. WGSL requires every uniform to live inside one `struct`, uploaded as a single buffer — and that struct's memory layout has to follow WGSL's own 16-byte alignment rules (a `vec3` needs padding after it in some cases but not others, depending on what follows it). EZSL.js's experimental WGSL target has a dedicated layout pass (`layoutUniformBuffer`) that computes this automatically — see `docs/architecture/webgpu-target.md` for the real alignment trap it was built to avoid, and the honest caveat that this generator has never been run against a real `GPUDevice`.
