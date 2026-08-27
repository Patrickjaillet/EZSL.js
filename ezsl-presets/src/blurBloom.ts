import { defineFunction } from "@patrickjaillet/ezsl";
import type { CustomFunction } from "@patrickjaillet/ezsl";

/**
 * Blur/bloom passes — these operate on a `sampler2D`, which only exists
 * in EZSL as an auto-bound buffer-sampling uniform inside a v0.5
 * multi-pass pipeline (`createPipeline`, `<PassName>.sample(uv)` — see
 * docs/architecture/multi-pass.md). There is no way to author a
 * standalone "blur a texture" preset usable from a single-pass shader,
 * since a single-pass EZSL program has no texture input at all — these
 * presets are meant to be called from a *second* pass's `.ezsl` source
 * (e.g. a "Bloom" pass that samples an "Image" pass's own previous
 * output), not embedded in the pass being blurred itself.
 *
 * EZSL's `.sample(uv)` syntax compiles to `texture(u_buffer_<Name>,
 * uv)`, and there's no EZSL-level way to pass "which buffer" as an
 * ordinary function argument (a buffer name isn't a value — see
 * docs/architecture/multi-pass.md's "a buffer name is not a plain
 * value"). These presets are therefore written to take a `sampler2D`
 * GLSL parameter directly and are meant to be called from inside a
 * `glsl { ... }` Escape Hatch block in the consuming pass, where the raw
 * GLSL identifier `u_buffer_<Name>` (the uniform EZSL itself generates
 * for a `.sample()`-eligible buffer name) is directly nameable — see
 * this package's README for a worked example.
 */

/** A 9-tap separable-style box blur sample of `tex` around `uv`, offset by `texelSize` (typically `1.0 / resolution`) — cheap, visibly blocky at large radii, but a solid default for a bloom pass's first blur stage. */
export const boxBlur9: CustomFunction = defineFunction(
  "boxBlur9",
  `vec4 boxBlur9(sampler2D tex, vec2 uv, vec2 texelSize) {
  vec4 sum = vec4(0.0);
  for (int x = -1; x <= 1; x++) {
    for (int y = -1; y <= 1; y++) {
      sum += texture(tex, uv + vec2(float(x), float(y)) * texelSize);
    }
  }
  return sum / 9.0;
}`,
  { params: ["sampler2D", "vec2", "vec2"], returns: "vec4" },
);

/** A 13-tap Gaussian-weighted blur sample (3x3 grid with center-weighted falloff, not a true separable Gaussian pass, but a visibly smoother single-pass alternative to `boxBlur9`) around `uv`. */
export const gaussianBlur13: CustomFunction = defineFunction(
  "gaussianBlur13",
  `vec4 gaussianBlur13(sampler2D tex, vec2 uv, vec2 texelSize) {
  vec4 sum = texture(tex, uv) * 0.227027;
  vec2 offsets1 = texelSize * 1.384615;
  vec2 offsets2 = texelSize * 3.230769;
  sum += texture(tex, uv + vec2(offsets1.x, 0.0)) * 0.316216;
  sum += texture(tex, uv - vec2(offsets1.x, 0.0)) * 0.316216;
  sum += texture(tex, uv + vec2(0.0, offsets1.y)) * 0.316216;
  sum += texture(tex, uv - vec2(0.0, offsets1.y)) * 0.316216;
  sum += texture(tex, uv + vec2(offsets2.x, 0.0)) * 0.070270;
  sum += texture(tex, uv - vec2(offsets2.x, 0.0)) * 0.070270;
  sum += texture(tex, uv + vec2(0.0, offsets2.y)) * 0.070270;
  sum += texture(tex, uv - vec2(0.0, offsets2.y)) * 0.070270;
  return sum;
}`,
  { params: ["sampler2D", "vec2", "vec2"], returns: "vec4" },
);

/** Extracts the pixels of `tex` at `uv` brighter than `threshold` (per Rec. 709 luminance), zeroing out everything else — the standard first step of a bloom effect, meant to be applied in a "BufferBright"-style pass before blurring and additively compositing back onto the original image. */
export const brightnessThreshold: CustomFunction = defineFunction(
  "brightnessThreshold",
  `vec4 brightnessThreshold(sampler2D tex, vec2 uv, float threshold) {
  vec4 color = texture(tex, uv);
  float lum = dot(color.rgb, vec3(0.2126, 0.7152, 0.0722));
  return lum > threshold ? color : vec4(0.0, 0.0, 0.0, color.a);
}`,
  { params: ["sampler2D", "vec2", "float"], returns: "vec4" },
);
