import type { Token } from "../lexer/tokens.js";
import type {
  AssignmentStatement,
  BinaryOperator,
  ComparisonOperator,
  Expression,
  ForStatement,
  FunctionDeclaration,
  IfStatement,
  Program,
  RawGlslStatement,
  ReturnStatement,
  Statement,
  StructDeclaration,
  StructField,
  TopLevelDeclaration,
  TypeAnnotation,
} from "./ast.js";

export class ParseError extends Error {
  constructor(message: string, public line: number, public column: number) {
    super(`EZSL parse error at ${line}:${column}: ${message}`);
    this.name = "ParseError";
  }
}

const COMPARISON_TOKEN_TO_OP: Record<string, ComparisonOperator> = {
  LESS: "<",
  LESS_EQUAL: "<=",
  GREATER: ">",
  GREATER_EQUAL: ">=",
  EQUAL_EQUAL: "==",
};

/**
 * Recursive-descent parser for the EZSL grammar (see docs/architecture/ezsl-grammar.ebnf.md
 * for the authoritative EBNF — this comment is a quick-reference summary, not the source of truth):
 *
 *   Program          -> (Declaration | Statement)* EOF
 *   Declaration      -> FunctionDeclaration | StructDeclaration
 *   FunctionDeclaration -> 'fn' IDENTIFIER '(' (IDENTIFIER (',' IDENTIFIER)*)? ')' Block
 *   StructDeclaration -> 'struct' IDENTIFIER '{' NEWLINE? (StructField (',' NEWLINE? StructField)*)? NEWLINE? '}'
 *   StructField      -> IDENTIFIER ':' TypeAnnotation
 *   TypeAnnotation   -> IDENTIFIER ('[' NUMBER ']')?
 *   Statement        -> Assignment | IfStatement | ForStatement | RawGlslStatement | ReturnStatement
 *   ReturnStatement  -> 'return' Expression
 *   RawGlslStatement -> 'glsl' RAW_GLSL_BLOCK   (* content captured verbatim by the lexer *)
 *   Assignment       -> IDENTIFIER '=' Expression NEWLINE?
 *   IfStatement      -> 'if' Comparison Block ('else' (IfStatement | Block))?
 *   ForStatement     -> 'for' IDENTIFIER 'in' NUMBER '..' NUMBER Block
 *   Block            -> '{' NEWLINE? Statement* '}'
 *   Comparison       -> Expression (('<' | '<=' | '>' | '>=' | '==') Expression)?
 *   Expression       -> Term (('+' | '-') Term)*
 *   Term             -> Unary (('*' | '/') Unary)*
 *   Unary            -> '-' Unary | Postfix
 *   Postfix          -> Primary ( ( '.' IDENTIFIER ( '(' (Expression (',' Expression)*)? ')' )? ) | '[' Expression ']' )*
 *   Primary          -> NUMBER | Call | VectorLiteral | ArrayLiteral | IDENTIFIER | '(' Expression ')'
 *   Call             -> IDENTIFIER '(' (Expression (',' Expression)*)? ')'
 *   VectorLiteral    -> '[' Expression (',' Expression)* ']'
 *   ArrayLiteral     -> 'array' '[' Expression (',' Expression)* ']'
 */
// The parser's expression grammar is a recursive-descent cycle
// (parseExpression -> parseTerm -> parseUnary -> parsePostfix ->
// parsePrimary -> back to parseExpression for a parenthesized
// sub-expression, e.g. "(((...)))") with no other bound on nesting depth
// than the JS call stack itself. A real, deeply-nested-parentheses input
// (found via the v1.0.x fuzz-testing pass — see docs/architecture/fuzzing.md)
// exhausts the stack and throws a raw, uncaught RangeError — not one of
// the three documented pipeline exceptions (LexError/ParseError/
// CompileError) callers are meant to be able to rely on catching. This
// constant is a conservative bound well under the point where a real
// RangeError would occur (confirmed empirically to fail somewhere between
// depth 2000 and 5000 on this environment's default stack size — a
// number that varies by platform/Node build, so the guard fires early
// enough to have margin on a smaller stack too) — past it, parsing fails
// with a real ParseError instead of crashing.
const MAX_EXPRESSION_DEPTH = 500;

