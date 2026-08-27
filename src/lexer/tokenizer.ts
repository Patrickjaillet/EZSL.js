import type { Token, TokenType } from "./tokens.js";

export class LexError extends Error {
  constructor(message: string, public line: number, public column: number) {
    super(`EZSL lex error at ${line}:${column}: ${message}`);
    this.name = "LexError";
  }
}

const SINGLE_CHAR_TOKENS: Record<string, TokenType> = {
  "+": "PLUS",
  "-": "MINUS",
  "*": "STAR",
  "/": "SLASH",
  "(": "LPAREN",
  ")": "RPAREN",
  "[": "LBRACKET",
  "]": "RBRACKET",
  "{": "LBRACE",
  "}": "RBRACE",
  ",": "COMMA",
  ":": "COLON",
};

const KEYWORDS: Record<string, TokenType> = {
  for: "FOR",
  in: "IN",
  if: "IF",
  else: "ELSE",
  glsl: "GLSL",
  fn: "FN",
  return: "RETURN",
  struct: "STRUCT",
  array: "ARRAY",
};

function isDigit(ch: string): boolean {
  return ch >= "0" && ch <= "9";
}

function isIdentifierStart(ch: string): boolean {
  return /[a-zA-Z_]/.test(ch);
}

function isIdentifierPart(ch: string): boolean {
  return /[a-zA-Z0-9_]/.test(ch);
}

/**
 * Tokenizes EZSL source into a flat token stream (v0.1 scope): numbers,
 * identifiers/keywords (`for`, `in`, `if`, `else`), arithmetic/comparison/
 * assignment operators, parens/brackets/braces for calls, vector literals,
 * and blocks, dot(s) for member access/swizzling and range syntax (`..`),
 * and newlines as statement separators. `//` line comments are stripped.
 */
export function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let pos = 0;
  let line = 1;
  let column = 1;

  function advance(): string {
    const ch = source[pos];
    pos++;
    if (ch === "\n") {
      line++;
      column = 1;
    } else {
      column++;
    }
    return ch;
  }

  function peek(offset = 0): string {
    return source[pos + offset] ?? "";
  }

  function push(type: TokenType, value: string, startLine: number, startColumn: number): void {
    tokens.push({ type, value, line: startLine, column: startColumn });
  }

  while (pos < source.length) {
    const startLine = line;
    const startColumn = column;
    const ch = peek();

    if (ch === " " || ch === "\t" || ch === "\r") {
      advance();
      continue;
    }

    if (ch === "\n") {
      advance();
      const last = tokens[tokens.length - 1];
      if (last && last.type !== "NEWLINE") {
        push("NEWLINE", "\n", startLine, startColumn);
      }
      continue;
    }

    if (ch === "/" && peek(1) === "/") {
      while (pos < source.length && peek() !== "\n") advance();
      continue;
    }

    if (isDigit(ch) || (ch === "." && isDigit(peek(1)))) {
      let value = "";
      while (isDigit(peek())) value += advance();
      if (peek() === "." && isDigit(peek(1))) {
        value += advance(); // consume '.'
        while (isDigit(peek())) value += advance();
      }
      push("NUMBER", value, startLine, startColumn);
      continue;
    }

    if (isIdentifierStart(ch)) {
      let value = "";
      while (isIdentifierPart(peek())) value += advance();
      const keyword = KEYWORDS[value];
      push(keyword ?? "IDENTIFIER", value, startLine, startColumn);

      // `glsl { ... }` — Escape Hatch: everything between the matching braces
      // is captured verbatim (raw GLSL, brace-depth tracked so nested GLSL
      // blocks like `if (...) { ... }` don't prematurely close the capture)
      // as a single RAW_GLSL_BLOCK token, bypassing normal EZSL tokenization.
      if (keyword === "GLSL") {
        let lookahead = pos;
        while (source[lookahead] === " " || source[lookahead] === "\t" || source[lookahead] === "\r" || source[lookahead] === "\n") {
          lookahead++;
        }
        if (source[lookahead] === "{") {
          while (pos < lookahead) advance();
          const braceLine = line;
          const braceColumn = column;
          advance(); // consume the opening '{'
          let depth = 1;
          let raw = "";
          while (pos < source.length && depth > 0) {
            const c = peek();
            if (c === "{") depth++;
            if (c === "}") {
              depth--;
              if (depth === 0) {
                advance(); // consume the closing '}'
                break;
              }
            }
            raw += advance();
          }
          if (depth !== 0) {
            throw new LexError("unterminated glsl { ... } block", braceLine, braceColumn);
          }
          push("RAW_GLSL_BLOCK", raw, braceLine, braceColumn);
        }
      }
      continue;
    }

    if (ch === "=") {
      advance();
      if (peek() === "=") {
        advance();
        push("EQUAL_EQUAL", "==", startLine, startColumn);
      } else {
        push("EQUAL", "=", startLine, startColumn);
      }
      continue;
    }

    if (ch === "<") {
      advance();
      if (peek() === "=") {
        advance();
        push("LESS_EQUAL", "<=", startLine, startColumn);
      } else {
        push("LESS", "<", startLine, startColumn);
      }
      continue;
    }

    if (ch === ">") {
      advance();
      if (peek() === "=") {
        advance();
        push("GREATER_EQUAL", ">=", startLine, startColumn);
      } else {
        push("GREATER", ">", startLine, startColumn);
      }
      continue;
    }

    if (ch === ".") {
      advance();
      if (peek() === ".") {
        advance();
        push("DOT_DOT", "..", startLine, startColumn);
      } else {
        push("DOT", ".", startLine, startColumn);
      }
      continue;
    }

    const single = SINGLE_CHAR_TOKENS[ch];
    if (single) {
      advance();
      push(single, ch, startLine, startColumn);
      continue;
    }

    throw new LexError(`unexpected character '${ch}'`, startLine, startColumn);
  }

  tokens.push({ type: "EOF", value: "", line, column });
  return tokens;
}
