# Advanced: the Escape Hatch

Every EZSL construct transpiles to clean, native GLSL — but EZSL doesn't have syntax for everything GLSL can do (boolean operators, unbounded loops, and more — see `docs/EZSL_LANGUAGE_SPECIFICATION_v1.0.md`'s "Known non-goals" section, in the main repo, for the current list). When you hit one of those gaps, the **Escape Hatch** lets you drop into raw GLSL, inline, without leaving your `.ezsl` file. This is a task-oriented reformulation of `docs/architecture/escape-hatch.md` — that doc explains the full design and internal implementation; this page walks through *using* it.

## `glsl { ... }` — raw GLSL, verbatim

```ezsl
center = uv - [0.5, 0.5]
d = length(center)
ripple = 0.0

glsl {
  ripple = 0.5 + 0.5 * sin(d * 30.0 - time * 3.0);
}

color = [ripple, ripple, ripple]
```

Everything between `glsl { ... }`'s braces is copied into the generated GLSL **verbatim** — EZSL does not tokenize, parse, or type-check it at all. This is the trade-off: you get full GLSL power (any syntax, any built-in, `#define`/`#ifdef`), and in exchange EZSL can't catch a mistake inside the block for you — a typo here surfaces as a real WebGL driver error, not a friendly EZSL one (though `mount(canvas, program, { ezslSource })` still translates *that* into a `.ezsl`-relative message where it can — see the beginner track's [Errors](../beginner/05-builtins-and-uniforms.md#errors) section).

**Reading and writing EZSL variables from inside the block just works** — reference `d`, `ripple`, or any other already-declared EZSL local by its plain name (no special syntax), since EZSL locals compile 1:1 to identically-named GLSL identifiers. Position matters: statements before the block have already run when it executes; statements after it haven't yet.

## The one check EZSL still does

Even though EZSL can't understand the block's contents, it does catch one common mistake: declaring a raw GLSL local (`float x = ...;`) whose name collides with an EZSL variable already in scope. GLSL has no scoping that would make that safe, so EZSL flags it as a real `CompileError` — with your `.ezsl` line and column — rather than letting it surface as an opaque driver "redefinition" error.

## `defineFunction` — reusable custom GLSL functions

For a whole reusable *function* (not just inline logic), register it from your TypeScript/JavaScript code instead:

```ts
import { defineFunction, compileEzsl } from "@patrickjaillet/ezsl";

const square = defineFunction(
  "square",
  `float square(float x) { return x * x; }`,
  { params: ["float"], returns: "float" },
);

const program = compileEzsl(shaderSource, { customFunctions: [square] });
```

Then `square(...)` is callable from `.ezsl` source exactly like any built-in function. `ezsl-presets` (a separate package in the main repo) ships a small library of ready-made presets — noise, SDF primitives, color grading, blur/bloom — built exactly this way, if you'd rather use a battle-tested one than write your own.

## What you've learned

- `glsl { ... }` drops raw, unvalidated GLSL directly into the generated shader — full power, no EZSL-side type checking inside the block.
- It can read and write already-declared EZSL locals by their plain names; position in the file matters.
- `defineFunction` (a JS-side call, not `.ezsl` syntax) registers a reusable custom GLSL function, callable from EZSL source like any built-in.

This completes the progressive tutorial track: [Beginner](../beginner/01-hello-gradient.md) → Intermediate (Three.js / multi-pass / Canvas2D) → **Advanced (you are here)**.
