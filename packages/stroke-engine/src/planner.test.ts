import { describe, it, expect } from "vitest";
import { buildPlan } from "./planner";
import type { Op } from "./planner";

const mathOp: Op = { type: "write_math", tex: "2x+3=7", at: { x: 50, y: 100 }, size: 40 };

describe("buildPlan", () => {
  it("produces strokes with positive durations", () => {
    const plan = buildPlan([mathOp], { seed: 42 });
    expect(plan.strokes.length).toBeGreaterThan(5);
    for (const s of plan.strokes) {
      expect(s.durationMs).toBeGreaterThanOrEqual(60);
      expect(s.durationMs).toBeLessThanOrEqual(2000);
      expect(s.points.length).toBeGreaterThanOrEqual(2);
    }
    expect(plan.totalMs).toBeGreaterThan(0);
  });
  it("is deterministic for the same seed", () => {
    const a = buildPlan([mathOp], { seed: 42 });
    const b = buildPlan([mathOp], { seed: 42 });
    expect(a).toEqual(b);
  });
  it("differs across seeds (jitter)", () => {
    const a = buildPlan([mathOp], { seed: 1 });
    const b = buildPlan([mathOp], { seed: 2 });
    expect(a).not.toEqual(b);
  });
  it("handles text and diagram ops", () => {
    const plan = buildPlan(
      [
        { type: "write_text", text: "Solve:", at: { x: 10, y: 40 }, size: 30 },
        { type: "draw_diagram", diagram: { kind: "axes", width: 200, height: 150 }, at: { x: 10, y: 300 } },
      ],
      { seed: 42 }
    );
    expect(plan.strokes.length).toBeGreaterThan(6);
  });
  it("throws MathParseError for bad TeX (caller handles per spec §6)", () => {
    expect(() =>
      buildPlan([{ type: "write_math", tex: "\\bogus", at: { x: 0, y: 0 }, size: 40 }])
    ).toThrow();
  });
});
