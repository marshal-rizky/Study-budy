import { describe, it, expect } from "vitest";
import { jitterStroke } from "./jitter";
import { mulberry32 } from "./rng";
import type { Stroke } from "./types";

const line: Stroke = [{ x: 0, y: 0 }, { x: 10, y: 0 }];

describe("jitterStroke", () => {
  it("is deterministic for the same seed", () => {
    const a = jitterStroke(line, mulberry32(42), 0.3, 0.5);
    const b = jitterStroke(line, mulberry32(42), 0.3, 0.5);
    expect(a).toEqual(b);
  });
  it("differs across seeds", () => {
    const a = jitterStroke(line, mulberry32(1), 0.3, 0.5);
    const b = jitterStroke(line, mulberry32(2), 0.3, 0.5);
    expect(a).not.toEqual(b);
  });
  it("displacement is bounded by amount", () => {
    const out = jitterStroke(line, mulberry32(42), 0.3, 0.5);
    for (const p of out) {
      expect(Math.abs(p.y)).toBeLessThanOrEqual(0.3 + 1e-9);
      expect(p.x).toBeGreaterThanOrEqual(-0.3 - 1e-9);
      expect(p.x).toBeLessThanOrEqual(10.3 + 1e-9);
    }
  });
  it("resamples: output has more points than a 2-point input", () => {
    const out = jitterStroke(line, mulberry32(42), 0.1, 0.5);
    expect(out.length).toBeGreaterThan(10);
  });
  it("keeps short strokes intact (no crash on dots)", () => {
    const dotStroke: Stroke = [{ x: 0, y: 0 }, { x: 0.01, y: 0.01 }];
    const out = jitterStroke(dotStroke, mulberry32(42), 0.3, 0.5);
    expect(out.length).toBeGreaterThanOrEqual(2);
  });
});
