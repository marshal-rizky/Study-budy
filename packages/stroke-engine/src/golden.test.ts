import { describe, it, expect } from "vitest";
import { buildPlan } from "./planner";
import type { Op } from "./planner";

const GOLDEN: { name: string; ops: Op[] }[] = [
  { name: "linear-equation", ops: [{ type: "write_math", tex: "2x+3=7", at: { x: 40, y: 80 }, size: 42 }] },
  { name: "quadratic-formula", ops: [{ type: "write_math", tex: "x=\\frac{-b\\pm\\sqrt{b^2-4ac}}{2a}", at: { x: 40, y: 120 }, size: 42 }] },
  { name: "physics-kinematics", ops: [{ type: "write_math", tex: "v=v_0+at", at: { x: 40, y: 80 }, size: 42 }] },
  { name: "greek-and-symbols", ops: [{ type: "write_math", tex: "\\Delta\\theta\\approx\\pi\\div2", at: { x: 40, y: 80 }, size: 42 }] },
  {
    name: "parabola-plot",
    ops: [
      { type: "draw_diagram", diagram: { kind: "axes", width: 260, height: 180 }, at: { x: 40, y: 260 } },
      {
        type: "draw_diagram",
        diagram: { kind: "curve", fn: (x) => x * x, domain: [-2, 2], width: 260, height: 180, yRange: [0, 4] },
        at: { x: 40, y: 260 },
      },
      { type: "write_math", tex: "y=x^2", at: { x: 220, y: 110 }, size: 30 },
    ],
  },
  {
    name: "benzene",
    ops: [{ type: "draw_diagram", diagram: { kind: "benzene", center: { x: 120, y: 120 }, radius: 60 }, at: { x: 0, y: 0 } }],
  },
];

function summarize(ops: Op[]) {
  const plan = buildPlan(ops, { seed: 42 });
  return {
    strokeCount: plan.strokes.length,
    totalMs: Math.round(plan.totalMs),
    strokes: plan.strokes.map((s) => ({
      durationMs: Math.round(s.durationMs),
      points: s.points.map((p) => [Math.round(p.x * 100) / 100, Math.round(p.y * 100) / 100]),
    })),
  };
}

describe("golden renders (seed 42)", () => {
  it.each(GOLDEN)("$name", ({ ops }) => {
    expect(summarize(ops)).toMatchSnapshot();
  });
});
