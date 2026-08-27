import { defineFunction } from "@patrickjaillet/ezsl";
import type { CustomFunction } from "@patrickjaillet/ezsl";

/**
 * Signed-distance-field primitives — each takes a sample point (already
 * translated relative to the shape's own center/origin, matching the SDF
 * convention `examples/raymarch/shader.ezsl` and
 * `examples/raymarch-box/shader.ezsl` already use inline: `p -
 * sphereCenter`/`abs(p) - halfExtents` computed by the caller, not baked
 * into the preset) and returns a signed distance — negative inside the
 * shape, zero on its surface, positive outside. All GLSL text below is
 * lifted verbatim from those two validated, cross-browser-tested
 * examples (only the raymarch/accumulation loop around them is left to
 * the caller — a preset library provides the distance *function*, not a
 * whole raymarcher), not independently invented formulas.
 */

/** Distance from `p` to a sphere of `radius` centered at the origin — `examples/raymarch/shader.ezsl`'s `length(p - sphereCenter) - 1.0`, generalized to an explicit radius. */
export const sdfSphere: CustomFunction = defineFunction(
  "sdfSphere",
  `float sdfSphere(vec3 p, float radius) {
  return length(p) - radius;
}`,
  { params: ["vec3", "float"], returns: "float" },
);

/** Distance from `p` to an axis-aligned box with the given half-extents centered at the origin — the exact formula `examples/raymarch-box/shader.ezsl` runs inline (`q = abs(p) - halfExtents`, then the standard outside/inside-distance combination). */
export const sdfBox: CustomFunction = defineFunction(
  "sdfBox",
  `float sdfBox(vec3 p, vec3 halfExtents) {
  vec3 q = abs(p) - halfExtents;
  float outsideDist = length(max(q, 0.0));
  float insideDist = min(max(q.x, max(q.y, q.z)), 0.0);
  return outsideDist + insideDist;
}`,
  { params: ["vec3", "vec3"], returns: "float" },
);

/** 2D distance from `p` to a circle of `radius` centered at the origin — the 2D analogue of `sdfSphere`, useful for flat/screen-space shapes (e.g. `examples/circle/shader.ezsl`'s `length(uv - [0.5, 0.5])` pattern, generalized). */
export const sdfCircle2D: CustomFunction = defineFunction(
  "sdfCircle2D",
  `float sdfCircle2D(vec2 p, float radius) {
  return length(p) - radius;
}`,
  { params: ["vec2", "float"], returns: "float" },
);

/** 2D distance from `p` to an axis-aligned rectangle with the given half-extents centered at the origin — the 2D analogue of `sdfBox`, same formula shape. */
export const sdfBox2D: CustomFunction = defineFunction(
  "sdfBox2D",
  `float sdfBox2D(vec2 p, vec2 halfExtents) {
  vec2 q = abs(p) - halfExtents;
  float outsideDist = length(max(q, 0.0));
  float insideDist = min(max(q.x, q.y), 0.0);
  return outsideDist + insideDist;
}`,
  { params: ["vec2", "vec2"], returns: "float" },
);
