import { describe, it, expect } from "vitest";
import { parseMath, MathParseError } from "./parser";

describe("parseMath", () => {
  it("parses a plain row", () => {
    const ast = parseMath("2x+3=7");
    expect(ast).toEqual({
      type: "row",
      children: ["2", "x", "+", "3", "=", "7"].map((c) => ({ type: "sym", char: c })),
    });
  });
  it("parses \\frac", () => {
    const ast = parseMath("\\frac{x+1}{2}");
    expect(ast.type).toBe("row");
    const frac = (ast as any).children[0];
    expect(frac.type).toBe("frac");
    expect(frac.num.children).toHaveLength(3);
    expect(frac.den.children).toHaveLength(1);
  });
  it("parses superscript with braces and without", () => {
    const a = parseMath("x^{2}") as any;
    const b = parseMath("x^2") as any;
    expect(a.children[0].type).toBe("sup");
    expect(b.children[0].type).toBe("sup");
    expect(b.children[0].exp.children[0].char).toBe("2");
  });
  it("parses subscript", () => {
    const ast = parseMath("v_0") as any;
    expect(ast.children[0].type).toBe("sub");
  });
  it("parses \\sqrt and nesting", () => {
    const ast = parseMath("\\sqrt{\\frac{1}{2}}") as any;
    expect(ast.children[0].type).toBe("sqrt");
    expect(ast.children[0].body.children[0].type).toBe("frac");
  });
  it("maps symbol commands", () => {
    const ast = parseMath("\\pi\\theta\\times\\to") as any;
    expect(ast.children.map((c: any) => c.char)).toEqual(["π", "θ", "×", "→"]);
  });
  it("throws on unknown command with position", () => {
    try {
      parseMath("1+\\bogus{2}");
      expect.unreachable("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(MathParseError);
      expect((e as MathParseError).position).toBe(2);
    }
  });
  it("throws on unbalanced braces", () => {
    expect(() => parseMath("\\frac{1}{2")).toThrow(MathParseError);
  });
  it("throws on dangling ^/_ or missing arg at end of input", () => {
    expect(() => parseMath("x^")).toThrow(MathParseError);
    expect(() => parseMath("\\frac{1}")).toThrow(MathParseError);
    expect(() => parseMath("\\sqrt")).toThrow(MathParseError);
  });
  it("rejects prototype-chain names as commands", () => {
    expect(() => parseMath("\\constructor")).toThrow(MathParseError);
    expect(() => parseMath("\\toString")).toThrow(MathParseError);
  });
});
