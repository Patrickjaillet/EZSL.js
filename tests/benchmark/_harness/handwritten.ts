/**
 * Hand-written GLSL fragment shaders, authored independently (idiomatic
 * form a human would actually write, not just the EZSL-generated text with
 * whitespace changed) but functionally identical to the corresponding
 * examples/<name>/shader.ezsl program — the "hand-written GLSL" baseline
 * the v0.7 performance benchmark suite compares EZSL's generated output
 * against. See docs/architecture/performance-benchmarks.md.
 */

export const GRADIENT_HANDWRITTEN = `#version 300 es
precision highp float;

uniform float u_time;
uniform vec2 u_resolution;

out vec4 fragColor;

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  uv.y = 1.0 - uv.y;
  fragColor = vec4(uv.x, uv.y, 0.5 + 0.5 * sin(u_time), 1.0);
}
`;

export const RAYMARCH_HANDWRITTEN = `#version 300 es
precision highp float;

uniform float u_time;
uniform vec2 u_resolution;

out vec4 fragColor;

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  uv.y = 1.0 - uv.y;

  vec3 ro = vec3(0.0, 0.0, -3.0);
  vec2 centered = uv - vec2(0.5, 0.5);
  vec3 rd = normalize(vec3(centered, 1.0));

  vec3 sphereCenter = vec3(sin(u_time), 0.0, 0.0);

  float t = 0.0;
  float hit = 0.0;

  for (int i = 0; i < 64; i++) {
    vec3 p = ro + rd * t;
    float d = length(p - sphereCenter) - 1.0;
    if (d < 0.001) {
      hit = 1.0;
    }
    t += d * 0.5;
  }

  float shade = 1.0 - t * 0.15;
  fragColor = vec4(hit * shade, hit * shade * 0.8, hit * shade, 1.0);
}
`;

/** Fullscreen-quad vertex shader — identical to EZSL's own `generateVertexShader()` output, since both paths render the same geometry. */
export const FULLSCREEN_QUAD_VERTEX = `#version 300 es
in vec2 a_position;

void main() {
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`;
