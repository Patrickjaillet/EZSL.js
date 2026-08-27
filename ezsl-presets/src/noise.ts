import { defineFunction } from "@patrickjaillet/ezsl";
import type { CustomFunction } from "@patrickjaillet/ezsl";

/**
 * A single-octave hash-based value noise, `vec2 -> float` in `[0, 1)` —
 * the same hash/fract pattern `examples/fbm-clouds/shader.ezsl` uses
 * inline (a real, validated EZSL example, not an invented formula):
 * `fract(sin(dot(p, [12.9898, 78.233])) * 43758.5453)`. Cheap (one `sin`,
 * one `dot`), but has visible axis-aligned banding at low frequencies —
 * `fbm2D` (below) is the practical choice for anything meant to look
 * organic; use `hash2D` directly only when you specifically want a raw,
 * uncorrelated per-pixel value (dithering, a stipple pattern, etc.).
 */
export const hash2D: CustomFunction = defineFunction(
  "hash2D",
  `float hash2D(vec2 p) {
  return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}`,
  { params: ["vec2"], returns: "float" },
);

/**
 * 4-octave fractal Brownian motion built on `hash2D` — the same
 * accumulation loop `examples/fbm-clouds/shader.ezsl` runs inline
 * (`for i in 0..4`, halving amplitude and doubling frequency each
 * octave), factored into a reusable GLSL function instead. Takes the
 * sample point directly (already scaled/offset by the caller, matching
 * how the validated example computes `p = uv * 3.0` before the loop) —
 * `fbm2D` doesn't impose a scale or offset convention of its own.
 */
export const fbm2D: CustomFunction = defineFunction(
  "fbm2D",
  `float hash2D_fbm2D(vec2 p) {
  return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}
float fbm2D(vec2 p) {
  float total = 0.0;
  float amp = 0.5;
  float freq = 1.0;
  for (int i = 0; i < 4; i++) {
    total += hash2D_fbm2D(p * freq) * amp;
    amp *= 0.5;
    freq *= 2.0;
  }
  return total;
}`,
  { params: ["vec2"], returns: "float" },
);
