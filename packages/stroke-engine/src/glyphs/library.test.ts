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
  it("curved glyphs keep their full polyline, not just the first segment", () => {
    // Hershey paths use implicit lineto repetition ("M4,6 L4,5 5,3 6,2 ...").
    // A build that stops at the first pair collapses these to a 2-point stub.
    for (const ch of ["2", "3", "S", "b", "o", "e"]) {
      const g = getGlyph(ch)!;
      const longest = Math.max(...g.strokes.map((s) => s.length));
      expect(longest, `glyph ${ch} lost its curve`).toBeGreaterThanOrEqual(6);
    }
  });
  it("no letter or digit collapsed to a stub", () => {
    // Punctuation is legitimately tiny ('.' is ~0.07em), so this checks the
    // glyphs that must always stand at least x-height tall.
    for (let code = 33; code < 127; code++) {
      const ch = String.fromCharCode(code);
      if (!/[A-Za-z0-9]/.test(ch)) continue;
      const g = getGlyph(ch)!;
      const ys = g.strokes.flat().map((p) => p.y);
      const inkHeight = Math.max(...ys) - Math.min(...ys);
      expect(inkHeight, `glyph ${ch} collapsed`).toBeGreaterThan(0.3);
    }
  });
  it("unknown char returns undefined; fallback exists", () => {
    expect(getGlyph("☃")).toBeUndefined();
    expect(FALLBACK_GLYPH.strokes.length).toBeGreaterThan(0);
  });
});
