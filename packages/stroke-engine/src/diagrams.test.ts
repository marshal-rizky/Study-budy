import { describe, it, expect } from "vitest";
import { diagramStrokes } from "./diagrams";

describe("diagramStrokes", () => {
  it("axes: two arrowed axes = 6 strokes (2 lines + 2 heads of 2 strokes)", () => {
    const s = diagramStrokes({ kind: "axes", width: 300, height: 200 }, { x: 50, y: 250 });
    expect(s).toHaveLength(6);
  });
  it("curve: single smooth stroke with dense samples inside the box", () => {
    const s = diagramStrokes(
      {
        kind: "curve", fn: (x) => x * x, domain: [-2, 2],
        width: 300, height: 200, yRange: [0, 4],
      },
      { x: 50, y: 250 }
    );
    expect(s).toHaveLength(1);
    expect(s[0].length).toBeGreaterThanOrEqual(30);
    for (const p of s[0]) {
      expect(p.x).toBeGreaterThanOrEqual(50 - 1);
      expect(p.x).toBeLessThanOrEqual(350 + 1);
      expect(p.y).toBeLessThanOrEqual(250 + 1);
      expect(p.y).toBeGreaterThanOrEqual(50 - 1);
    }
    // parabola vertex (x=0 -> y=0) maps to bottom of box
    const mid = s[0][Math.floor(s[0].length / 2)];
    expect(mid.y).toBeGreaterThan(200);
  });
  it("arrow: shaft + head = 2 strokes", () => {
    const s = diagramStrokes({ kind: "arrow", from: { x: 0, y: 0 }, to: { x: 100, y: 0 } }, { x: 0, y: 0 });
    expect(s).toHaveLength(2);
    expect(s[0][0]).toEqual({ x: 0, y: 0 });
    expect(s[0][1]).toEqual({ x: 100, y: 0 });
  });
  it("benzene: hexagon + inner circle = 2 strokes", () => {
    const s = diagramStrokes({ kind: "benzene", center: { x: 100, y: 100 }, radius: 50 }, { x: 0, y: 0 });
    expect(s).toHaveLength(2);
    expect(s[0]).toHaveLength(7); // closed hexagon
    // circle points within radius
    for (const p of s[1]) {
      const r = Math.hypot(p.x - 100, p.y - 100);
      expect(r).toBeLessThan(50);
    }
  });
});
