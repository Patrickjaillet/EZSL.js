# Multi-pass rendering compared

Some effects (blur, feedback trails, reaction-diffusion) need more than one render pass — the output of one shader becomes the input texture of the next. EZSL's multi-pass model is directly inspired by Shadertoy's — see the [Multi-pass (Shadertoy-style)](../intermediate/multi-pass-shadertoy.md) tutorial for a full worked example, not repeated here.

| | EZSL | Shadertoy | Plain GLSL | WGSL <span class="badge badge-experimental">Experimental</span> |
|---|---|---|---|---|
| Naming passes | Named buffers in `createPipeline({ passes: { BufferA: {...}, Image: {...} } })` | Fixed slots: Buffer A/B/C/D + the final Image pass | No convention — you name and wire your own framebuffers/textures by hand | No runtime exists in EZSL.js for this yet (see below) |
| Sampling another pass | `BufferName.sample(uv)` — a method call the compiler recognizes and turns into a real `texture()` call | `texture(iChannel0, uv)` — you wire which buffer feeds which numbered channel via the Shadertoy UI | `texture(myTextureUniform, uv)` — you declare and bind the sampler yourself | N/A |
| Dependency order | Computed automatically (`compilePasses` does a topological sort) before any WebGL context exists | Implicit in which numbered `iChannel` you reference — Shadertoy resolves it at runtime | Entirely manual — you decide draw order yourself | N/A |
| Feedback (a pass sampling itself) | Automatic ping-pong buffering (`PingPongBuffer`, two render targets swapped each frame) | Supported the same way — a buffer can read its own previous frame | Manual — you manage two textures and swap them yourself | N/A |

## Where WGSL stands today

EZSL.js's WGSL target generates fragment-shader text only — there is no vertex-stage generator and no WebGPU runtime (`GPUDevice`/pipeline/bind-group creation) in this project at all, so there's currently no way to run a multi-pass WGSL pipeline through EZSL.js, experimental or otherwise. This isn't a smaller/harder version of the GLSL story — it's simply not built yet. See `docs/architecture/webgpu-target.md` for the full scope of what the WGSL target does and doesn't cover.