export class Parser {
  private pos = 0;
  private expressionDepth = 0;

  constructor(private tokens: Token[]) {}

  private peek(offset = 0): Token {
    return this.tokens[Math.min(this.pos + offset, this.tokens.length - 1)];
  }

  private advance(): Token {
    const token = this.peek();
    if (token.type !== "EOF") this.pos++;
    return token;
  }

  private check(type: Token["type"]): boolean {
    return this.peek().type === type;
  }

  private expect(type: Token["type"], context: string): Token {
    const token = this.peek();
    if (token.type !== type) {
      throw new ParseError(
        `expected ${type} ${context}, got ${token.type} '${token.value}'`,
        token.line,
        token.column,
      );
    }
    return this.advance();
  }

  private skipNewlines(): void {
    while (this.check("NEWLINE")) this.advance();
  }

  parseProgram(): Program {
    const declarations: TopLevelDeclaration[] = [];
    const statements: Statement[] = [];
    this.skipNewlines();
    while (!this.check("EOF")) {
      if (this.check("FN")) {
        declarations.push(this.parseFunctionDeclaration());
      } else if (this.check("STRUCT")) {
        declarations.push(this.parseStructDeclaration());
      } else {
        statements.push(this.parseStatement());
      }
      this.skipNewlines();
    }
    return { kind: "Program", declarations, statements };
  }

  private parseFunctionDeclaration(): FunctionDeclaration {
    const fnToken = this.expect("FN", "at start of function declaration");
    const nameToken = this.expect("IDENTIFIER", "as function name");
    this.expect("LPAREN", "to start parameter list");
    const params: string[] = [];
    if (!this.check("RPAREN")) {
      params.push(this.expect("IDENTIFIER", "as parameter name").value);
      while (this.check("COMMA")) {
        this.advance();
        params.push(this.expect("IDENTIFIER", "as parameter name").value);
      }
    }
    this.expect("RPAREN", "to close parameter list");
    const body = this.parseBlock();
    return { kind: "FunctionDeclaration", name: nameToken.value, params, body, pos: { line: fnToken.line, column: fnToken.column } };
  }

  private parseTypeAnnotation(): TypeAnnotation {
    const baseToken = this.expect("IDENTIFIER", "as a type name");
    let arraySize: number | null = null;
    if (this.check("LBRACKET")) {
      this.advance();
      const sizeToken = this.expect("NUMBER", "as array size");
      this.expect("RBRACKET", "to close array type");
      arraySize = Number(sizeToken.value);
    }
    return { base: baseToken.value, arraySize, pos: { line: baseToken.line, column: baseToken.column } };
  }

  private parseStructDeclaration(): StructDeclaration {
    const structToken = this.expect("STRUCT", "at start of struct declaration");
    const nameToken = this.expect("IDENTIFIER", "as struct name");
    this.expect("LBRACE", "to start struct body");
    this.skipNewlines();
    const fields: StructField[] = [];
    if (!this.check("RBRACE")) {
      fields.push(this.parseStructField());
      while (this.check("COMMA") || this.check("NEWLINE")) {
        this.skipNewlines();
        if (this.check("COMMA")) this.advance();
        this.skipNewlines();
        if (this.check("RBRACE")) break;
        fields.push(this.parseStructField());
      }
    }
    this.skipNewlines();
    this.expect("RBRACE", "to close struct body");
    return { kind: "StructDeclaration", name: nameToken.value, fields, pos: { line: structToken.line, column: structToken.column } };
  }

  private parseStructField(): StructField {
    const nameToken = this.expect("IDENTIFIER", "as struct field name");
    this.expect("COLON", "after struct field name");
    const type = this.parseTypeAnnotation();
    return { name: nameToken.value, type };
  }

  private parseBlock(): Statement[] {
    this.expect("LBRACE", "to start block");
    this.skipNewlines();
    const statements: Statement[] = [];
    while (!this.check("RBRACE")) {
      statements.push(this.parseStatement());
      this.skipNewlines();
    }
    this.expect("RBRACE", "to close block");
    return statements;
  }

