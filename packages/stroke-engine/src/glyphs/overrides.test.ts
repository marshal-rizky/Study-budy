import { describe, it, expect } from "vitest";
import { getGlyph } from "./library";

const MATH_CHARS = ["√", "∫", "Σ", "π", "θ", "Δ", "×", "÷", "±", "→", "≠", "≤", "≥", "≈", "⇌"];

describe("math glyph overrides", () => {
  it.each(MATH_CHARS)("has glyph %s", (ch) => {
    const g = getGlyph(ch);
    expect(g).toBeDefined();
    expect(g!.strokes.length).toBeGreaterThan(0);
    expect(g!.advance).toBeGreaterThan(0);
    // sane bounds: within roughly one em box around the baseline
    for (const p of g!.strokes.flat()) {
      expect(Math.abs(p.x)).toBeLessThanOrEqual(1.2);
      expect(Math.abs(p.y)).toBeLessThanOrEqual(1.2);
    }
  });
});
