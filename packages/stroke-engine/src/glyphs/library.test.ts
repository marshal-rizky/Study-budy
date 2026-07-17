import { describe, it, expect } from "vitest";
import { getGlyph, FALLBACK_GLYPH } from "./library";

describe("glyph library", () => {
  it("has core ASCII glyphs", () => {
    for (const ch of ["A", "x", "2", "+", "=", "(", ")"]) {
      const g = getGlyph(ch);
      expect(g, `missing glyph ${ch}`).toBeDefined();
      expect(g!.strokes.length).toBeGreaterThan(0);
      expect(g!.advance).toBeGreaterThan(0);
    }
  });
  it("space has advance but no strokes", () => {
    const g = getGlyph(" ")!;
    expect(g.strokes).toHaveLength(0);
    expect(g.advance).toBeGreaterThan(0);
  });
  it("glyphs are normalized: baseline ~0, cap height ~0.7", () => {
    const H = getGlyph("H")!;
    const ys = H.strokes.flat().map((p) => p.y);
    expect(Math.max(...ys)).toBeCloseTo(0, 1);
    expect(Math.min(...ys)).toBeCloseTo(-0.7, 1);
  });
  it("unknown char returns undefined; fallback exists", () => {
    expect(getGlyph("☃")).toBeUndefined();
    expect(FALLBACK_GLYPH.strokes.length).toBeGreaterThan(0);
  });
});
