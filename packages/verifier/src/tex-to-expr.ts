/**
 * Converts the stroke-engine's TeX subset (see
 * packages/stroke-engine/src/math/parser.ts) into the expression grammar
 * accepted by @teacher/board-layout's `compileExpr` (see
 * packages/board-layout/src/expr.ts).
 *
 * This is a from-scratch recursive-descent walk over the TeX subset -- it
 * does not reuse stroke-engine's `parseMath`, because that parser builds a
 * *rendering* tree (one glyph per character) whereas this needs to fold
 * runs of characters into `compileExpr` tokens (numbers, identifiers) while
 * inserting explicit `*` wherever bare concatenation would either merge two
 * distinct tokens into one identifier or fail to trigger compileExpr's
 * (narrow) implicit-multiplication rule.
 *
 * Supported: digits, `+ - * / ^ ( ) =`, bare letters (single-char
 * identifiers, e.g. `x`), `\frac{A}{B}`, `\sqrt{A}` (or `\sqrt` + one bare
 * atom), `{...}` grouping, `^`/`\^{}` superscripts, and the symbol commands
 * that have a direct arithmetic meaning: `\pi`, `\times`, `\div`, `\cdot`.
 *
 * Deliberately unsupported (returns null -- never guess):
 *   - subscripts (`x_0`) -- these name a distinct variable, not a number.
 *   - any other symbol command (`\theta`, `\Delta`, `\int`, `\sum`, `\pm`,
 *     `\to`, `\ne`, `\le`, `\ge`, `\approx`, `\rightleftharpoons`, ...).
 *   - any other backslash command.
 */

const OPERATOR_COMMANDS: Record<string, string> = {
  times: "*",
  div: "/",
  cdot: "*",
};

function isDigitFrag(ch: string | undefined): boolean {
  return ch !== undefined && (ch >= "0" && ch <= "9" || ch === ".");
}

function isValueEnd(ch: string | undefined): boolean {
  return ch !== undefined && /[0-9a-zA-Z)]/.test(ch);
}

function isValueStart(ch: string | undefined): boolean {
  return ch !== undefined && /[0-9a-zA-Z(]/.test(ch);
}

/**
 * Joins converted atom strings into one expression, inserting an explicit
 * `*` wherever bare concatenation would be ambiguous or wrong under
 * compileExpr's grammar -- except between two digit/dot fragments, which
 * must merge into a single number (that's how the TeX subset represents a
 * multi-digit literal: one atom per character).
 */
function joinRow(items: string[]): string {
  let out = "";
  for (const item of items) {
    if (out.length > 0 && item.length > 0) {
      const prevChar = out[out.length - 1];
      const nextChar = item[0];
      if (isDigitFrag(prevChar) && isDigitFrag(nextChar)) {
        // let consecutive digits/dot merge into one number literal
      } else if (isValueEnd(prevChar) && isValueStart(nextChar)) {
        out += "*";
      }
    }
    out += item;
  }
  return out;
}

class UnsupportedTexError extends Error {}

class TexToExprConverter {
  pos = 0;
  constructor(private src: string) {}

  /** Parses atoms (and `^`/`_` postfixes) until `until` or end of input. */
  convertRow(until: string | null): string[] {
    const items: string[] = [];
    while (this.pos < this.src.length && (until === null || this.src[this.pos] !== until)) {
      const ch = this.src[this.pos];
      if (ch === "^" || ch === "_") {
        if (items.length === 0) throw new UnsupportedTexError(`'${ch}' with no base`);
        if (ch === "_") {
          // Subscripts name a distinct variable (e.g. v_0) -- not
          // expressible in compileExpr's grammar. Never guess.
          throw new UnsupportedTexError("subscript");
        }
        this.pos++;
        const arg = this.convertArg();
        const base = items.pop()!;
        items.push(`(${base})^(${arg})`);
        continue;
      }
      const atom = this.convertAtom();
      if (atom !== null) items.push(atom);
    }
    return items;
  }

  /** `{...}` group or a single atom (mirrors stroke-engine's parseArg). */
  convertArg(): string {
    if (this.src[this.pos] === "{") {
      return this.convertGroupContent();
    }
    const atom = this.convertAtom();
    if (atom === null) throw new UnsupportedTexError("missing argument");
    return atom;
  }

  /** Consumes `{...}`, returns the joined inner content (unwrapped). */
  private convertGroupContent(): string {
    this.pos++; // consume '{'
    const items = this.convertRow("}");
    if (this.src[this.pos] !== "}") throw new UnsupportedTexError("unbalanced '{'");
    this.pos++; // consume '}'
    return joinRow(items);
  }

  /** One atom's converted output, or null for whitespace (skipped). */
  private convertAtom(): string | null {
    const ch = this.src[this.pos];
    if (ch === "{") {
      return `(${this.convertGroupContent()})`;
    }
    if (ch === "}") {
      throw new UnsupportedTexError("unexpected '}'");
    }
    if (ch === "\\") {
      return this.convertCommand();
    }
    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
      this.pos++;
      return null;
    }
    if (/[0-9.a-zA-Z+\-*/()=]/.test(ch)) {
      this.pos++;
      return ch;
    }
    throw new UnsupportedTexError(`unsupported character '${ch}'`);
  }

  private convertCommand(): string {
    const start = this.pos;
    this.pos++; // consume backslash
    let name = "";
    while (this.pos < this.src.length && /[a-zA-Z]/.test(this.src[this.pos])) {
      name += this.src[this.pos++];
    }
    if (name.length === 0) throw new UnsupportedTexError(`bare backslash at ${start}`);

    if (name === "frac") {
      const num = this.convertArg();
      const den = this.convertArg();
      return `((${num})/(${den}))`;
    }
    if (name === "sqrt") {
      const body = this.convertArg();
      return `sqrt(${body})`;
    }
    if (name === "pi") {
      return "pi";
    }
    if (Object.hasOwn(OPERATOR_COMMANDS, name)) {
      return OPERATOR_COMMANDS[name];
    }
    throw new UnsupportedTexError(`unsupported command \\${name}`);
  }
}

/**
 * Converts a TeX string (in stroke-engine's supported subset) into a
 * compileExpr-compatible expression source, or `null` when the TeX uses
 * anything outside what can be faithfully converted. Never guesses.
 */
export function texToExpr(tex: string): string | null {
  try {
    const converter = new TexToExprConverter(tex);
    const items = converter.convertRow(null);
    if (converter.pos < tex.length) return null; // stray trailing char (e.g. unmatched '}')
    const result = joinRow(items);
    if (result.trim().length === 0) return null;
    return result;
  } catch {
    return null;
  }
}
