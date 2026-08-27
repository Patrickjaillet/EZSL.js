// The Online Playground's shader gallery — a static, curated selection
// of already-validated `.ezsl` sources from the main repo's `examples/`
// directory, loaded at build time via Vite's `?raw` import (the same
// mechanism every example's own `main.ts` and `examples/_harness/main.ts`
// already use — see docs/architecture/integration-testing.md). This is
// deliberately *not* a community/submission gallery — see
// docs/architecture/online-playground.md's "Scope" section for why a
// real submission gallery (backend + ongoing human moderation) is out of
// scope for this milestone. Every entry here is a shader already
// confirmed to compile/link/render correctly across Chromium, Firefox,
// WebKit, and Edge via `npm run test:integration` in the main repo — this
// gallery reuses that validation, it doesn't re-establish it.
//
// Only examples with a single, self-contained `shader.ezsl` and no
// `customFunctions`/`bufferNames` requirement are included — the
// Playground's own `compileEzsl(source)` call (see main.ts) has no way to
// register custom functions or a multi-pass buffer graph, so
// `multi-pass`/`three-integration`/`canvas2d-interop` (structurally
// different — no single `shader.ezsl`), `escape-hatch`/`type-system`
// (need `customFunctions`), and `error-demo`/`did-you-mean-demo`
// (deliberately broken, not meant to render) are excluded.

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

export interface GalleryEntry {
  name: string;
  source: string;
}

export const GALLERY: GalleryEntry[] = [
  { name: "Gradient", source: gradient },
  { name: "Circle", source: circle },
  { name: "Plasma", source: plasma },
  { name: "Noise", source: noise },
  { name: "Raymarch (sphere)", source: raymarch },
  { name: "Raymarch (box)", source: raymarchBox },
  { name: "Checkerboard", source: checkerboard },
  { name: "Stripes", source: stripes },
  { name: "Vignette", source: vignette },
  { name: "Rings", source: rings },
  { name: "Square", source: square },
  { name: "Pulse", source: pulse },
  { name: "Swirl", source: swirl },
  { name: "Waves", source: waves },
  { name: "Crosshatch", source: crosshatch },
  { name: "Heart", source: heart },
  { name: "Color Wheel", source: colorwheel },
  { name: "Dots", source: dots },
  { name: "Starburst", source: starburst },
  { name: "FBM Clouds", source: fbmClouds },
  { name: "Kaleidoscope", source: kaleidoscope },
];