  private parseStatement(): Statement {
    if (this.check("IF")) return this.parseIfStatement();
    if (this.check("FOR")) return this.parseForStatement();
    if (this.check("GLSL")) return this.parseRawGlslStatement();
    if (this.check("RETURN")) return this.parseReturnStatement();
    return this.parseAssignment();
  }

  private parseReturnStatement(): ReturnStatement {
    const returnToken = this.expect("RETURN", "at start of return statement");
    const value = this.parseExpression();
    return { kind: "ReturnStatement", value, pos: { line: returnToken.line, column: returnToken.column } };
  }

  private parseRawGlslStatement(): RawGlslStatement {
    const glslToken = this.expect("GLSL", "at start of glsl block");
    const blockToken = this.expect("RAW_GLSL_BLOCK", "after 'glsl' (expected '{')");
    return {
      kind: "RawGlslStatement",
      source: blockToken.value,
      pos: { line: glslToken.line, column: glslToken.column },
    };
  }

  private parseIfStatement(): IfStatement {
    const ifToken = this.expect("IF", "at start of if-statement");
    const condition = this.parseComparison();
    const consequent = this.parseBlock();

    let alternate: Statement[] | null = null;
    if (this.check("ELSE")) {
      this.advance();
      alternate = this.check("IF") ? [this.parseIfStatement()] : this.parseBlock();
    }

    return { kind: "IfStatement", condition, consequent, alternate, pos: { line: ifToken.line, column: ifToken.column } };
  }

  private parseForStatement(): ForStatement {
    const forToken = this.expect("FOR", "at start of for-statement");
    const variableToken = this.expect("IDENTIFIER", "as for-loop variable");
    this.expect("IN", "after for-loop variable");
    const fromToken = this.expect("NUMBER", "as for-loop range start");
    this.expect("DOT_DOT", "between for-loop range bounds");
    const toToken = this.expect("NUMBER", "as for-loop range end");
    const body = this.parseBlock();

    return {
      kind: "ForStatement",
      variable: variableToken.value,
      from: Number(fromToken.value),
      to: Number(toToken.value),
      body,
      pos: { line: forToken.line, column: forToken.column },
    };
  }

  private parseAssignment(): AssignmentStatement {
    const nameToken = this.expect("IDENTIFIER", "at start of statement");
    this.expect("EQUAL", "after identifier in assignment");
    const value = this.parseExpression();
    return {
      kind: "AssignmentStatement",
      name: nameToken.value,
      value,
      pos: { line: nameToken.line, column: nameToken.column },
    };
  }

  private parseComparison(): Expression {
    const left = this.parseExpression();
    const opType = this.peek().type;
    const operator = COMPARISON_TOKEN_TO_OP[opType];
    if (!operator) return left;

    const opToken = this.advance();
    const right = this.parseExpression();
    return {
      kind: "ComparisonExpression",
      operator,
      left,
      right,
      pos: { line: opToken.line, column: opToken.column },
    };
  }

  private parseExpression(): Expression {
    this.expressionDepth++;
    if (this.expressionDepth > MAX_EXPRESSION_DEPTH) {
      const token = this.peek();
      throw new ParseError(
        `expression nesting too deep (> ${MAX_EXPRESSION_DEPTH} levels) — likely malformed or excessively parenthesized input`,
        token.line,
        token.column,
      );
    }
    try {
      let left = this.parseTerm();
      while (this.check("PLUS") || this.check("MINUS")) {
        const opToken = this.advance();
        const right = this.parseTerm();
        left = {
          kind: "BinaryExpression",
          operator: opToken.value as BinaryOperator,
          left,
          right,
          pos: { line: opToken.line, column: opToken.column },
        };
      }
      return left;
    } finally {
      this.expressionDepth--;
    }
  }

  private parseTerm(): Expression {
    let left = this.parseUnary();
    while (this.check("STAR") || this.check("SLASH")) {
      const opToken = this.advance();
      const right = this.parseUnary();
      left = {
        kind: "BinaryExpression",
        operator: opToken.value as BinaryOperator,
        left,
        right,
        pos: { line: opToken.line, column: opToken.column },
      };
    }
    return left;
  }

