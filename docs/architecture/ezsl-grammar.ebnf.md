# EZSL Grammar — EBNF Specification

Formal grammar for the EZSL language as implemented by `src/lexer/tokenizer.ts` and `src/parser/parser.ts`. Notation follows ISO/IEC 14977 EBNF:

- `=` defines a production, terminated by `;`
- `|` alternation, `,` (implicit via juxtaposition) sequencing
- `[ x ]` optional (0 or 1), `{ x }` repetition (0 or more)
- `( x )` grouping
- `"..."` literal terminal
- `?...?` special sequence (informal terminal, defined in prose)

This document is the authoritative grammar reference. If it and the parser disagree, that is a bug — in either the code or this file — file it as such rather than treating one as automatically correct. See `docs/architecture/transpiler-pipeline.md` for the surrounding pipeline (tokenizer → parser → compiler → codegen → runtime) and the semantic rules (type inference, uniform declaration, etc.) layered on top of this syntax.

## Lexical grammar

Tokens produced by `tokenize()`. Whitespace (space, tab, `\r`) between tokens is insignificant and consumed silently. `//` starts a line comment, consuming through end-of-line. Consecutive newlines collapse into a single `NEWLINE` token; a `NEWLINE` is never emitted as the first token or immediately after another `NEWLINE`.

```ebnf
digit          = "0" | "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" ;
letter         = "a" | ... | "z" | "A" | ... | "Z" | "_" ;
identifier char = letter | digit ;

number         = digit , { digit } , [ "." , digit , { digit } ] ;
identifier raw = letter , { identifier char } ;

keyword        = "for" | "in" | "if" | "else" | "glsl" | "fn" | "return" | "struct" | "array" ;
identifier     = identifier raw - keyword ;   (* an identifier-raw that is not a keyword lexes as IDENTIFIER; a keyword lexes as its own token type *)

newline        = ?one or more consecutive U+000A characters, emitted as a single NEWLINE token? ;
line comment   = "//" , { ?any character except U+000A? } ;   (* discarded, produces no token *)
raw glsl block = ?everything between a "glsl" keyword's following "{" and its brace-depth-matched "}", captured verbatim as a single RAW_GLSL_BLOCK token — see "The glsl keyword is special-cased" below? ;
```

Operator and punctuation tokens (each is its own terminal in the syntactic grammar below):

```ebnf
"+"   "-"   "*"   "/"
"="   "=="
"<"   "<="  ">"   ">="
"("   ")"   "["   "]"   "{"   "}"
","   "."   ".."   ":"
```

Tokenizer notes that affect parsing:
- `=` followed immediately by `=` lexes as the single token `==`, never as two `=` tokens — likewise `<=`, `>=`, and `..` (vs. two separate `.` tokens). Maximal-munch applies throughout.
- A `number` requires at least one digit before an optional `.` + digits; a bare `.` (not preceded by a digit, and without a following digit) lexes as the `.` token, not as part of a number.
- **The `glsl` keyword is special-cased**: when `glsl` is immediately followed (across whitespace/newlines) by `{`, the lexer does not tokenize the block's contents as EZSL at all — it captures everything up to the brace-depth-matched `}` as one `raw glsl block` (`RAW_GLSL_BLOCK`) token, bypassing every other lexical rule above (a raw GLSL block may itself contain `{`/`}`, quotes, or anything else GLSL allows; none of it is re-tokenized as EZSL). `glsl` used any other way (not immediately followed by `{`) still lexes as the `GLSL` keyword token, not as `IDENTIFIER` — `glsl` is a reserved word regardless of context. See `docs/architecture/escape-hatch.md` for why (design rationale for the Escape Hatch mechanism as a whole, including what it deliberately does not implement, e.g. no "consumed" marker / no dead-code elimination).

## Syntactic grammar

```ebnf
program          = { newline } , { declaration | statement , { newline } } , eof ;

declaration      = function declaration | struct declaration ;

function declaration = "fn" , identifier , "(" , [ identifier , { "," , identifier } ] , ")" , block ;

struct declaration = "struct" , identifier , "{" , { newline } ,
                      [ struct field , { ( "," | newline ) , { newline } , struct field } ] ,
                      { newline } , "}" ;

struct field     = identifier , ":" , type annotation ;

type annotation  = identifier , [ "[" , number , "]" ] ;

statement        = assignment | if statement | for statement | raw glsl statement | return statement ;

return statement = "return" , expression ;

assignment       = identifier , "=" , expression ;

if statement     = "if" , comparison , block ,
                    [ "else" , ( if statement | block ) ] ;

for statement    = "for" , identifier , "in" , number , ".." , number , block ;

raw glsl statement = "glsl" , raw glsl block ;   (* the block's *contents* are opaque to this grammar by construction — see the lexical grammar above and docs/architecture/escape-hatch.md *)

block            = "{" , { newline } , { statement , { newline } } , "}" ;

comparison       = expression , [ comparison op , expression ] ;
comparison op    = "<" | "<=" | ">" | ">=" | "==" ;

expression       = term , { ( "+" | "-" ) , term } ;

term             = unary , { ( "*" | "/" ) , unary } ;

unary            = "-" , unary
                  | postfix ;

postfix          = primary , { member or method call | ( "[" , expression , "]" ) } ;

member or method call = "." , identifier , [ "(" , [ expression , { "," , expression } ] , ")" ] ;
(* with the trailing "(...)" present, this is a method call (v0.5 multi-pass: only
   `BufferName.sample(uv)` is semantically valid, but any `identifier.identifier(...)`
   parses); without it, ordinary member/swizzle access. See docs/architecture/multi-pass.md. *)

primary          = number
                  | call
                  | vector literal
                  | array literal
                  | identifier
                  | "(" , expression , ")" ;

call             = identifier , "(" , [ expression , { "," , expression } ] , ")" ;

vector literal   = "[" , [ expression , { "," , expression } ] , "]" ;

array literal    = "array" , "[" , [ expression , { "," , expression } ] , "]" ;
```

