import { describe, it, expect } from "vitest";
import { buildPlan, LayoutOverflowError, PAGE_BREAK_MS, STROKE_GAP_MS } from "./planner";
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
  it("filters degenerate strokes (<2 points) out of the plan", () => {
    const plan = buildPlan(
      [{
        type: "draw_diagram",
        diagram: { kind: "curve", fn: () => NaN, domain: [0, 1], width: 100, height: 100, yRange: [0, 1] },
        at: { x: 0, y: 0 },
      }],
      { seed: 42 }
    );
    expect(plan.strokes).toHaveLength(0);
    expect(plan.totalMs).toBe(0);
  });
  it("throws MathParseError for bad TeX (caller handles per spec §6)", () => {
    expect(() =>
      buildPlan([{ type: "write_math", tex: "\\bogus", at: { x: 0, y: 0 }, size: 40 }])
    ).toThrow();
  });
});

describe("bounds checking and paging", () => {
  const BOARD = { width: 900, height: 520 };
  const line = (y: number): Op => ({
    type: "write_math",
    tex: "x=2",
    at: { x: 60, y },
    size: 32,
  });

  it("leaves everything on one page when it fits", () => {
    const plan = buildPlan([line(80), line(160)], { seed: 42, board: BOARD });
    expect(plan.pages).toBe(1);
    expect(plan.strokes.every((s) => s.page === 0)).toBe(true);
  });

  it("ignores bounds entirely when no board is given", () => {
    const plan = buildPlan([line(5000)], { seed: 42 });
    expect(plan.pages).toBe(1);
    const maxY = Math.max(...plan.strokes.flatMap((s) => s.points.map((p) => p.y)));
    expect(maxY).toBeGreaterThan(BOARD.height); // drawn off-board, as before
  });

  it("breaks to a new page when a line runs past the bottom", () => {
    const plan = buildPlan([line(80), line(700)], { seed: 42, board: BOARD });
    expect(plan.pages).toBe(2);
    const page1 = plan.strokes.filter((s) => s.page === 1);
    expect(page1.length).toBeGreaterThan(0);
    const top = Math.min(...page1.flatMap((s) => s.points.map((p) => p.y)));
    expect(top).toBeCloseTo(24, 0); // relocated to the top margin
  });

  it("keeps all ink inside the board once paged", () => {
    const ops = Array.from({ length: 12 }, (_, i) => line(80 + i * 90));
    const plan = buildPlan(ops, { seed: 42, board: BOARD });
    expect(plan.pages).toBeGreaterThan(1);
    for (const s of plan.strokes) {
      for (const p of s.points) {
        expect(p.x).toBeGreaterThanOrEqual(0);
        expect(p.y).toBeGreaterThanOrEqual(0);
        expect(p.x).toBeLessThanOrEqual(BOARD.width);
        expect(p.y).toBeLessThanOrEqual(BOARD.height);
      }
    }
  });

  it("carries the offset so following lines keep their spacing", () => {
    // three evenly spaced lines; the second overflows and pages
    const plan = buildPlan([line(80), line(700), line(790)], { seed: 42, board: BOARD });
    expect(plan.pages).toBe(2);
    const pageOf = (i: number) => plan.strokes.filter((s) => s.page === i);
    const topOf = (list: typeof plan.strokes) =>
      Math.min(...list.flatMap((s) => s.points.map((p) => p.y)));
    // both later lines land on page 1, 90px apart, not one page each
    expect(pageOf(1).length).toBeGreaterThan(0);
    expect(topOf(pageOf(1))).toBeCloseTo(24, 0);
    const bottom = Math.max(...pageOf(1).flatMap((s) => s.points.map((p) => p.y)));
    expect(bottom).toBeGreaterThan(90); // second line is below the first
  });

  it("honours an explicit new_page op", () => {
    const plan = buildPlan([line(80), { type: "new_page" }, line(160)], {
      seed: 42,
      board: BOARD,
    });
    expect(plan.pages).toBe(2);
  });

  it("does not emit empty pages for back-to-back new_page ops", () => {
    const plan = buildPlan(
      [line(80), { type: "new_page" }, { type: "new_page" }, line(160)],
      { seed: 42, board: BOARD }
    );
    expect(plan.pages).toBe(2);
  });

  it("charges a page turn instead of a stroke gap between pages", () => {
    const one = buildPlan([line(80), line(160)], { seed: 42, board: BOARD });
    const two = buildPlan([line(80), { type: "new_page" }, line(160)], {
      seed: 42,
      board: BOARD,
    });
    expect(two.totalMs - one.totalMs).toBeCloseTo(PAGE_BREAK_MS - STROKE_GAP_MS, 5);
  });

  it("throws when content cannot fit on an empty board", () => {
    const huge: Op = {
      type: "write_math",
      tex: "x=\frac{-5\pm\sqrt{5^2-4(2)(-3)}}{2(2)}=\frac{-5\pm\sqrt{25+24}}{4}=\frac{-5\pm7}{4}",
      at: { x: 40, y: 200 },
      size: 32,
    };
    expect(() => buildPlan([huge], { seed: 42, board: { width: 400, height: 520 } })).toThrow(
      LayoutOverflowError
    );
    try {
      buildPlan([huge], { seed: 42, board: { width: 400, height: 520 } });
    } catch (e) {
      const err = e as LayoutOverflowError;
      expect(err.required.width).toBeGreaterThan(400);
      expect(err.op).toBe(huge);
    }
  });
});
