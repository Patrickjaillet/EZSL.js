# EZSL Language Specification — v1.0

**Status**: Normative. This document, together with `docs/architecture/ezsl-grammar.ebnf.md` (the authoritative lexical/syntactic grammar, referenced throughout rather than duplicated here), is the formal specification for the EZSL language as of the `v1.0.0` API freeze — see `docs/API_STABILITY.md`. `docs/ezsl-language-reference.md` remains available as an informal, tutorial-style introduction; where the two disagree, this document and the EBNF are authoritative.

Implementation reference: `src/lexer/tokenizer.ts` (lexing), `src/parser/parser.ts` (parsing), `src/compiler/compile.ts` + `src/compiler/typeInference.ts` (semantic analysis and type inference), `src/codegen/glslGenerator.ts` (GLSL ES 3.00 code generation).

## 1. Scope

This specification covers the EZSL language surface through v0.7.x: core expressions/statements/control-flow (§4–6), user-defined functions and structs (§7–8), fixed-size arrays (§6.4), the Escape Hatch (§9), the fragment-stage builtin environment (§10), the vertex-stage builtin environment for Three.js integration (§11), and inter-pass buffer sampling for multi-pass rendering (§12). It does not cover the experimental WGSL/WebGPU output target (§13, out of scope by explicit exclusion — see `docs/API_STABILITY.md`), nor any JavaScript-side runtime/integration API (`mount()`, `createPipeline()`, `createThreeMaterial()`, etc. — those are documented as ordinary TypeScript API surface, not language semantics, in their own `docs/architecture/*.md` design docs).

## 2. Conformance

An implementation is conformant with this specification if, for every EZSL program within scope (§1):
1. It accepts exactly the programs the grammar in `docs/architecture/ezsl-grammar.ebnf.md` accepts, and rejects (with a `LexError` or `ParseError`) every input that grammar rejects.
2. It performs type inference and validation per §5–§12 below, rejecting a program that violates any rule stated as a `CompileError` condition, and accepting every program that satisfies all such rules.
3. It generates GLSL ES 3.00 output that preserves the source program's specified semantics (§4–§12) — this specification does not mandate a specific generated GLSL *text* shape, only that its runtime behavior match.

The reference implementation (`src/`) is conformant by construction; this document exists to make that conformance checkable independent of reading the implementation.

## 3. Lexical and syntactic grammar

Delegated entirely to `docs/architecture/ezsl-grammar.ebnf.md`. Every EZSL program is, syntactically, a sequence of top-level `declaration`s (`fn`/`struct`, order-independent within their own kind, see §7.4/§8.1) and `statement`s (assignments, `if`, `for`, `glsl {}`, `return`), each possibly separated by `NEWLINE` tokens.

## 4. Values and types

### 4.1 The type universe

Every EZSL value has exactly one of the following types at compile time (no runtime type information exists — GLSL is statically typed and EZSL inherits this fully):

| Type | GLSL equivalent | Component count (§4.4) |
|---|---|---|
| `float` | `float` | 1 |
| `vec2` | `vec2` | 2 |
| `vec3` | `vec3` | 3 |
| `vec4` | `vec4` | 4 |
| `mat2` | `mat2` | 4 |
| `mat3` | `mat3` | 9 |
| `mat4` | `mat4` | 16 |
| `int` | `int` | 1 |
| `bool` | `bool` | 1 |
| `sampler2D` | `sampler2D` | n/a — never swizzled or used in arithmetic (§12) |
| a fixed-size array `T[N]` | `T[N]` | n/a |
| a struct instance `S` | `struct S` | n/a |

`int` values arise **only** as a `for`-loop counter (§6.3) — there is no `int` literal syntax, and no way to declare a local as `int` other than that. `bool` values arise **only** as the result of a comparison (§6.2) and are usable **only** as an `if`/`for`-adjacent condition — a `bool` cannot be assigned to a variable, passed as a function argument, or combined with `&&`/`||`/`!` (no such operators exist in this version of the language; see §14 for known non-goals).

### 4.2 Type inference model

EZSL has no type-annotation syntax for local variables (only struct fields, §8.2, and the implicit type of a `for`-loop counter, §6.3, are ever type-*declared* rather than *inferred*). Every local variable's type is inferred, once, from the expression assigned to it at its **first** assignment (§5.1). This is a purely syntactic, single-pass, forward inference — there is no unification, no bidirectional inference, and no way for a later use of a variable to retroactively affect an earlier inference decision.

