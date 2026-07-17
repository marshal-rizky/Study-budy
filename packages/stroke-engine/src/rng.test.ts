import { describe, it, expect } from "vitest";
import { mulberry32 } from "./rng";
import { strokeLength } from "./types";

describe("mulberry32", () => {
  it("same seed gives same sequence", () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    for (let i = 0; i < 100; i++) expect(a()).toBe(b());
  });
  it("different seeds differ", () => {
    expect(mulberry32(1)()).not.toBe(mulberry32(2)());
  });
  it("outputs in [0,1)", () => {
    const r = mulberry32(7);
    for (let i = 0; i < 1000; i++) {
      const v = r();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe("strokeLength", () => {
  it("sums segment lengths", () => {
    expect(strokeLength([{ x: 0, y: 0 }, { x: 3, y: 4 }, { x: 3, y: 5 }])).toBeCloseTo(6);
  });
  it("returns 0 for a single point", () => {
    expect(strokeLength([{ x: 1, y: 1 }])).toBe(0);
  });
});
