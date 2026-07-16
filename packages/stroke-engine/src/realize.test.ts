import { describe, it, expect } from "vitest";
import { realizeLayout } from "./realize";
import { layoutMath } from "./math/layout";
import { parseMath } from "./math/parser";
import { getGlyph } from "./glyphs/library";

describe("realizeLayout", () => {
  it("emits one stroke set per glyph plus layout lines", () => {
    const layout = layoutMath(parseMath("\\frac{1}{2}"));
    const strokes = realizeLayout(layout, { x: 0, y: 0 }, 40);
    const expected =
      getGlyph("1")!.strokes.length + getGlyph("2")!.strokes.length + 1; // + bar
    expect(strokes).toHaveLength(expected);
  });
  it("scales and translates into pixel space", () => {
    const layout = layoutMath(parseMath("1"));
    const at100 = realizeLayout(layout, { x: 100, y: 200 }, 40);
    const flat = at100.flat();
    // baseline y=0 em maps to origin.y; glyph body is above => y < 200
    expect(Math.max(...flat.map((p) => p.y))).toBeLessThanOrEqual(200 + 1);
    expect(Math.min(...flat.map((p) => p.x))).toBeGreaterThanOrEqual(100 - 1);
  });
  it("uses fallback glyph for unknown chars", () => {
    const layout = layoutMath(parseMath("☃"));
    const strokes = realizeLayout(layout, { x: 0, y: 0 }, 40);
    expect(strokes.length).toBeGreaterThan(0);
  });
});
