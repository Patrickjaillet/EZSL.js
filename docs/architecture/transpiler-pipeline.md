# EZSL.js — Transpiler Pipeline (v0.1)

Internal design doc for the v0.1 "Proof of Concept" transpiler core. Describes how `.ezsl` source becomes a running WebGL2 shader.

## Pipeline overview

```
.ezsl source (string)
  |
  |  src/lexer/tokenizer.ts — tokenize()
  v
Token[]
  |
  |  src/parser/parser.ts — parse()
  v
Parser AST (src/parser/ast.ts)
  |
  |  src/compiler/compile.ts — compile()
  v
Codegen IR (src/codegen/types.ts: Program)
  |
  |  src/codegen/glslGenerator.ts — generateFragmentShader()
  v
GLSL ES 3.00 source (string)
  |
  |  src/runtime/bootstrap.ts — mount()
  v
Live WebGL2 canvas + draw loop
```

`src/compiler/index.ts` exposes `compileEzsl(source)`, chaining tokenize → parse → compile in one call. `src/index.ts` re-exports the full public API.

Each stage is independently testable and has its own error type (`LexError`, `ParseError`, `CompileError`), each carrying a `{ line, column }` position in the original `.ezsl` source — the basis for the v0.4 error-translation layer's source mapping.

## Stage 1 — Tokenizer (`src/lexer/`)

Flat scan of the source string into a `Token[]`. Token kinds: `NUMBER`, `IDENTIFIER` (including keywords `for`/`in`/`if`/`else`, resolved to their own token types), arithmetic operators (`+ - * /`), comparison operators (`< <= > >= ==`), assignment (`=`), structural punctuation (`( ) [ ] { } , .` and range `..`), and `NEWLINE` (statement separator — consecutive newlines collapse to one). `//` line comments are stripped. Whitespace within a line is insignificant.

Indentation is **not** significant — blocks are delimited by `{ }`, not by column position, unlike Python-style grammars.

## Stage 2 — Parser (`src/parser/`)

Recursive-descent parser producing the AST in `src/parser/ast.ts`. Grammar (v0.1 scope):

```
Program      -> Statement* EOF
Statement    -> Assignment | IfStatement | ForStatement
Assignment   -> IDENTIFIER '=' Expression NEWLINE?
IfStatement  -> 'if' Comparison Block ('else' (IfStatement | Block))?
ForStatement -> 'for' IDENTIFIER 'in' NUMBER '..' NUMBER Block
Block        -> '{' NEWLINE? Statement* '}'
Comparison   -> Expression (('<' | '<=' | '>' | '>=' | '==') Expression)?
Expression   -> Term (('+' | '-') Term)*
Term         -> Unary (('*' | '/') Unary)*
Unary        -> '-' Unary | Postfix
Postfix      -> Primary ('.' IDENTIFIER)*
Primary      -> NUMBER | Call | VectorLiteral | IDENTIFIER | '(' Expression ')'
Call         -> IDENTIFIER '(' (Expression (',' Expression)*)? ')'
VectorLiteral -> '[' Expression (',' Expression)* ']'
```

Notable design choices:
- **Unary minus is desugared** at parse time into `0 - operand` (a `BinaryExpression`), keeping the AST shape minimal — no separate `UnaryExpression` node exists.
- **`for` loop bounds are number literals**, not arbitrary expressions — `from`/`to` are known at parse time, which lets the compiler emit a real GLSL `for (int i = from; i < to; i++)` and validate the range is non-empty *before* codegen, rather than relying on the GLSL driver to reject it.
- **`if` conditions are a single `Comparison`**, not a general boolean expression — there is no `&&`/`||`/`!` yet. This keeps `ComparisonExpression` a leaf in the grammar rather than something `Expression` recurses through.
- The parser has **no knowledge of types**. `uv.xy` and `someUniform.xy` parse identically as `MemberExpression`; whether `.xy` is a valid swizzle for the underlying type is entirely a Stage 3 concern.

## Stage 3 — Compiler / type inference (`src/compiler/compile.ts`, `src/compiler/typeInference.ts`)

Walks the AST and produces the codegen IR: a `Uniform[]` list, an ordered `body: string[]` of ready-to-emit GLSL statements, and a final `outColor: Expr`.

**Two "Program" types exist and are not interchangeable** — a recurring source of confusion to watch for:
- Parser AST `Program` (`src/parser/ast.ts`) — plain syntax tree, no types.
- Codegen IR `Program` (`src/codegen/types.ts`) — post-inference, GLSL-ready. `compile()` is the only producer; `generateFragmentShader()` is the only consumer.

### Type inference (shape-based, v0.1 scope)

