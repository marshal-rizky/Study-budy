import { describe, it, expect } from "vitest";
import { layoutMath, layoutText } from "./layout";
import { parseMath } from "./parser";

describe("layoutMath", () => {
  it("lays a row on the baseline, advancing x", () => {
    const l = layoutMath(parseMath("2x"));
    expect(l.placements).toHaveLength(2);
    expect(l.placements[0].y).toBe(0);
    expect(l.placements[1].y).toBe(0);
    expect(l.placements[1].x).toBeGreaterThan(l.placements[0].x);
    expect(l.width).toBeGreaterThan(0);
  });
  it("pads binary operators", () => {
    const noOp = layoutMath(parseMath("22"));
    const withOp = layoutMath(parseMath("2+2"));
    const plusGlyphWidth = layoutMath(parseMath("+")).width;
    // '2+2' should be wider than '22' by more than the bare '+' width (side pads)
    expect(withOp.width).toBeGreaterThan(noOp.width + plusGlyphWidth - 0.01);
  });
  it("fraction: numerator above bar, denominator below", () => {
    const l = layoutMath(parseMath("\\frac{1}{2}"));
    const [num, den] = l.placements;
    expect(num.char).toBe("1");
    expect(den.char).toBe("2");
    expect(num.y).toBeLessThan(-0.26); // above math axis (y is down)
    expect(den.y).toBeGreaterThan(-0.26);
    expect(l.lines).toHaveLength(1); // the bar
    expect(l.lines[0].y1).toBeCloseTo(-0.26, 5);
    expect(l.ascent).toBeGreaterThan(0.8); // taller than a plain row
  });
  it("superscript is raised and shrunk", () => {
    const l = layoutMath(parseMath("x^2"));
    const [base, exp] = l.placements;
    expect(exp.scale).toBeCloseTo(0.6, 5);
    expect(exp.y).toBeLessThan(base.y);
  });
  it("subscript is lowered and shrunk", () => {
    const l = layoutMath(parseMath("v_0"));
    const [, sub] = l.placements;
    expect(sub.scale).toBeCloseTo(0.6, 5);
    expect(sub.y).toBeGreaterThan(0);
  });
  it("sqrt: vinculum spans the body, radical glyph placed", () => {
    const l = layoutMath(parseMath("\\sqrt{xy}"));
    const radical = l.placements.find((p) => p.char === "√");
    expect(radical).toBeDefined();
    expect(l.lines).toHaveLength(1);
    const bar = l.lines[0];
    expect(bar.x2 - bar.x1).toBeGreaterThan(0.5); // covers two glyphs
    expect(bar.y1).toBeLessThan(-0.6); // above the body
  });
  it("sqrt with tall body: radical encloses body, bar meets arm, ascent covers ink", () => {
    const l = layoutMath(parseMath("\\sqrt{\\frac{a}{b}}"));
    const radical = l.placements.find((p) => p.char === "√")!;
    const sqrtBar = l.lines[l.lines.length - 1]; // sqrt bar appended after body lines
    const glyphTop = radical.y - 0.78 * radical.scale;
    const glyphBottom = radical.y - 0.05 * radical.scale;
    expect(glyphTop).toBeCloseTo(sqrtBar.y1, 5); // arm meets vinculum
    expect(glyphBottom).toBeGreaterThan(0); // hook reaches below baseline to cover denominator
    expect(l.ascent).toBeGreaterThanOrEqual(-glyphTop); // ascent covers all ink
  });
  it("unknown glyph char still occupies space", () => {
    const l = layoutMath(parseMath("☃"));
    expect(l.width).toBeGreaterThan(0);
  });
});

describe("layoutText", () => {
  it("lays out plain text without TeX parsing", () => {
    const l = layoutText("Solve:");
    expect(l.placements).toHaveLength(6);
    expect(l.placements.every((p) => p.y === 0)).toBe(true);
  });
});
