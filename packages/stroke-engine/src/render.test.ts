import { describe, it, expect } from "vitest";
import { renderFrame } from "./render";
import type { RenderPlan } from "./planner";

function stubCtx() {
  const calls: string[] = [];
  return {
    calls,
    beginPath: () => calls.push("beginPath"),
    moveTo: () => calls.push("moveTo"),
    lineTo: () => calls.push("lineTo"),
    stroke: () => calls.push("stroke"),
  };
}

const plan: RenderPlan = {
  strokes: [
    { points: [{ x: 0, y: 0 }, { x: 100, y: 0 }], durationMs: 100 },
    { points: [{ x: 0, y: 10 }, { x: 100, y: 10 }], durationMs: 100 },
  ],
  totalMs: 260, // 100 + 60 gap + 100
};

describe("renderFrame", () => {
  it("draws nothing at t=0 except pen start", () => {
    const ctx = stubCtx();
    renderFrame(plan, 0, ctx);
    expect(ctx.calls.filter((c) => c === "lineTo").length).toBe(0);
  });
  it("draws partial first stroke midway", () => {
    const ctx = stubCtx();
    const done = renderFrame(plan, 50, ctx);
    expect(done).toBe(false);
    expect(ctx.calls.filter((c) => c === "lineTo").length).toBeGreaterThan(0);
    expect(ctx.calls.filter((c) => c === "stroke").length).toBe(1);
  });
  it("during the gap only the first stroke is drawn", () => {
    const ctx = stubCtx();
    renderFrame(plan, 130, ctx); // inside 100..160 gap
    expect(ctx.calls.filter((c) => c === "stroke").length).toBe(1);
  });
  it("draws everything and reports done at totalMs", () => {
    const ctx = stubCtx();
    const done = renderFrame(plan, 260, ctx);
    expect(done).toBe(true);
    expect(ctx.calls.filter((c) => c === "stroke").length).toBe(2);
  });
});
