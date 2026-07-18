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
    { points: [{ x: 0, y: 0 }, { x: 100, y: 0 }], durationMs: 100, page: 0 },
    { points: [{ x: 0, y: 10 }, { x: 100, y: 10 }], durationMs: 100, page: 0 },
  ],
  totalMs: 260, // 100 + 60 gap + 100
  pages: 1,
};

// two single-stroke pages: 100 + 700 page turn + 100
const paged: RenderPlan = {
  strokes: [
    { points: [{ x: 0, y: 0 }, { x: 100, y: 0 }], durationMs: 100, page: 0 },
    { points: [{ x: 0, y: 10 }, { x: 100, y: 10 }], durationMs: 100, page: 1 },
  ],
  totalMs: 900,
  pages: 2,
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

describe("renderFrame across pages", () => {
  it("holds the finished page during the turn", () => {
    const ctx = stubCtx();
    const done = renderFrame(paged, 400, ctx); // inside 100..800 page turn
    expect(done).toBe(false);
    expect(ctx.calls.filter((c) => c === "stroke").length).toBe(1);
  });
  it("wipes page 0 once page 1 starts", () => {
    const ctx = stubCtx();
    renderFrame(paged, 850, ctx); // 50ms into page 1
    // only the second page's stroke is drawn; page 0 is gone
    expect(ctx.calls.filter((c) => c === "stroke").length).toBe(1);
    expect(ctx.calls.filter((c) => c === "moveTo").length).toBe(1);
  });
  it("reports done at the end of the last page, not before", () => {
    const ctx = stubCtx();
    expect(renderFrame(paged, 899, ctx)).toBe(false);
    expect(renderFrame(paged, 900, stubCtx())).toBe(true);
  });
});