  private parseUnary(): Expression {
    if (this.check("MINUS")) {
      const opToken = this.advance();
      const operand = this.parseUnary();
      // Desugar unary minus into `0 - operand` — keeps the AST shape minimal for v0.1.
      return {
        kind: "BinaryExpression",
        operator: "-",
        left: { kind: "NumberLiteral", value: 0, pos: { line: opToken.line, column: opToken.column } },
        right: operand,
        pos: { line: opToken.line, column: opToken.column },
      };
    }
    return this.parsePostfix();
  }

  private parsePostfix(): Expression {
    let expr = this.parsePrimary();
    while (this.check("DOT") || this.check("LBRACKET")) {
      if (this.check("DOT")) {
        const dotToken = this.advance();
        const nameToken = this.expect("IDENTIFIER", "after '.' for member access");
        if (this.check("LPAREN")) {
          this.advance();
          const args: Expression[] = [];
          if (!this.check("RPAREN")) {
            args.push(this.parseExpression());
            while (this.check("COMMA")) {
              this.advance();
              args.push(this.parseExpression());
            }
          }
          this.expect("RPAREN", "to close method call arguments");
          expr = {
            kind: "MethodCallExpression",
            object: expr,
            method: nameToken.value,
            args,
            pos: { line: dotToken.line, column: dotToken.column },
          };
          continue;
        }
        expr = {
          kind: "MemberExpression",
          object: expr,
          property: nameToken.value,
          pos: { line: dotToken.line, column: dotToken.column },
        };
      } else {
        const bracketToken = this.advance();
        const index = this.parseExpression();
        this.expect("RBRACKET", "to close index expression");
        expr = {
          kind: "IndexExpression",
          object: expr,
          index,
          pos: { line: bracketToken.line, column: bracketToken.column },
        };
      }
    }
    return expr;
  }

  private parsePrimary(): Expression {
    const token = this.peek();

    if (token.type === "NUMBER") {
      this.advance();
      return { kind: "NumberLiteral", value: Number(token.value), pos: { line: token.line, column: token.column } };
    }

    if (token.type === "ARRAY") {
      this.advance();
      this.expect("LBRACKET", "to start array literal");
      const elements: Expression[] = [];
      if (!this.check("RBRACKET")) {
        elements.push(this.parseExpression());
        while (this.check("COMMA")) {
          this.advance();
          elements.push(this.parseExpression());
        }
      }
      this.expect("RBRACKET", "to close array literal");
      return { kind: "ArrayLiteral", elements, pos: { line: token.line, column: token.column } };
    }

    if (token.type === "LBRACKET") {
      this.advance();
      const elements: Expression[] = [];
      if (!this.check("RBRACKET")) {
        elements.push(this.parseExpression());
        while (this.check("COMMA")) {
          this.advance();
          elements.push(this.parseExpression());
        }
      }
      this.expect("RBRACKET", "to close vector literal");
      return { kind: "VectorLiteral", elements, pos: { line: token.line, column: token.column } };
    }

    if (token.type === "LPAREN") {
      this.advance();
      const expr = this.parseExpression();
      this.expect("RPAREN", "to close parenthesized expression");
      return expr;
    }

    if (token.type === "IDENTIFIER") {
      this.advance();
      if (this.check("LPAREN")) {
        this.advance();
        const args: Expression[] = [];
        if (!this.check("RPAREN")) {
          args.push(this.parseExpression());
          while (this.check("COMMA")) {
            this.advance();
            args.push(this.parseExpression());
          }
        }
        this.expect("RPAREN", "to close call arguments");
        return { kind: "CallExpression", callee: token.value, args, pos: { line: token.line, column: token.column } };
      }
      return { kind: "Identifier", name: token.value, pos: { line: token.line, column: token.column } };
    }

    throw new ParseError(`unexpected token '${token.value || token.type}'`, token.line, token.column);
  }
}

export function parse(tokens: Token[]): Program {
  return new Parser(tokens).parseProgram();
}
