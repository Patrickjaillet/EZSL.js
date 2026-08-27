# Syntax side-by-side

The same animated gradient, written four ways. Click a tab to switch between them.

<div class="tabs" id="syntax-tabs">
  <div class="tabs-nav">
    <button class="active" data-tab="ezsl">EZSL</button>
    <button data-tab="glsl">GLSL ES 3.00</button>
    <button data-tab="shadertoy">Shadertoy</button>
    <button data-tab="wgsl">WGSL <span class="badge badge-experimental">Experimental</span></button>
  </div>
  <div class="tabs-panel active" data-tab="ezsl">

```ezsl
color = [uv.x, uv.y, 0.5 + 0.5 * sin(time)]
```

  </div>
  <div class="tabs-panel" data-tab="glsl">

```glsl
#version 300 es
precision highp float;

uniform float u_time;
uniform vec2 u_resolution;
out vec4 fragColor;

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  uv.y = 1.0 - uv.y;
  fragColor = vec4(uv.x, uv.y, 0.5 + 0.5 * sin(u_time), 1.0);
}
```

  </div>
  <div class="tabs-panel" data-tab="shadertoy">

```glsl
void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 uv = fragCoord / iResolution.xy;
  fragColor = vec4(uv.x, uv.y, 0.5 + 0.5 * sin(iTime), 1.0);
}
```

  </div>
  <div class="tabs-panel" data-tab="wgsl">

```wgsl
struct Uniforms {
  time: f32,
  resolution: vec2<f32>,
}
@group(0) @binding(0) var<uniform> u: Uniforms;

@fragment
fn main(@builtin(position) pos: vec4<f32>) -> @location(0) vec4<f32> {
  let uv = pos.xy / u.resolution;
  return vec4<f32>(uv.x, uv.y, 0.5 + 0.5 * sin(u.time), 1.0);
}
```

  </div>
</div>

## What to notice

- **EZSL** never declares `uv`, `time`, or the output variable — they're auto-injected builtins (see [Builtins and uniforms](../beginner/05-builtins-and-uniforms.md)). One line does what four blocks of GLSL do.
- **GLSL** requires the full boilerplate: `#version`, `precision`, explicit `uniform` declarations, an explicit `out vec4`, and a manual Y-flip to match a top-left-origin UV convention (GLSL's `gl_FragCoord` is bottom-left-origin — EZSL handles this flip for you automatically).
- **Shadertoy** is the same underlying GLSL, but the site supplies the `#version`/precision/uniform boilerplate for you — you only write the `mainImage` function body, using Shadertoy's own fixed uniform names (`iTime`, `iResolution`, ...).
- **WGSL** requires explicit types on every value (`f32`, `vec2<f32>`) and routes all uniform data through an explicit `struct` bound via `@group`/`@binding` — see [Uniforms and varyings compared](./04-uniforms-and-varyings-compared.md) for why.
