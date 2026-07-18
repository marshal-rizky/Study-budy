/**
 * Safe recursive-descent compiler for math expressions authored by a
 * language model. NEVER uses eval / new Function / any dynamic code
 * construction -- untrusted `expr` strings are parsed into a token stream
 * and evaluated by walking a tree of plain closures.
 *
 * Grammar (see packages/board-layout for the full spec):
 *   expr    := term (('+' | '-') term)*
 *   term    := factor (('*' | '/') factor | implicit-factor)*
 *   factor  := '-' factor | primary ('^' factor)?
 *   primary := number | 'x' | 'pi' | 'e' | func '(' expr ')' | '(' expr ')'
 *   func    := sin | cos | tan | sqrt | exp | ln | abs
 *
 * Implicit multiplication: a primary directly followed by another primary
 * that starts with 'x', a function name, or '(' is treated as `*`. Two bare
 * numbers in a row ("2 3") are NOT implicit multiplication -- that's an error.
 *
 * Unary minus binds looser than '^' so that "-x^2" means "-(x^2)", matching
 * ordinary math notation.
 */

export class ExprError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExprError";
  }
}

type TokenType = "num" | "ident" | "+" | "-" | "*" | "/" | "^" | "(" | ")" | "eof";

interface Token {
  type: TokenType;
  value?: string | number;
  pos: number;
}

const FUNC_NAMES = new Set(["sin", "cos", "tan", "sqrt", "exp", "ln", "abs"]);

function isDigit(c: string): boolean {
  return c >= "0" && c <= "9";
}

function isIdentStart(c: string): boolean {
  return (c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || c === "_";
}

function isIdentPart(c: string): boolean {
  return isIdentStart(c) || isDigit(c);
}

function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const n = src.length;

  while (i < n) {
    const c = src[i];

    if (c === " " || c === "\t" || c === "\n" || c === "\r") {
      i++;
      continue;
    }

    if (isDigit(c) || c === ".") {
      let j = i;
      let sawDot = false;
      let sawDigit = false;
      while (j < n && (isDigit(src[j]) || (src[j] === "." && !sawDot))) {
        if (src[j] === ".") sawDot = true;
        else sawDigit = true;
        j++;
      }
      if (!sawDigit) {
        throw new ExprError(`invalid number at position ${i}`);
      }
      tokens.push({ type: "num", value: Number(src.slice(i, j)), pos: i });
      i = j;
      continue;
    }

    if (isIdentStart(c)) {
      let j = i;
      while (j < n && isIdentPart(src[j])) j++;
      tokens.push({ type: "ident", value: src.slice(i, j), pos: i });
      i = j;
      continue;
    }

    if (c === "+" || c === "-" || c === "*" || c === "/" || c === "^" || c === "(" || c === ")") {
      const type: TokenType = c;
      tokens.push({ type, pos: i });
      i++;
      continue;
    }

    throw new ExprError(`unexpected character '${c}' at position ${i}`);
  }

  tokens.push({ type: "eof", pos: n });
  return tokens;
}

type Fn = (x: number) => number;

class Parser {
  private pos = 0;
  constructor(private tokens: Token[]) {}

  peek(): Token {
    return this.tokens[this.pos];
  }

  hasMore(): boolean {
    return this.peek().type !== "eof";
  }

  private next(): Token {
    return this.tokens[this.pos++];
  }

  private expect(type: TokenType): Token {
    const t = this.next();
    if (t.type !== type) {
      throw new ExprError(`expected '${type}' but found '${t.type}' at position ${t.pos}`);
    }
    return t;
  }

  parseExpr(): Fn {
    let left = this.parseTerm();
    for (;;) {
      const t = this.peek();
      if (t.type === "+") {
        this.next();
        const right = this.parseTerm();
        const prev = left;
        left = (x) => prev(x) + right(x);
      } else if (t.type === "-") {
        this.next();
        const right = this.parseTerm();
        const prev = left;
        left = (x) => prev(x) - right(x);
      } else {
        break;
      }
    }
    return left;
  }

  private startsImplicitFactor(): boolean {
    const t = this.peek();
    if (t.type === "(") return true;
    if (t.type === "ident") {
      const name = t.value as string;
      return name === "x" || FUNC_NAMES.has(name);
    }
    return false;
  }

  private parseTerm(): Fn {
    let left = this.parseFactor();
    for (;;) {
      const t = this.peek();
      if (t.type === "*") {
        this.next();
        const right = this.parseFactor();
        const prev = left;
        left = (x) => prev(x) * right(x);
      } else if (t.type === "/") {
        this.next();
        const right = this.parseFactor();
        const prev = left;
        left = (x) => prev(x) / right(x);
      } else if (this.startsImplicitFactor()) {
        const right = this.parseFactor();
        const prev = left;
        left = (x) => prev(x) * right(x);
      } else {
        break;
      }
    }
    return left;
  }

  private parseFactor(): Fn {
    if (this.peek().type === "-") {
      this.next();
      const inner = this.parseFactor();
      return (x) => -inner(x);
    }
    return this.parsePow();
  }

  private parsePow(): Fn {
    const base = this.parsePrimary();
    if (this.peek().type === "^") {
      this.next();
      const exp = this.parseFactor();
      return (x) => Math.pow(base(x), exp(x));
    }
    return base;
  }

  private parsePrimary(): Fn {
    const t = this.next();
    switch (t.type) {
      case "num": {
        const v = t.value as number;
        return () => v;
      }
      case "ident": {
        const name = t.value as string;
        if (name === "x") return (x) => x;
        if (name === "pi") return () => Math.PI;
        if (name === "e") return () => Math.E;
        if (FUNC_NAMES.has(name)) {
          if (this.peek().type !== "(") {
            throw new ExprError(
              `function '${name}' must be followed by '(' at position ${this.peek().pos}`
            );
          }
          this.next();
          const arg = this.parseExpr();
          this.expect(")");
          switch (name) {
            case "sin":
              return (x) => Math.sin(arg(x));
            case "cos":
              return (x) => Math.cos(arg(x));
            case "tan":
              return (x) => Math.tan(arg(x));
            case "sqrt":
              return (x) => Math.sqrt(arg(x));
            case "exp":
              return (x) => Math.exp(arg(x));
            case "ln":
              return (x) => Math.log(arg(x));
            case "abs":
              return (x) => Math.abs(arg(x));
          }
        }
        throw new ExprError(`unknown identifier '${name}' at position ${t.pos}`);
      }
      case "(": {
        const inner = this.parseExpr();
        this.expect(")");
        return inner;
      }
      default:
        throw new ExprError(`unexpected token '${t.type}' at position ${t.pos}`);
    }
    // unreachable -- every case above returns or throws
    throw new ExprError("unexpected end of expression");
  }
}

/** Compiles a model-authored expression string into a total numeric function. */
export function compileExpr(src: string): Fn {
  if (src.trim().length === 0) {
    throw new ExprError("empty expression");
  }
  const tokens = tokenize(src);
  const parser = new Parser(tokens);
  const fn = parser.parseExpr();
  if (parser.hasMore()) {
    const t = parser.peek();
    throw new ExprError(`unexpected trailing input at position ${t.pos}`);
  }
  return (x: number) => fn(x);
}
