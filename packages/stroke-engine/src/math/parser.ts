export type MathNode =
  | { type: "row"; children: MathNode[] }
  | { type: "sym"; char: string }
  | { type: "frac"; num: MathNode; den: MathNode }
  | { type: "sqrt"; body: MathNode }
  | { type: "sup"; base: MathNode; exp: MathNode }
  | { type: "sub"; base: MathNode; sub: MathNode };

export class MathParseError extends Error {
  constructor(message: string, public position: number) {
    super(`${message} (at ${position})`);
    this.name = "MathParseError";
  }
}

const SYMBOL_COMMANDS: Record<string, string> = {
  pi: "π", theta: "θ", Delta: "Δ", int: "∫", sum: "Σ",
  times: "×", div: "÷", pm: "±", to: "→", ne: "≠",
  le: "≤", ge: "≥", approx: "≈", rightleftharpoons: "⇌",
};

class Parser {
  pos = 0;
  constructor(private src: string) {}

  parse(): MathNode {
    const row = this.parseRow(null);
    if (this.pos < this.src.length) {
      throw new MathParseError(`unexpected '${this.src[this.pos]}'`, this.pos);
    }
    return row;
  }

  /** Parse until `until` char (not consumed here) or end of input. */
  private parseRow(until: string | null): MathNode {
    const children: MathNode[] = [];
    while (this.pos < this.src.length) {
      const ch = this.src[this.pos];
      if (until !== null && ch === until) break;
      if (ch === "^" || ch === "_") {
        if (children.length === 0) throw new MathParseError(`'${ch}' with no base`, this.pos);
        this.pos++;
        const arg = this.parseArg();
        const base = children.pop()!;
        children.push(
          ch === "^" ? { type: "sup", base, exp: arg } : { type: "sub", base, sub: arg }
        );
        continue;
      }
      children.push(this.parseAtom());
    }
    return { type: "row", children };
  }

  /** `{...}` group or a single atom (for `x^2`, `\sqrt2` style args). */
  private parseArg(): MathNode {
    if (this.src[this.pos] === "{") return this.parseGroup();
    return { type: "row", children: [this.parseAtom()] };
  }

  private parseGroup(): MathNode {
    const start = this.pos;
    this.pos++; // consume {
    const row = this.parseRow("}");
    if (this.src[this.pos] !== "}") throw new MathParseError("unbalanced '{'", start);
    this.pos++; // consume }
    return row;
  }

  private parseAtom(): MathNode {
    if (this.pos >= this.src.length) throw new MathParseError("unexpected end of input", this.pos);
    const ch = this.src[this.pos];
    if (ch === "{") return this.parseGroup();
    if (ch === "}") throw new MathParseError("unexpected '}'", this.pos);
    if (ch === "\\") return this.parseCommand();
    if (ch === " ") {
      this.pos++;
      return { type: "sym", char: " " };
    }
    this.pos++;
    return { type: "sym", char: ch };
  }

  private parseCommand(): MathNode {
    const start = this.pos;
    this.pos++; // consume backslash
    let name = "";
    while (this.pos < this.src.length && /[a-zA-Z]/.test(this.src[this.pos])) {
      name += this.src[this.pos++];
    }
    if (name === "frac") {
      const num = this.parseArg();
      const den = this.parseArg();
      return { type: "frac", num, den };
    }
    if (name === "sqrt") {
      return { type: "sqrt", body: this.parseArg() };
    }
    const sym = Object.hasOwn(SYMBOL_COMMANDS, name) ? SYMBOL_COMMANDS[name] : undefined;
    if (sym) return { type: "sym", char: sym };
    throw new MathParseError(`unknown command \\${name}`, start);
  }
}

export function parseMath(tex: string): MathNode {
  return new Parser(tex).parse();
}