`eof` is the synthetic end-of-input token the lexer always appends. `declaration`s (`fn`/`struct`) and `statement`s may appear interleaved anywhere at the program's top level, but a `declaration` is **not** itself a `statement` and cannot appear nested inside a `block` — `fn`/`struct` are program-scope only (see `docs/architecture/type-system.md`).

### Notes on the grammar as written

- **`if`'s condition is a `comparison`, not a general `expression`** — `comparison` optionally applies one comparison operator to two `expression`s and is not itself recursive. There is no boolean connective (`&&`/`||`/`!`) in v0.1; `if a < b { }` parses, `if (a < b) and (c < d) { }` does not (no `and` keyword exists, and `comparison` cannot nest).
- **`for` loop bounds are `number` literals only**, not `expression` — `for i in 0..8 { }` parses; `for i in 0..(n+1) { }` does not. This is deliberate: the compiler needs both bounds statically known to emit a real GLSL `for (int i = a; i < b; i++)` and to reject an empty range (`to <= from`) at compile time.
- **Unary minus has no dedicated AST node** — `unary`'s `"-" , unary` alternative is parsed but *desugared* by the parser into a `BinaryExpression` (`0 - operand`) rather than producing a distinct `UnaryExpression`. The grammar above describes what can be *written*; `docs/architecture/transpiler-pipeline.md` describes what the parser *builds* from it.
- **`vector literal` accepts 0+ elements syntactically**; the 2–4 element constraint (GLSL has no `vec1`/`vec5+`) is enforced by the compiler (`CompileError`), not the parser — the grammar is deliberately permissive here and pushes that check to the semantic stage, consistent with how swizzle validity and type mismatches are also compiler-stage, not parser-stage, checks.
- **A trailing `NEWLINE` after a statement is consumed, not required** — `block`'s `{ statement , { newline } }` means zero or more newlines *may* follow each statement; a one-line block body (`if x < 1 { y = 1 }`) is syntactically well-formed with zero newlines inside the braces.
- **`postfix`'s repetition is unbounded**: `a.xyz.rgb.x` parses (chained member access), even though at most one non-trivial swizzle chain is meaningful for any given source type — that shape validity is, again, a compiler-stage check (`componentCount` in `src/compiler/typeInference.ts`), not a parser-stage one.
- **`array literal` accepts 0+ elements syntactically** (like `vector literal`), but an empty `array[]` is rejected — as a `CompileError`, not a parse error — since a zero-size array has no element type to infer. See `docs/architecture/type-system.md`.
- **`for` loop and function-parameter/struct-field identifiers share no special grammar** — a function's parameters (`function declaration`) are plain `identifier`s with no type annotation (function parameters are always inferred `float`; see `docs/architecture/type-system.md`'s "Parameter types" section for why), while a `struct field`'s type is a full `type annotation`. This asymmetry is deliberate, not an oversight: a struct field's type can't be inferred from anything (there's no initializer to infer it from), so it must be written out; a function parameter's *usage* inside the body is what determines what type makes sense, and v0.3 simply fixes that to `float` rather than adding inference or requiring annotations.

### What this grammar does not express

Two classes of constraint are real but sit outside this file on purpose, because they are not properties of *shape* — they require knowing types or specific identifier meanings, which the grammar has no way to encode:

- **Type/shape validity** — vector literal arity, swizzle validity vs. source type, function/struct-constructor argument counts (not yet argument *types* — see `docs/architecture/type-system.md`), `for`-loop range non-emptiness, array element-type consistency, array-index operand type (must be GLSL `int`, not `float`). Enforced by `src/compiler/compile.ts` and `src/compiler/typeInference.ts`; see `docs/architecture/transpiler-pipeline.md` Stage 3 and `docs/architecture/type-system.md`.
- **Identifier legality against the target language** — a `for`-loop or local variable name that happens to be a GLSL ES 3.00 reserved word (e.g. `half`, `sample`) parses as a perfectly valid `identifier` here, but is rejected at compile time (`isReservedGlslWord`) because it would otherwise emit invalid GLSL. Grammatically unremarkable; semantically illegal.

## Correspondence to the implementation

| Grammar production | Parser method |
|---|---|
| `program` | `Parser.parseProgram` |
| `function declaration` | `Parser.parseFunctionDeclaration` |
| `struct declaration` | `Parser.parseStructDeclaration` |
| `struct field` | `Parser.parseStructField` |
| `type annotation` | `Parser.parseTypeAnnotation` |
| `statement` | `Parser.parseStatement` |
| `return statement` | `Parser.parseReturnStatement` |
| `assignment` | `Parser.parseAssignment` |
| `if statement` | `Parser.parseIfStatement` |
| `for statement` | `Parser.parseForStatement` |
| `raw glsl statement` | `Parser.parseRawGlslStatement` |
| `block` | `Parser.parseBlock` |
| `comparison` | `Parser.parseComparison` |
| `expression` | `Parser.parseExpression` |
| `term` | `Parser.parseTerm` |
| `unary` | `Parser.parseUnary` |
| `postfix` | `Parser.parsePostfix` |
| `primary` / `call` / `vector literal` / `array literal` | `Parser.parsePrimary` |

All in `src/parser/parser.ts`. The lexical grammar corresponds to `tokenize()` in `src/lexer/tokenizer.ts`; token type names are listed in `src/lexer/tokens.ts`.
