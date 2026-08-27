# EZSL.js — Type System Hardening (v0.3)

Internal design doc for the v0.3.x "Type System Hardening" milestone: user-defined EZSL functions with inferred return types, `mat2`/`mat3`/`mat4`, fixed-size arrays, and structs. Read `docs/architecture/transpiler-pipeline.md` first (v0.1 core: the AST/IR split, the existing shape-based inference rules) — this doc only covers what's new on top of that.

## Why user-defined functions had to come first

`ROADMAP.md`'s v0.3 item "function return-type inference" presupposes EZSL has user-defined functions to infer a return type *for*. It didn't — v0.1/v0.2 only had builtins and `defineFunction` (a JS-side registration of a function whose GLSL body and signature are both supplied explicitly, so there's nothing to infer). This milestone therefore adds real EZSL function syntax (`fn name(params) { ... }`) alongside the type-system items the roadmap named — without it, "return-type inference" isn't a feature, it's a sentence with nothing to point at.

## `ResolvedType` — a second, richer type representation

The codegen IR's `EzslType` (`src/codegen/types.ts`) is a flat string union (`"float" | "vec2" | ... | "mat4"`) — sufficient for a GLSL type annotation, which is all a `Uniform` or a builtin function's return type needs to be. Arrays and structs don't fit that shape: an array needs an element type *and* a size, a struct needs its declared name. Rather than stretch `EzslType` to cover those (which would make every existing scalar/vector type check across the v0.1/v0.2 compiler need to first ask "wait, is this secretly an array?"), v0.3 introduces `ResolvedType` (`src/compiler/types.ts`), used internally by the compiler during type inference:

```ts
type ResolvedType =
  | { kind: "scalar"; type: EzslType }
  | { kind: "array"; element: EzslType; size: number }
  | { kind: "struct"; name: string };
```

`TypedExpr` (internal to `src/compiler/compile.ts`, not exported) is `{ glsl: string; type: ResolvedType }` — the compiler's working representation for every expression during compilation. Only at the very end, when producing `outColor` for the codegen IR's `Expr` (`{ glsl: string; type: EzslType }`), does the compiler require the type to be a `scalar` — `color` assigning to an array or struct is a `CompileError`, since there's no such thing as a struct- or array-valued `fragColor`. Everywhere else in the pipeline downstream of `compile()` (codegen, runtime) is completely unaware `ResolvedType`/arrays/structs exist — they only ever see the flat `EzslType` strings they always have.

`TypeScope` (`src/compiler/typeInference.ts`) was updated to store `ResolvedType` instead of `EzslType`, so a local variable can now hold an array or struct value, not just a scalar/vector/matrix.

## `mat2` / `mat3` / `mat4`

The smallest addition: added to `TYPE_CONSTRUCTORS` (so `mat3(...)` parses and type-checks as a constructor call, same as `vec3(...)`) and to `componentCount` (4/9/16 components respectively, used by the swizzle-validity check — though swizzling a matrix isn't meaningful in GLSL and isn't specifically blocked beyond the general "swizzle only applies to scalar-kind values" check inherited from vectors). Binary operators (`BinaryExpression`) already worked generically off `ResolvedType`'s `scalar` variant, so `vec2 * mat2` (used in `examples/type-system/shader.ezsl` for a 2D rotation) works without any matrix-specific casing: the existing rule "result type is the non-`float` operand's type, or the left operand's type if both are non-`float`" happens to produce the right answer for `vec2 * mat2 -> vec2`, matching GLSL's own operator semantics for that combination.

## Two real bugs found and fixed while building fixed-size arrays

Both were pre-existing latent bugs in v0.1/v0.2 code, only surfaced because implementing arrays forced writing the first tests that actually exercised the affected paths (array indexing, and a 3-letter swizzle wider than its source's component count):

1. **Array indices were emitted as GLSL `float`, not `int`.** Every number literal goes through `formatNumber`, which always appends `.0` (`0` → `0.0`) — correct for `float` contexts, but a GLSL array subscript **must** be an `int` expression; `xs[0.0]` is a compile error at the driver, not a warning. Fixed in `IndexExpression`'s handling in `compile.ts`: a literal integer index is now emitted without the `.0` (`xs[0]`), and a non-literal index must resolve to `ResolvedType`'s `int` (e.g. a `for`-loop counter) or it's a `CompileError` — silently truncating/casting a `float` index was deliberately not chosen, since GLSL itself doesn't allow it either.
2. **Swizzle validity was checked against the wrong axis.** The old check rejected `.xyx` on a `vec2` because `.xyx` has 3 characters and `vec2` only has 2 components — but that conflates two unrelated things. GLSL swizzles allow *repeating* components (`vec2(1,2).xyx` is a valid, legal `vec3(1, 2, 1)`); the real constraint is that every individual *letter used* must be a valid component of the source type (only `x`/`y` for a `vec2`), and the *only* length constraint is the GLSL-wide "at most 4 components in a swizzle." Fixed to check letter membership against the source type's valid component set, not compare string lengths. Caught by a struct example legitimately using `uv.xyx` to promote a `vec2` to a `vec3` (`examples/type-system/shader.ezsl`'s precursor).

Both are now covered by regression tests in `tests/compile.test.ts`.

## Two more real bugs, found by the v0.4 Alpha-deliverable type-inference test suite

`tests/typeInference.test.ts` (the ≥150-case suite — see `ROADMAP.md`'s Alpha-phase deliverables) is deliberately exhaustive: every builtin crossed with representative argument types, every swizzle length/letter combination, every binary-operator shape pairing. Writing it exhaustively (rather than one or two examples per rule) is precisely what surfaced two more latent gaps that no example shader or earlier hand-picked test happened to exercise:

3. **Swizzling a matrix wasn't rejected.** `m.x` where `m` is a `mat2` passed compilation — the swizzle-validity check computed valid component letters from `componentCount(sourceType)` (which returns `4` for `mat2`, `9` for `mat3`, etc. — a count of scalar components, not swizzle-eligible axes), so `mat2.x` looked exactly like a legal 1-letter swizzle on a 4-component type. GLSL has **no swizzle syntax for matrices at all** — `componentCount` was never meant to answer "is this type swizzle-eligible," only "how many components does this vector/scalar have," and using it for both crossed a line. Fixed with an explicit up-front rejection of `mat2`/`mat3`/`mat4` in `MemberExpression`'s handling, before the swizzle-letter check runs.
4. **Binary operators between shape-mismatched non-float operands weren't rejected.** `uv + p` where `uv` is `vec2` and `p` is `vec3` passed compilation, silently producing invalid GLSL (`(uv + p)` — GLSL itself would reject this, but EZSL wasn't catching it first). The old rule was just `left.type === "float" ? right.type : left.type` — a **result-type** formula with no accompanying **validity** check; it happily computed *an* answer (`vec2`, since `left` isn't `float`) without ever confirming `left` and `right` were compatible in the first place. Fixed by validating that non-`float` operands must either match exactly, or be the one GLSL-legal mixed case (`vecN * matN` / `matN * vecN`, same `N` — used by `examples/type-system/shader.ezsl`'s `uv * rot` rotation) — anything else is now a `CompileError` naming both mismatched types.

Both are regression-tested in `tests/typeInference.test.ts`. Together with the two bugs above, this is four latent type-checking gaps found purely by writing tests systematically rather than opportunistically — the pattern is consistent: each gap was in code that *looked* complete (it computed a plausible-looking answer) but was never actually validating its own precondition.

### `array[...]` vs. `[...]`

A fixed-size array literal is written `array[e1, e2, ...]` — the `array` keyword prefix, not bare `[e1, e2, e3]`, which already means "vector literal" (infers `vecN` from a 2–4 element list; see `docs/architecture/transpiler-pipeline.md`). Without the `array` keyword, `[1.0, 2.0, 3.0]` would be irreducibly ambiguous: is it a `vec3`, or a 3-element `float[3]`? Rather than pick a default and surprise the other case, the keyword makes the choice explicit and unambiguous at parse time, before any type inference runs — see `docs/architecture/ezsl-grammar.ebnf.md` for the exact grammar (`ArrayLiteral -> 'array' '[' Expression (',' Expression)* ']'`).

Array elements must all resolve to the *same* scalar/vector/matrix type (`resolvedTypesEqual` in `src/compiler/types.ts`) — a mixed-type array literal is a `CompileError`, matching GLSL ES's own requirement that an array have one element type. Indexing (`xs[i]`) is only valid on an array-typed expression; indexing anything else is a `CompileError` naming the actual type, not a generic "not indexable."

## User-defined functions (`fn`)

```
fn square(x) {
  return x * x
}
```

### Grammar

`fn name(param, ...) { statement* }` is a **top-level-only** declaration (`FunctionDeclaration` in `src/parser/ast.ts`) — it cannot be nested inside an `if`/`for` body or another function. `Program` now has two separate lists, `declarations: TopLevelDeclaration[]` (functions and structs) and `statements: Statement[]` (everything else), rather than one flat `Statement[]` — reflecting that `fn`/`struct` genuinely can't appear where an ordinary statement can. `ReturnStatement` (`return <expr>`) is a new statement kind, valid inside a function body (and, mechanically, inside any nested `if`/`for` within one — see below).

### Parameter types

**EZSL function parameters are always `float`** (v0.3 scope — this is a real, deliberate limitation, not an oversight): a parameter's type can't be inferred from its declaration site the way a local variable's type is inferred from its initializer expression, and v0.3 doesn't add parameter type annotations (`fn f(x: vec3)`) to the grammar. This means a function like `falloff(d)` in `examples/type-system/shader.ezsl` only works because its call sites (`falloff(length(...))`) happen to pass a `float`. Calling an EZSL function with a non-`float` argument is not specifically detected as a type mismatch by the compiler today (only the argument *count* is checked, same as `defineFunction` — see `docs/architecture/escape-hatch.md`) — it will compile, and then either work by GLSL's own implicit rules or fail at the driver, depending on the call. Explicit parameter type annotations are the natural next step if this proves limiting in practice; the `TypeAnnotation` AST node (used today for struct fields) already exists and could be reused for function parameters without a grammar redesign.

### Return-type inference

A function's return type is inferred by actually compiling its body in an isolated scope and looking at what its (first-encountered) `ReturnStatement` returns — there is no separate "infer the type" pass distinct from "compile the body"; they're the same walk. `emitStatementsInScope` (the same function that compiles `if`/`for` bodies) now also threads a `returned: TypedExpr | undefined` value outward, set whenever a `ReturnStatement` is compiled, and propagated up through nested `if`/`for` blocks inside a function body (the first branch's return type compiled "wins" if multiple `return`s with different implied paths exist — there is no check that *all* code paths return, or that they'd all return the *same* type, if a function has `return` under an `if` and not on the `else` branch; that's a real gap, see "What v0.3 deliberately doesn't check" below). A function with no `return` anywhere in its body is a `CompileError` — the roadmap explicitly asks for both "single-expression and multi-statement functions" to work, and both do, since there's no structural difference between them in this design: `fn f(x) { return x * x }` and `fn f(x) { y = x * x\n  return y }` compile through the identical code path, just with more `body` lines before the `return`.

### Isolated scope, no closures

`compileFunctionDeclaration` compiles each `fn`'s body in a fresh `TypeScope.withBuiltinsOnly()` (builtins `uv`/`time`/`resolution` are visible — matching plain GLSL function semantics, since those are actually GLSL globals, not EZSL locals) seeded only with that function's own parameters — **not** the calling program's locals. A function's local variables (like `helper` in `examples/type-system/shader.ezsl`'s pattern) never leak into the caller's `body` output; conversely, a function cannot read a local variable from the top-level program (there are no closures). A uniform referenced *inside* a function body (an identifier that's neither a builtin nor an already-declared local within that function) is still folded into the *program's* uniform set — uniforms are inherently global GLSL state, so this is correct behavior, not a scope leak; only per-invocation locals are isolated.

### Codegen placement and forward references

All `fn` declarations are compiled in one pass, before any top-level `statements` are compiled (right after struct registration — see below), and each compiles to a GLSL function definition collected into the codegen IR's `Program.topLevel` (same field `defineFunction`-injected custom functions and struct declarations use — see `docs/architecture/escape-hatch.md`). This means an EZSL function can be called from anywhere in the top-level program regardless of where in the source it was declared (GLSL itself requires forward declaration or declare-before-use within a single compilation unit, but since every `fn` is emitted at file scope before `main()` runs, this is a non-issue in the generated output — order among `topLevel` entries doesn't need to match declaration order in `.ezsl` source for GLSL's benefit, only structs currently have an implicit ordering assumption, covered below). EZSL functions **cannot currently call each other** in an order-independent way beyond this — see limitations below.

## Structs

```
struct Light {
  position: vec2,
  intensity: float
}
```

`struct Name { field: type, ... }` (`StructDeclaration`) is, like `fn`, a top-level-only declaration. Each field has a `TypeAnnotation` (`base` type name, optional `arraySize` for a fixed-size array field) — this is the same `TypeAnnotation` node used nowhere else yet (see the function-parameter-types note above for why it's positioned to be reused there).

### Registration and validation order

All structs are registered (name → declaration) in one pass over `ast.declarations` *before* any field-type validation or statement compilation happens, specifically so that **forward and self references between structs are allowed** — a field's declared type can name a struct declared later in the same file. Only after every struct name is known does a second pass validate that every field's declared type actually resolves to something (a builtin scalar/vector/matrix type or another registered struct); an unknown field type is a `CompileError` naming the offending struct/field. A struct name colliding with a builtin GLSL type name, or declared twice, is also a `CompileError`.

### Constructor calls and field access

A struct's name becomes callable as a constructor (`Light(position, intensity)`), positionally matching its declared fields in order — argument *count* is checked (a `CompileError` on mismatch), argument *types* are not currently cross-checked against declared field types (the same limitation `defineFunction` and `fn` calls both have — see above and `docs/architecture/escape-hatch.md`). Field access (`light.intensity`) reuses `MemberExpression` — the same AST node swizzles use — but a struct-typed object is dispatched to a completely separate code path in `compile.ts` before the swizzle logic runs at all (struct field names are arbitrary identifiers, not `x`/`y`/`z`/`w`/`r`/`g`/`b`/`a`, so there's no meaningful overlap to reconcile between the two).

### Codegen

Each struct compiles to a GLSL `struct Name { <type> <field>; ... };` declaration, collected into `Program.topLevel` *before* custom functions and EZSL functions (struct declarations must precede any function that uses the struct as a parameter or return type in GLSL — v0.3 doesn't yet support struct-typed function parameters/returns, but the ordering is future-proofed for when it does).

## What v0.3 deliberately doesn't check (known gaps, not oversights)

- **No exhaustive-return-path checking.** A function with `return` only inside an `if` (no `else`, or an `else` that doesn't also return) compiles today — GLSL itself would reject this as "not all paths return a value" at the driver, so the failure isn't silent, but it isn't caught at the EZSL layer with a `.ezsl`-relative message either. Worth revisiting if it turns out to be a common mistake in practice.
- **No cross-checking of call argument *types*** against a function's/struct's/custom-function's declared parameter types — only argument *count*. Consistent across `fn`, `defineFunction`, and struct constructors (see above); all three would benefit from the same fix at once if this becomes a real problem, since it's the same shape of gap in each.
- **EZSL functions can't take non-`float` parameters** — see "Parameter types" above.
- **No array-of-struct or struct-containing-array-field validated end-to-end** — the type machinery (`ResolvedType`, `TypeAnnotation.arraySize`) supports the shape, but this combination hasn't been exercised by an example or test yet.
- **`ROADMAP.md`'s v0.3 trap callout** (GLSL ES 1.00/WebGL1 forbids returning arrays from functions; the transpiler should detect context version and reject/flag this) **does not apply to the current implementation** — `src/runtime/bootstrap.ts`'s `mount()` only ever acquires a `webgl2` context (see `docs/architecture/transpiler-pipeline.md` Stage 5); there is no WebGL1 code path to guard. An EZSL function returning an array-typed value would compile today and either work or fail purely on GLSL ES 3.00's own rules (which do allow returning arrays, unlike ES 1.00). This should be revisited if/when a WebGL1 fallback target is ever added — not before, since there's nothing to protect against yet (the same reasoning that kept the v0.2 "consumed" DCE marker unbuilt — see `docs/architecture/escape-hatch.md`).

## Validated example

`examples/type-system/shader.ezsl` exercises every v0.3 feature together — a `struct Light` (`position`/`weight` fields), a single-expression `fn falloff(d)` with inferred `float` return type, a `mat2` rotation constructed from `sin`/`cos` and applied via `vec2 * mat2`, and an `array[...]` of per-light weights indexed by literal integers — and was confirmed to compile, link, and render correctly in an actual WebGL2 context (Chromium via Playwright): three animated point-light falloffs of different brightness, correctly positioned after the rotation. Run with `npm run example:type-system`.