### 4.3 Type equality

Two `ResolvedType` values (the compiler's internal type representation, `src/compiler/types.ts`) are equal (`resolvedTypesEqual`) if and only if:
- Both are the same scalar/vector/matrix `EzslType`, or
- Both are arrays of the same element type and the same size, or
- Both are struct instances of the same declared struct name.

Type equality is nominal for structs (name-based, not structural) and exact for arrays (element type *and* size must match — a `float[3]` and a `float[4]` are different types).

### 4.4 Component count

`componentCount(T)` is defined for every scalar/vector/matrix type as the number of scalar components: 1 for `float`/`int`/`bool`, 2/3/4 for `vec2`/`vec3`/`vec4`, 4/9/16 for `mat2`/`mat3`/`mat4`. It is used exclusively for swizzle-letter validation (§6.5) and is **not** a general "is this type indexable/swizzlable" predicate — matrix swizzling is explicitly and separately rejected (§6.5) despite matrices having a defined component count, since GLSL itself has no matrix swizzle syntax.

## 5. Assignment and scope

### 5.1 First assignment declares; subsequent assignment re-assigns

```ebnf
assignment = identifier , "=" , expression ;
```

For a given `identifier` within a given lexical scope (§5.2):
- The **first** assignment to that name **declares** it: its type is inferred from the right-hand expression (§4.2), and a corresponding GLSL local variable declaration (`<type> <name> = <expr>;`) is emitted.
- **Every subsequent** assignment to that same name, within the same or a nested scope that can see it, **re-assigns** it: the right-hand expression's type **must** equal (§4.3) the type established at first assignment, or the compiler raises `CompileError: cannot re-assign '<name>' (<existingType>) with a value of type <newType>`. A bare re-assignment (`<name> = <expr>;`) is emitted, with no type prefix.

There is no way to shadow an already-declared name with a different type within the same function/program scope — EZSL has no block-scoping construct that would make that safe in the generated GLSL (an `if`/`for` body shares its enclosing scope's variable declarations, not a fresh one — §5.3).

### 5.2 The top-level output assignment

At program top level (not nested inside any `if`/`for`/`fn` body) only, an assignment to the reserved output name — `color` for a fragment-stage program (§10), `glPosition` for a vertex-stage program (§11) — is **not** emitted as an ordinary local declaration/assignment. Instead, it becomes the program's required output expression (`Program.outColor` / `VertexProgram.outPosition` in the codegen IR). A program that never assigns its output name at top level, anywhere, is a `CompileError: program must assign to '<outputName>'`. The output expression must resolve to a scalar/vector type (§4.1) — assigning an array or struct to it is a `CompileError`, since GLSL has no array- or struct-valued fragment/vertex output. For the fragment stage specifically, a non-`vec4` output expression is automatically widened to `vec4(<expr>, 1.0)` (opaque alpha) — an already-`vec4` expression is used as-is.

An assignment to the output name **inside** a nested `if`/`for` body is *not* treated specially — it is an ordinary local re-assignment (§5.1) to a name that happens to also be the reserved output identifier, only the **last** top-level assignment (outside any nested block) determines the actual program output.

### 5.3 Nested scope (`if`/`for`)

`if`/`for` bodies (§6.6/§6.3) do not introduce a new GLSL-level variable scope — a name first assigned inside an `if`/`for` body is declared in that body's generated GLSL block (matching GLSL's own block-scoping rules: it is not visible after the block closes), but a name **already** declared in an enclosing scope, re-assigned inside a nested body, re-assigns the same enclosing-scope variable (this is the mechanism by which loop-accumulated state — e.g. a raymarching `t`/`hit` accumulator — is expressed; see `docs/architecture/transpiler-pipeline.md`).

### 5.4 Reserved-identifier rejection

A local variable name, or a `for`-loop counter name (§6.3), that is a GLSL ES 3.00 reserved word (the full list is `isReservedGlslWord` in `src/compiler/typeInference.ts`) is rejected at compile time: `CompileError: '<name>' is a reserved GLSL keyword and cannot be used as a variable name`. This exists because such a name would otherwise compile successfully at the EZSL layer and only fail — opaquely, with no `.ezsl`-relative context — at the WebGL driver. User-declared uniforms (§5.5) are exempt, since they are always emitted with a `u_` prefix in generated GLSL and can never collide with a GLSL reserved word as a result.

### 5.5 Implicit uniform declaration

Any identifier referenced in an expression that is **not** a builtin (§10/§11) and has **not** been assigned as a local variable anywhere earlier in the program is treated as an implicit **uniform**: a value supplied from the host environment (JavaScript), not computed within the shader. A uniform's type defaults to `float` on its first reference, unless that first reference is a member-access expression using a swizzle letter set that unambiguously identifies a wider vector type (§6.5) — there is no other way to declare a uniform's type. Every distinct uniform name used anywhere in a program appears exactly once in the compiled `Program.uniforms`/`VertexProgram.uniforms` list, bound to a GLSL `uniform <type> u_<name>;` declaration.

## 6. Expressions and operators

### 6.1 Arithmetic operators

`+ - * /`, left-associative, standard precedence (`* /` bind tighter than `+ -`; see the EBNF's `expression`/`term` productions). Operand-type validity:
- If either operand is `float`, the result type is the *other* operand's type (scalar broadcast — matches GLSL's own `float * vecN`/`vecN * float` etc. semantics).
- If both operands are non-`float` and have the *same* type, the result is that type.
- The one GLSL-legal mixed non-`float` case: `vecN * matN` or `matN * vecN` (same `N`) — result type `vecN`.
- Any other combination of two distinct non-`float` types (e.g. `vec2 + vec3`) is a `CompileError` naming both mismatched types — this is a validity check, not merely a result-type computation; a shape-incompatible binary expression must be rejected before any GLSL is emitted, not left for the driver to reject.

Unary `-x` is accepted by the grammar and desugars, during parsing, to the binary expression `0 - x` — there is no distinct unary-negation AST node or GLSL codegen path; it is indistinguishable, downstream of parsing, from an explicitly-written `0 - x`.

### 6.2 Comparison operators

`< <= > >= ==`, producing a `bool`-typed result usable **only** as the condition of an `if` (§6.6) or, indirectly, is not applicable to `for` (§6.3, whose bounds are literals, not a `bool` condition). A comparison is not a general expression — see `docs/architecture/ezsl-grammar.ebnf.md`'s note that `if`'s condition is `comparison`, not the recursive `expression` production, and cannot be combined with another comparison (no `&&`/`||`; §14).

### 6.3 The `for` statement

```ebnf
for statement = "for" , identifier , "in" , number , ".." , number , block ;
```

Both bounds **must** be literal integer `number` tokens known at compile time (not expressions, not variables) — this is a grammar-level restriction (§ EBNF `for statement`), not merely a semantic check, since the compiler needs both bounds statically known to emit a real GLSL `for (int <var> = <from>; <var> < <to>; <var>++) { ... }` and to detect an empty range. A range where `to <= from` is a `CompileError: for-loop range <from>..<to> is empty (end must be greater than start)`. The loop counter identifier is declared with type `int` for the duration of the loop body (§5.3); using it in a `float` context requires an explicit `float(<var>)` cast (§6.7). The counter identifier is subject to reserved-word rejection (§5.4).

### 6.4 Fixed-size arrays

```ebnf
array literal = "array" , "[" , [ expression , { "," , expression } ] , "]" ;
```

`array[e1, e2, ...]` (the `array` keyword prefix distinguishes this from a bare `[e1, e2, e3]` vector literal, §6.8 — without the keyword, a bracketed list is unconditionally read as a vector literal). Every element expression must resolve to the *same* type (§4.3); a mixed-type array literal is a `CompileError`. An array literal with zero elements (`array[]`) is syntactically well-formed but a `CompileError` at the semantic stage — a zero-size array has no element type to infer.

**Indexing** (`expr[index]`, part of the `postfix` production) is valid only when `expr` resolves to an array type; indexing a non-array-typed expression is a `CompileError` naming the actual type. The `index` expression must resolve to GLSL `int` — either a literal integer (emitted without EZSL's usual `.0` float-literal suffix) or an already-`int`-typed expression (in practice, only a `for`-loop counter, §6.3, or an expression built from one). A `float`-typed index — even a literal whole number written as a `float`-inferred expression — is a `CompileError`, since GLSL itself has no implicit `float`→`int` array-subscript coercion.

### 6.5 Swizzles

```ebnf
member or method call = "." , identifier , [ "(" , [ expression , { "," , expression } ] , ")" ] ;
```

Without the trailing `(...)`, `.identifier` on a vector- or scalar-typed expression is a **swizzle**: 1–4 letters, each drawn from either the positional set (`x y z w`) or the color set (`r g b a`) — not mixed within one swizzle — where every letter used must be a valid component of the source type's component count (§4.4): only `x`/`y` (or `r`/`g`) are valid on a `vec2`, `x`/`y`/`z` (or `r`/`g`/`b`) on a `vec3`, all four on a `vec4`; a `float` accepts no swizzle letters at all (a `float` has no components to select). **Repetition is permitted** — `v.xyx` on a `vec2` is a legal 3-letter swizzle producing a `vec3`, since GLSL itself allows repeating swizzle components; validity is a per-letter membership check against the source type, never a length comparison against the source's component count. **Swizzling a matrix type is unconditionally rejected** (`CompileError`) regardless of the requested letters — GLSL has no matrix swizzle syntax at all, and `componentCount` (§4.4) returning a nonzero value for matrix types must not be mistaken for swizzle-eligibility.

### 6.6 The `if` statement

```ebnf
if statement = "if" , comparison , block , [ "else" , ( if statement | block ) ] ;
```

Compiles to a real GLSL `if`/`else if`/`else` chain with no semantic transformation — an EZSL `if` and a hand-written GLSL `if` behave identically at runtime, with no performance difference. See §5.3 for the scoping rule governing assignments inside the body.

### 6.7 Function calls

Two disjoint categories of callable name:
- **Type constructor/cast** (`float(...)`, `vec2(...)`, ..., `mat4(...)`) — takes its declared type; argument handling matches GLSL's own constructor overload rules (component-wise construction, widening, truncation), delegated to the GLSL driver rather than independently validated by EZSL.
- **Builtin function** (§10.2) — split into `FIXED_RETURN_FUNCTIONS` (always return `float` regardless of argument type — `length`, `dot`, `sin`, etc.) and `SHAPE_PRESERVING_FUNCTIONS` (return type matches/widens to the argument's vector shape — `mix`, `clamp`, `abs`, `normalize`, etc.). This bucketing is a compiler-internal implementation concern, not user-visible syntax, but its correctness is user-visible: conflating the two buckets for a given builtin produces a wrongly-inferred result type (a real historical bug, previously fixed and covered by a regression test — see `length(vec3)` in `tests/typeInference.test.ts`).
- **User-defined function** (`fn`, §7) or **custom GLSL function** (`defineFunction`, §9.2) — return type is whatever was inferred (§7.3) or declared (§9.2) for that function.

In every case, **argument count** is validated (a `CompileError` on mismatch); **argument type** is **not** cross-checked against a declared/inferred parameter type for `fn`/`defineFunction`/struct-constructor calls (§7.2, §8.3) — this is a known, documented gap (§14), not an oversight.

### 6.8 Vector literals

```ebnf
vector literal = "[" , [ expression , { "," , expression } ] , "]" ;
```

A bracketed list of 2–4 expressions infers `vec2`/`vec3`/`vec4` respectively, matching the element count. The grammar itself accepts 0+ elements (permissive by design, per `docs/architecture/ezsl-grammar.ebnf.md`); the 2–4 element constraint (GLSL has no `vec1` or `vec5+`) is enforced as a `CompileError` at the semantic stage, not a parse error.

## 7. User-defined functions (`fn`)

### 7.1 Declaration and scope

```ebnf
function declaration = "fn" , identifier , "(" , [ identifier , { "," , identifier } ] , ")" , block ;
```

Top-level only — a `fn` declaration cannot be nested inside an `if`/`for` body or another `fn`. A function's body is compiled in an **isolated scope**, seeded only with its own parameters (§7.2) plus the fragment/vertex-stage builtins (§10/§11) — it cannot read or write the calling program's local variables (no closures), and its own locals never leak into the caller's generated GLSL. A uniform referenced inside a function body is still folded into the *program's* global uniform set (§5.5) — uniforms are inherently global GLSL state, unaffected by EZSL's function-scope isolation.

### 7.2 Parameters

Every `fn` parameter is inferred **`float`**, unconditionally — there is no parameter-type-annotation syntax in this version of the language (`docs/architecture/ezsl-grammar.ebnf.md`'s `function declaration` production allows only bare `identifier` parameters, no `type annotation`). A function is only guaranteed to behave correctly when every call site happens to pass a `float`-compatible argument; passing a non-`float` argument is not itself rejected (§6.7) — it will either compile successfully with GLSL's own implicit-conversion behavior or fail at the driver, depending on the specific combination.

### 7.3 Return-type inference

A function's return type is determined by compiling its body and observing the type of its first-encountered `return` expression — there is no separate "type inference pass" distinct from body compilation. A `return` inside a nested `if`/`for` propagates its type outward the same way. A function whose body contains **no** `return` statement anywhere is a `CompileError`. **Not validated**: that all control-flow paths through the function body actually reach a `return` (a function that only returns inside an `if` with no `else` compiles at the EZSL layer — GLSL itself would then reject the resulting driver-level "not all paths return a value," which is not silent, but also not caught with `.ezsl`-relative context), and that multiple `return` statements along different paths all agree on type (the first one compiled is authoritative; a mismatch is not specifically detected).

### 7.4 Ordering and forward references

Every `fn` declaration is compiled in one pass, before any top-level statement, and emitted at GLSL file scope (above `main()`) — an EZSL function is callable from anywhere in the program regardless of its declaration's position relative to its call sites in the `.ezsl` source (GLSL's own declare-before-use requirement is satisfied because every function is emitted before `main()` regardless of source order). EZSL functions calling **each other** in an order-independent way beyond this is not currently supported as a validated feature.

## 8. Structs

### 8.1 Declaration

```ebnf
struct declaration = "struct" , identifier , "{" , { newline } , [ struct field , { ( "," | newline ) , { newline } , struct field } ] , { newline } , "}" ;
struct field        = identifier , ":" , type annotation ;
type annotation      = identifier , [ "[" , number , "]" ] ;
```

Top-level only, like `fn`. All structs in a program are registered (name → declaration) in a single pass *before* any field-type validation, specifically permitting **forward and self-references** between structs — a field may name a struct declared later in the same file. A struct name that collides with a builtin scalar/vector/matrix type name, or is declared more than once, is a `CompileError`.

### 8.2 Field types

Unlike a local variable (§4.2, always inferred), a struct field's type is **always explicit** (`type annotation`) — there is no initializer expression to infer a field's type from. After struct-name registration (§8.1), a second pass validates that every field's declared type resolves to either a builtin scalar/vector/matrix type or another registered struct name; an unresolvable field type is a `CompileError` naming the offending struct and field.

### 8.3 Construction and field access

A struct's declared name becomes callable as a **constructor**, taking arguments positionally in field-declaration order (`Light(position, intensity)`). Argument *count* is validated (`CompileError` on mismatch); argument *type* is not cross-checked against declared field types (§6.7's general gap). Field access (`instance.fieldName`) reuses the same `member or method call` grammar production as swizzles (§6.5) but is dispatched to a wholly separate code path once the source expression's type is known to be a struct instance — struct field names are arbitrary identifiers, not drawn from the fixed `x y z w` / `r g b a` swizzle-letter sets, so there is no ambiguity between the two once the source type is known.

## 9. The Escape Hatch

### 9.1 `glsl { ... }` raw statement blocks

```ebnf
raw glsl statement = "glsl" , raw glsl block ;
```

A `glsl { ... }` statement's contents, between the brace-depth-matched `{`/`}`, are captured **verbatim** by the lexer as a single opaque token (§ EBNF lexical grammar) and never tokenized, parsed, or type-checked as EZSL — they are copied into the generated GLSL output essentially unmodified, at the position (relative to surrounding EZSL statements) they appear in source. Consequently:
- A raw block may read and write any EZSL local variable or uniform already in scope at that point in the program, by referencing it under its plain (locals) or `u_`-prefixed (uniforms, §5.5) GLSL name — no special syntax is required, but the compiler cannot verify correctness of any such reference; a mistake inside a raw block surfaces only as a WebGL driver-level error (translated per `docs/architecture/error-translation.md` where possible).
- The one check EZSL still performs on a raw block's contents is a **textual, regex-based collision scan**: if the block appears to *declare* a local (`<glslType> <name>` / `<name> =`) whose name is already an EZSL local or uniform in scope, this is flagged as a `CompileError` at compile time — since GLSL has no block scoping that would make such a redeclaration safe, this is almost always an accidental collision, not intentional shadowing. This is not a full GLSL parser and can both miss real collisions (e.g. ones obscured by macro expansion) and, more conservatively, is not expected to false-positive on well-formed GLSL.
- `#define`/`#ifdef` preprocessor directives are supported as a free consequence of verbatim injection — no special handling exists or is needed.

### 9.2 `defineFunction` (JavaScript-side custom GLSL functions)

Not part of the EZSL grammar — a JavaScript-level API (`defineFunction(name, glslSource, signature)`, passed via `compileEzsl(source, { customFunctions: [...] })`) that registers a hand-written GLSL function, callable from `.ezsl` source by `name` like any other function (§6.7), with its return type and parameter types taken exactly as declared in `signature` (no inference — the caller states them). Emitted verbatim into `Program.topLevel`, above `main()`, alongside `fn`-declared and struct-declaration output (§7.4, §8.1).

## 10. The fragment-stage builtin environment

The default stage (`CompileOptions.stage` unset or `"fragment"`). Every fragment-stage program has the following identifiers in scope from the start, requiring no declaration:

### 10.1 Builtin values

| Name | Type | Meaning |
|---|---|---|
| `uv` | `vec2` | Normalized fragment coordinate, range `[0,1]` on each axis, with `(0,0)` at the **top-left** and `(1,1)` at the bottom-right — deliberately Y-flipped from raw GLSL's `gl_FragCoord` convention (bottom-left origin) to match beginner/Canvas2D mental models. |
| `time` | `float` | Seconds elapsed since the shader started rendering, bound to a host-supplied `u_time` uniform. |
| `resolution` | `vec2` | Canvas size in pixels, bound to a host-supplied `u_resolution` uniform. |
| `color` | `vec4` (write-only) | The reserved top-level output name (§5.2) — not a readable value; assigning to it at program top level sets the fragment's output color. |

### 10.2 Builtin functions

GLSL-name-identical, same semantics: `sin cos tan atan sqrt length dot abs mix clamp smoothstep fract floor mod max min pow exp normalize cross reflect step`, plus the type constructor/cast functions `float() vec2() vec3() vec4() mat2() mat3() mat4()` (§6.7).

## 11. The vertex-stage builtin environment

Entered via `CompileOptions.stage = "vertex"` (only reachable through `compileEzslVertex`, not directly exposed on `compileEzsl`/`compile`'s public-facing options — the vertex-stage result shape, `VertexProgram`, also differs from `Program`; see `docs/architecture/three-integration.md`). Designed for authoring Three.js vertex shaders (`createThreeMaterial`); the environment differs from fragment-stage (§10) in both which builtins exist and the required output name:

| Name | Type | Meaning |
|---|---|---|
| `position` | `vec3` | Per-vertex local-space position attribute — supplied by Three.js for any `BufferGeometry`. |
| `normal` | `vec3` | Per-vertex surface normal attribute — likewise Three.js-supplied. |
| `modelMatrix`, `modelViewMatrix`, `projectionMatrix` | `mat4` | Three.js's own camera/model transform uniforms, under their real Three.js names (no `u_` prefix — these are not EZSL-declared uniforms; Three.js populates them itself every frame). |
| `normalMatrix` | `mat3` | Three.js's own normal-transform uniform, same naming convention. |
| `glPosition` | `vec4` (write-only) | The reserved top-level output name for this stage (§5.2) — a vertex shader has no fragment color to produce; its required output is clip-space position. |

`time`/`resolution`/`uv`/`color` (§10) are **not** in scope in the vertex stage — referencing any of them here falls through to implicit-uniform treatment (§5.5) like any other undeclared identifier, which is very likely not the intended behavior for a name like `time` and should be treated as user error, not a language feature to rely on. `Program.topLevel` (custom functions, structs) is not currently supported for vertex-stage programs — a v0.6-scope limitation, not a v1.0 language restriction, but not exercised or validated as of this specification.

## 12. Multi-pass buffer sampling

Entered via `CompileOptions.bufferNames: string[]` (supplied automatically by `createPipeline()`'s orchestration — see `docs/architecture/multi-pass.md`; not meaningful to set directly outside that context). Each name in `bufferNames` becomes recognized, for the duration of that one `compile()` call, as a **buffer reference** rather than an ordinary identifier:

```ebnf
member or method call = "." , identifier , [ "(" , [ expression , { "," , expression } ] , ")" ] ;
```

`<BufferName>.sample(<uv-expr>)` — the `member or method call` production *with* the trailing parenthesized argument list present — is the only semantically valid use of a name listed in `bufferNames`; it compiles to `texture(u_buffer_<BufferName>, <uv-expr>)`, sampling that other rendering pass's most recently completed frame (including the *same* pass referencing itself, §12.1). A bare reference to a buffer name with no `.sample(...)` call (e.g. using it as an ordinary value, or calling `.sample` with the wrong argument count) is a `CompileError` — a buffer name is not an ordinary value-typed identifier and cannot be used as one.

### 12.1 Self-reference (feedback buffers)

A pass sampling **itself** (`BufferName.sample(uv)` inside the `BufferName` pass's own source) is not treated as a same-frame dependency cycle — it is a legitimate **feedback buffer** pattern (accumulation/trail effects), implemented at the runtime level via ping-pong double-buffering (two render targets, alternating read/write roles each frame — see `docs/architecture/multi-pass.md`). A genuine cross-pass cycle (pass A samples pass B, and pass B samples pass A, within the same frame, with neither being a self-reference) **is** rejected — as a pipeline-construction-time error, before any WebGL context is created, not a runtime hang or corrupted render.

## 13. Explicitly out of scope for this specification

- **The experimental WGSL/WebGPU code generation target** (`generateWgslFragmentShader` and related, `src/codegen/wgsl/`) — this generates a *different* output language from a compiled EZSL `Program`, but the EZSL *language itself* (what's specified in §1–§12 above) is unaffected; the WGSL target's own behavior, capability matrix, and validation status are documented separately in `docs/architecture/webgpu-target.md`, and explicitly excluded from this specification's normative status per `docs/API_STABILITY.md`.
- **JavaScript/TypeScript-side runtime and integration APIs** (`mount()`, `mountToCanvas2D()`, `createPipeline()`, `createThreeMaterial()`, the CLI, the dev server, DevTools source-map support, the VS Code extension) — these consume a compiled EZSL program but are not themselves part of the EZSL *language*; each has its own `docs/architecture/*.md` design doc, and its API surface (where exported from the package root) is covered by `docs/API_STABILITY.md` directly rather than by this language specification.

## 14. Known non-goals and gaps (as of v1.0)

Stated here explicitly, as a specification-level commitment about what v1.0 does *not* promise, not merely an implementation TODO list:

- **No boolean connectives** (`&&`, `||`, `!`) — an `if` condition (§6.6) is a single `comparison` (§6.2), never a combination of comparisons.
- **No function-parameter type annotations** (§7.2) — every `fn` parameter is `float`, unconditionally.
- **No nested/local `fn` or `struct` declarations** — both are program-scope only (§7.1, §8.1).
- **No general-purpose loops** — only bounded `for i in a..b { }` with compile-time-literal-integer bounds (§6.3); no `while`, no unbounded `for`.
- **No argument-type checking** for `fn`/`defineFunction`/struct-constructor calls (§6.7, §7.2, §8.3) — only argument *count* is validated.
- **No exhaustive-return-path checking** for `fn` bodies (§7.3).
- **No struct-typed or array-typed program output** (§5.2) — the top-level output must resolve to a scalar/vector type.
- **No vertex-stage `topLevel` support** (custom functions/structs) as of this specification (§11).

A future minor version of this specification may add any of the above as a **backward-compatible extension** (new syntax, wider acceptance) without requiring a major version bump — per `docs/API_STABILITY.md`'s general "adding capability is not breaking" principle, applied here to the language surface specifically. Removing or narrowing any currently-accepted program's behavior would require a major version bump under the same policy.
