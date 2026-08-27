import { defineFunction } from "@patrickjaillet/ezsl";
import type { CustomFunction } from "@patrickjaillet/ezsl";

/**
 * Color-grading and palette functions. `cosinePalette` is the exact
 * cosine-palette formula (Inigo Quilez's well-known technique) already
 * used, under the name `hueShift`, in `examples/escape-hatch/shader.ezsl`
 * (validated, cross-browser-tested) — reproduced here verbatim as a
 * reusable preset rather than a one-off `defineFunction` call in that
 * example's own `main.ts`.
 */

/**
 * Maps `t` (typically `[0,1]`, but not clamped — extrapolates smoothly
 * outside that range too) through a cosine-based color palette, the same
 * formula `examples/escape-hatch/shader.ezsl`'s `hueShift` uses:
 * `0.5 + 0.5 * cos(2*PI * (t + vec3(0, 1/3, 2/3)))` — offsetting the
 * cosine phase per channel by a third of a turn each produces a smooth,
 * perceptually pleasant color cycle without needing an explicit lookup
 * table or HSV conversion.
 */
export const cosinePalette: CustomFunction = defineFunction(
  "cosinePalette",
  `vec3 cosinePalette(float t) {
  return 0.5 + 0.5 * cos(6.2831853 * (t + vec3(0.0, 0.3333333, 0.6666667)));
}`,
  { params: ["float"], returns: "vec3" },
);

/** Standard perceptual luminance weighting (Rec. 709) — the basis every other color-grading preset here builds on. */
export const luminance: CustomFunction = defineFunction(
  "luminance",
  `float luminance(vec3 color) {
  return dot(color, vec3(0.2126, 0.7152, 0.0722));
}`,
  { params: ["vec3"], returns: "float" },
);

/** Adjusts `color`'s saturation by `amount` (`0.0` = fully desaturated/grayscale, `1.0` = unchanged, `>1.0` = oversaturated) — interpolates between the color and its own luminance. */
export const saturate: CustomFunction = defineFunction(
  "saturate",
  `float luminance_saturate(vec3 color) {
  return dot(color, vec3(0.2126, 0.7152, 0.0722));
}
vec3 saturate(vec3 color, float amount) {
  float gray = luminance_saturate(color);
  return mix(vec3(gray, gray, gray), color, amount);
}`,
  { params: ["vec3", "float"], returns: "vec3" },
);

/** Simple S-curve contrast adjustment around mid-gray (`0.5`) — `amount` `1.0` is unchanged, `>1.0` increases contrast, `<1.0` decreases it. Applied per-channel. */
export const contrast: CustomFunction = defineFunction(
  "contrast",
  `vec3 contrast(vec3 color, float amount) {
  return (color - 0.5) * amount + 0.5;
}`,
  { params: ["vec3", "float"], returns: "vec3" },
);
