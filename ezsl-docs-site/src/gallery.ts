// The Playground's shader gallery — a static, curated selection of
// already-validated `.ezsl` sources from the main repo's `examples/`
// directory, loaded at build time via Vite's `?raw` import (the same
// mechanism every example's own `main.ts` and `examples/_harness/main.ts`
// already use). Deliberately *not* a community/submission gallery — see
// docs/architecture/unified-site-v2.md's "Scope" section for why a real
// submission gallery (backend + ongoing human moderation) is out of scope.
// Every entry here is a shader confirmed to compile/link/render correctly
// across Chromium, Firefox, WebKit, and Edge via `npm run test:integration`
// in the main repo — this gallery reuses that validation, it doesn't
// re-establish it.
//
// Only examples with a single, self-contained `shader.ezsl` and no
// `customFunctions`/`bufferNames` requirement are included — the
// Playground's own `compileEzsl(source)` call has no way to register
// custom functions or a multi-pass buffer graph, so
// `multi-pass`/`three-integration`/`canvas2d-interop` (structurally
// different — no single `shader.ezsl`), `escape-hatch`/`type-system` (need
// `customFunctions`), and `error-demo`/`did-you-mean-demo` (deliberately
// broken, not meant to render) are excluded.

import checkerboard from "../../examples/checkerboard/shader.ezsl?raw";
import circle from "../../examples/circle/shader.ezsl?raw";
import colorwheel from "../../examples/colorwheel/shader.ezsl?raw";
import crosshatch from "../../examples/crosshatch/shader.ezsl?raw";
import dots from "../../examples/dots/shader.ezsl?raw";
import fbmClouds from "../../examples/fbm-clouds/shader.ezsl?raw";
import gradient from "../../examples/gradient/shader.ezsl?raw";
import heart from "../../examples/heart/shader.ezsl?raw";
import kaleidoscope from "../../examples/kaleidoscope/shader.ezsl?raw";
import noise from "../../examples/noise/shader.ezsl?raw";
import plasma from "../../examples/plasma/shader.ezsl?raw";
import pulse from "../../examples/pulse/shader.ezsl?raw";
import raymarch from "../../examples/raymarch/shader.ezsl?raw";
import raymarchBox from "../../examples/raymarch-box/shader.ezsl?raw";
import rings from "../../examples/rings/shader.ezsl?raw";
import square from "../../examples/square/shader.ezsl?raw";
import starburst from "../../examples/starburst/shader.ezsl?raw";
import stripes from "../../examples/stripes/shader.ezsl?raw";
import swirl from "../../examples/swirl/shader.ezsl?raw";
import vignette from "../../examples/vignette/shader.ezsl?raw";
import waves from "../../examples/waves/shader.ezsl?raw";

import voronoi from "../../examples/voronoi/shader.ezsl?raw";
import domainWarp from "../../examples/domain-warp/shader.ezsl?raw";
import polarRepeat from "../../examples/polar-repeat/shader.ezsl?raw";
import sdfShowcase from "../../examples/sdf-showcase/shader.ezsl?raw";
import sdfSmoothUnion from "../../examples/sdf-smooth-union/shader.ezsl?raw";
import hsvColorCycle from "../../examples/hsv-color-cycle/shader.ezsl?raw";
import pixelation from "../../examples/pixelation/shader.ezsl?raw";
import chromaticAberration from "../../examples/chromatic-aberration/shader.ezsl?raw";
import clock from "../../examples/clock/shader.ezsl?raw";
import interferenceWaves from "../../examples/interference-waves/shader.ezsl?raw";
import truchetTiles from "../../examples/truchet-tiles/shader.ezsl?raw";
import glowLines from "../../examples/glow-lines/shader.ezsl?raw";

export type GalleryCategory = "Patterns" | "Noise & Procedural" | "Raymarching" | "Color & Animation" | "SDF Techniques";

export interface GalleryEntry {
  name: string;
  source: string;
  category: GalleryCategory;
}

export const GALLERY: GalleryEntry[] = [
  { name: "Gradient", source: gradient, category: "Color & Animation" },
  { name: "Circle", source: circle, category: "Patterns" },
  { name: "Plasma", source: plasma, category: "Noise & Procedural" },
  { name: "Noise", source: noise, category: "Noise & Procedural" },
  { name: "Raymarch (sphere)", source: raymarch, category: "Raymarching" },
  { name: "Raymarch (box)", source: raymarchBox, category: "Raymarching" },
  { name: "Checkerboard", source: checkerboard, category: "Patterns" },
  { name: "Stripes", source: stripes, category: "Patterns" },
  { name: "Vignette", source: vignette, category: "Patterns" },
  { name: "Rings", source: rings, category: "Patterns" },
  { name: "Square", source: square, category: "Patterns" },
  { name: "Pulse", source: pulse, category: "Color & Animation" },
  { name: "Swirl", source: swirl, category: "Patterns" },
  { name: "Waves", source: waves, category: "Color & Animation" },
  { name: "Crosshatch", source: crosshatch, category: "Patterns" },
  { name: "Heart", source: heart, category: "Patterns" },
  { name: "Color Wheel", source: colorwheel, category: "Color & Animation" },
  { name: "Dots", source: dots, category: "Patterns" },
  { name: "Starburst", source: starburst, category: "Patterns" },
  { name: "FBM Clouds", source: fbmClouds, category: "Noise & Procedural" },
  { name: "Kaleidoscope", source: kaleidoscope, category: "Patterns" },

  { name: "Voronoi", source: voronoi, category: "Noise & Procedural" },
  { name: "Domain Warp", source: domainWarp, category: "Noise & Procedural" },
  { name: "Polar Repeat", source: polarRepeat, category: "SDF Techniques" },
  { name: "SDF Showcase", source: sdfShowcase, category: "SDF Techniques" },
  { name: "SDF Smooth Union", source: sdfSmoothUnion, category: "SDF Techniques" },
  { name: "HSV Color Cycle", source: hsvColorCycle, category: "Color & Animation" },
  { name: "Pixelation", source: pixelation, category: "Patterns" },
  { name: "Chromatic Aberration", source: chromaticAberration, category: "Color & Animation" },
  { name: "Clock", source: clock, category: "Color & Animation" },
  { name: "Interference Waves", source: interferenceWaves, category: "Patterns" },
  { name: "Truchet Tiles", source: truchetTiles, category: "Patterns" },
  { name: "Glow Lines", source: glowLines, category: "SDF Techniques" },
];
