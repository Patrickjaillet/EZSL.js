export type TokenType =
  | "NUMBER"
  | "IDENTIFIER"
  | "PLUS"
  | "MINUS"
  | "STAR"
  | "SLASH"
  | "EQUAL"
  | "EQUAL_EQUAL"
  | "LESS"
  | "LESS_EQUAL"
  | "GREATER"
  | "GREATER_EQUAL"
  | "LPAREN"
  | "RPAREN"
  | "LBRACKET"
  | "RBRACKET"
  | "LBRACE"
  | "RBRACE"
  | "COMMA"
  | "DOT"
  | "DOT_DOT"
  | "NEWLINE"
  | "FOR"
  | "IN"
  | "IF"
  | "ELSE"
  | "GLSL"
  | "RAW_GLSL_BLOCK"
  | "FN"
  | "RETURN"
  | "STRUCT"
  | "ARRAY"
  | "COLON"
  | "EOF";

export interface Token {
  type: TokenType;
  value: string;
  /** 1-based line number in the original .ezsl source, for error reporting and source maps. */
  line: number;
  /** 1-based column number in the original .ezsl source. */
  column: number;
}