- Number literals: always `float`.
- Vector literals `[a, b, c]`: `vecN` from element count (2–4).
- `vec2(...)`/`vec3(...)`/`vec4(...)`/`float(...)` constructor calls: declared type (the last is a scalar cast, used for e.g. converting a `for`-loop's `int` counter to `float`).
- Swizzles (`.xyz`, `.rgba`): result type from swizzle length; validated against the source expression's component count (`componentCount()` in `typeInference.ts`) — referencing more components than the source type has is a `CompileError`, not a silent GLSL compile failure downstream.
- Builtin functions are split into two buckets in `typeInference.ts`, and this split is load-bearing:
  - `FIXED_RETURN_FUNCTIONS` (`sin`, `cos`, `length`, `sqrt`, `dot`) always return `float`, regardless of argument type — `length(vec3)` is `float`, not `vec3`.
  - `SHAPE_PRESERVING_FUNCTIONS` (`abs`, `mix`, `clamp`, `smoothstep`, `fract`, `floor`, `mod`, `max`, `min`, `pow`, `exp`, `normalize`, `cross`, `reflect`, `step`) operate component-wise and widen their return type to match their widest vector argument.
  - Adding a new builtin means picking the correct bucket. Conflating them previously caused `length(vec3)` to be misinferred as `vec3` (caught by the test in `tests/compile.test.ts`) — this class of bug won't show up as a TypeScript error, only as either a wrong runtime type or an invalid GLSL emission, so new builtins need an explicit test.
- Free identifiers that aren't a builtin (`uv`, `time`, `resolution`) or a previously-assigned local are treated as an **implicit user uniform**, defaulting to `float` on first reference and named `u_<name>` in GLSL.
- The `for`-loop counter variable is typed `int` (matching the GLSL `for (int i = ...)` it compiles to), *not* `float` — using it directly in a `float` context requires an explicit `float(i)` cast in EZSL source (see `examples/raymarch/shader.ezsl`). This mirrors real GLSL's lack of implicit int→float coercion (a v0.3 roadmap item, effectively enforced early here for this one case).
- `ComparisonExpression` produces a `bool`-typed `Expr` — `bool` exists in `EzslType` solely to type `if` conditions; it cannot appear in a vector literal or be swizzled.
- Local and `for`-loop variable names are validated against the GLSL ES 3.00 reserved-word list (`isReservedGlslWord` in `typeInference.ts`) before being declared. Unlike uniforms (always `u_`-prefixed in GLSL), local names compile 1:1 to GLSL identifiers, so an EZSL variable named e.g. `half`, `sample`, or `input` would otherwise pass EZSL compilation cleanly and only fail at the WebGL driver with an opaque "illegal use of reserved word" error — exactly the class of failure the v0.4 error-translation layer exists to prevent, caught here instead at the EZSL layer where a `CompileError` can point at the offending source line. Found while validating the example shader set (see below): `checkerboard`'s `half` and `fbm-clouds`'s `sample` both tripped this before the check existed.

### Statement compilation

- A flat, recursive walk (`emitStatements`) over `Statement[]`, tracking indentation depth so nested `if`/`for` blocks emit correctly nested GLSL.
- **First assignment to a name declares it** (`<type> name = value;`); **a later assignment to the same name re-assigns it** (`name = value;`) without re-declaring the type. This is what makes loop-accumulated state possible — e.g. `t = t + d * 0.5` inside a `for` body in the raymarch example — without a separate "declare vs. assign" syntax in EZSL source.
- The statement `color = <expr>` at the top level (depth 0 only — an assignment to `color` inside a nested block is just a local reassignment, not the output) becomes `outColor`, auto-wrapped in `vec4(..., 1.0)` if not already `vec4`. Every other assignment becomes a `body` line.
- A program that never assigns to `color` is a `CompileError` — there's no implicit default output.

## Stage 4 — GLSL codegen (`src/codegen/glslGenerator.ts`)

Pure string templating: wraps the IR's `uniforms`/`body`/`outColor` in a `#version 300 es` fragment shader, with **boilerplate auto-injected ahead of user code** and invisible in EZSL source:

- `uv` — normalized `gl_FragCoord.xy / u_resolution`, **Y-flipped** (`uv.y = 1.0 - uv.y`) so `(0,0)` is top-left, matching Canvas2D/beginner mental models rather than GLSL's native bottom-left origin. This is the roadmap's documented v0.1 trap — it was locked in at this stage specifically so it doesn't become a breaking change once user shaders exist.
- `time` — bound to `uniform float u_time`, updated every frame by the runtime.
- `resolution` — bound to `uniform vec2 u_resolution`.

`generateVertexShader()` is a fixed fullscreen-quad passthrough, identical for every v0.1 program — there's no vertex-stage EZSL authoring yet (planned for v0.6 Three.js integration).

## Stage 5 — Runtime (`src/runtime/bootstrap.ts`)

`mount(canvas, program)`:
1. Acquires a `webgl2` context (throws if unavailable — no WebGL1 fallback in v0.1).
2. Compiles/links the vertex + generated fragment shader (`compileShader`/`linkProgram`), surfacing the raw driver log plus the offending GLSL source on failure. This raw log is exactly what the v0.4 error-translation layer will intercept and rewrite in terms of `.ezsl` source lines.
3. Uploads a static fullscreen-quad vertex buffer (two triangles, clip-space `[-1, 1]`).
4. Runs a `requestAnimationFrame` loop binding `u_time`/`u_resolution` every frame and drawing.
5. Returns a handle exposing `stop()` and `setUniform(name, value)` for user-declared uniforms (looked up by their EZSL name, not their GLSL `u_`-prefixed name).

## What v0.1 deliberately does not support

Kept out of scope to match the roadmap's "proof of concept" framing — each is a known next step, not an oversight:

- **General boolean logic** (`&&`, `||`, `!`) — `if` takes a single comparison only.
- **User-defined functions** — no way to factor out reusable EZSL logic; every example is a flat (possibly loop/branch-containing) sequence of statements.
- **Array types** (`float[8]`, etc.) — planned for v0.3; this is also why the noise example (`examples/noise/shader.ezsl`) is unsmoothed hash noise rather than interpolated value noise: there's no lookup-table mechanism yet.
- **The Escape Hatch** (`` glsl`...` `` raw GLSL passthrough) — v0.2 scope; not implemented.
- **`mat2`/`mat3`/`mat4`, structs** — v0.3 scope.
- **Error translation** (driver log → plain English) — v0.4 scope; today, a `CompileError`/`LexError`/`ParseError` gives a source position and a structural message, and a WebGL link/compile failure surfaces the raw driver log verbatim.

## Validated examples

`examples/<name>/shader.ezsl` (21 total) are real `.ezsl` source files (not hand-authored IR) compiled through the full pipeline and confirmed to link/render correctly in an actual browser (Chromium via Playwright — every one linked as a real WebGL2 program, not just unit-tested; a representative subset was also screenshotted and eyeballed). This satisfies the roadmap's "round-trip validation on a reference set of 20 test shaders" v0.1 deliverable. They exercise:

| Example | Exercises |
|---|---|
| `gradient` | vector literals, swizzles, `sin`, boilerplate `uv`/`time` |
| `circle` | `length`, `smoothstep`, intermediate variables |
| `plasma` | multiple `sin`/`cos` combinations, arithmetic precedence |
| `noise` | `fract`, `dot`, hash-based pseudo-randomness |
| `raymarch` | bounded `for` loop, `if`, loop-accumulated reassignment, `normalize`, `int`→`float` cast, 3D `vec3` math (sphere SDF) |
| `checkerboard` | `floor`, integer-parity arithmetic via `float` ops |
| `stripes` | `sin`, `abs`, `smoothstep` banding |
| `vignette` | radial `smoothstep` falloff |
| `rings` | `sin` of distance, animated phase |
| `square` | `max` combined with per-axis `smoothstep` (SDF-style box mask) |
| `pulse` | time-varying `smoothstep` threshold |
| `swirl` | `atan` (two-argument, polar angle), rotation-like distortion |
| `waves` | horizontal-band distortion via `sin` offset |
| `crosshatch` | `fract`, `min` for pattern intersection |
| `heart` | implicit polynomial curve, `smoothstep` band width tuning (initially mis-scaled — see note below) |
| `colorwheel` | `atan`, per-channel `cos` phase offsets (hue wheel) |
| `dots` | `fract` for tiling, per-cell `length` |
| `starburst` | `atan`, `cos`-modulated radial threshold |
| `fbm-clouds` | bounded `for` loop accumulating amplitude/frequency octaves (fractal Brownian motion) |
| `raymarch-box` | bounded `for` loop, `if`, box SDF (`max`/`min`/`abs`), a second distinct 3D raymarched scene |
| `kaleidoscope` | `atan`, `mod` for angular folding/symmetry |

Run any of them with `npm run example:<name>` (Vite dev server, imports the `.ezsl` file via `?raw` and compiles it client-side).

**Two issues were found and fixed during this validation pass**, both worth knowing about before adding more examples:
- `checkerboard` and `fbm-clouds` originally used the GLSL-reserved identifiers `half` and `sample` as local variable names — these passed EZSL compilation but failed at the WebGL driver. This is what motivated adding `isReservedGlslWord` validation to the compiler (see Stage 3 above) rather than just renaming the two variables and moving on.
- `heart`'s implicit-curve formula was initially mis-scaled (wrong coordinate range and `smoothstep` band width for the polynomial's actual magnitude), rendering as a plain blob rather than a heart shape — a shader-authoring bug, not a compiler bug, caught only by actually looking at the rendered screenshot rather than trusting "it compiled."
