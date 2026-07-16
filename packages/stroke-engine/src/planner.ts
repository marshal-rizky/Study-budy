import type { Point, Stroke } from "./types";
import { strokeLength } from "./types";
import { mulberry32 } from "./rng";
import { jitterStroke } from "./jitter";
import { parseMath } from "./math/parser";
import { layoutMath, layoutText } from "./math/layout";
import { realizeLayout } from "./realize";
import { diagramStrokes, type Diagram } from "./diagrams";

export type Op =
  | { type: "write_math"; tex: string; at: Point; size: number }
  | { type: "write_text"; text: string; at: Point; size: number }
  | { type: "draw_diagram"; diagram: Diagram; at: Point };

export interface PenStroke { points: Stroke; durationMs: number }
export interface RenderPlan { strokes: PenStroke[]; totalMs: number }

const PEN_SPEED_PX_PER_MS = 0.45;
const MIN_STROKE_MS = 60;
const MAX_STROKE_MS = 2000;
export const STROKE_GAP_MS = 60;

function opStrokes(op: Op): { strokes: Stroke[]; jitterPx: number; jitterStep: number } {
  switch (op.type) {
    case "write_math": {
      const layout = layoutMath(parseMath(op.tex));
      return {
        strokes: realizeLayout(layout, op.at, op.size),
        jitterPx: 0.015 * op.size,
        jitterStep: 0.08 * op.size,
      };
    }
    case "write_text": {
      const layout = layoutText(op.text);
      return {
        strokes: realizeLayout(layout, op.at, op.size),
        jitterPx: 0.015 * op.size,
        jitterStep: 0.08 * op.size,
      };
    }
    case "draw_diagram":
      return { strokes: diagramStrokes(op.diagram, op.at), jitterPx: 2, jitterStep: 8 };
  }
}

export function buildPlan(
  ops: Op[],
  opts: { seed?: number; jitterAmount?: number } = {}
): RenderPlan {
  const rng = mulberry32(opts.seed ?? 1);
  const strokes: PenStroke[] = [];
  for (const op of ops) {
    const { strokes: raw, jitterPx, jitterStep } = opStrokes(op);
    const amount = opts.jitterAmount ?? jitterPx;
    for (const s of raw) {
      const jittered = jitterStroke(s, rng, amount, jitterStep);
      const durationMs = Math.min(
        MAX_STROKE_MS,
        Math.max(MIN_STROKE_MS, strokeLength(jittered) / PEN_SPEED_PX_PER_MS)
      );
      strokes.push({ points: jittered, durationMs });
    }
  }
  const totalMs =
    strokes.reduce((acc, s) => acc + s.durationMs, 0) +
    Math.max(0, strokes.length - 1) * STROKE_GAP_MS;
  return { strokes, totalMs };
}
