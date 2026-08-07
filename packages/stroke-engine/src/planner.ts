import type { Point, Stroke } from "./types";
import { strokeLength } from "./types";
import { mulberry32 } from "./rng";
import { jitterStroke } from "./jitter";
import { parseMath } from "./math/parser";
import { layoutMath, layoutText } from "./math/layout";
import { realizeLayout } from "./realize";
import { diagramStrokes, type Diagram } from "./diagrams";

/** An op that puts ink on the board. */
export type DrawOp =
  | { type: "write_math"; tex: string; at: Point; size: number }
  | { type: "write_text"; text: string; at: Point; size: number }
  | { type: "draw_diagram"; diagram: Diagram; at: Point };

export type Op = DrawOp | { type: "new_page" };

/** Drawable area. Ink outside it would be clipped by the canvas. */
export interface Board {
  width: number;
  height: number;
  /** Inset used when relocating an op onto a fresh page. Default 24px. */
  margin?: number;
}

export interface PenStroke {
  points: Stroke;
  durationMs: number;
  /** 0-based; strokes are grouped into pages in drawing order. */
  page: number;
}

export interface RenderPlan {
  strokes: PenStroke[];
  totalMs: number;
  pages: number;
}

/** Thrown when an op cannot fit even on an empty board, so paging cannot help. */
export class LayoutOverflowError extends Error {
  constructor(
    message: string,
    readonly op: DrawOp,
    readonly required: { width: number; height: number },
    readonly board: Board
  ) {
    super(message);
    this.name = "LayoutOverflowError";
  }
}

const PEN_SPEED_PX_PER_MS = 0.45;
const MIN_STROKE_MS = 60;
const MAX_STROKE_MS = 2000;
/** Exported so callers (e.g. board-layout's renderability gate) can compute
 * usable board area the same way `buildPlan` does, without duplicating the value. */
export const DEFAULT_MARGIN = 24;
export const STROKE_GAP_MS = 60;
/** Pause holding the finished page before it is wiped for the next one. */
export const PAGE_BREAK_MS = 700;

interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

function opStrokes(
  op: DrawOp,
  at: Point
): { strokes: Stroke[]; jitterPx: number; jitterStep: number } {
  switch (op.type) {
    case "write_math": {
      const layout = layoutMath(parseMath(op.tex));
      return {
        strokes: realizeLayout(layout, at, op.size),
        jitterPx: 0.015 * op.size,
        jitterStep: 0.08 * op.size,
      };
    }
    case "write_text": {
      const layout = layoutText(op.text);
      return {
        strokes: realizeLayout(layout, at, op.size),
        jitterPx: 0.015 * op.size,
        jitterStep: 0.08 * op.size,
      };
    }
    case "draw_diagram":
      return { strokes: diagramStrokes(op.diagram, at), jitterPx: 2, jitterStep: 8 };
  }
}

function bboxOf(strokes: Stroke[]): Box | null {
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const s of strokes) {
    for (const p of s) {
      if (p.x < left) left = p.x;
      if (p.x > right) right = p.x;
      if (p.y < top) top = p.y;
      if (p.y > bottom) bottom = p.y;
    }
  }
  return Number.isFinite(left) ? { left, top, right, bottom } : null;
}

function fitsBoard(b: Box, board: Board): boolean {
  return b.left >= 0 && b.top >= 0 && b.right <= board.width && b.bottom <= board.height;
}

function pageDurationMs(strokes: PenStroke[]): number {
  return (
    strokes.reduce((acc, s) => acc + s.durationMs, 0) +
    Math.max(0, strokes.length - 1) * STROKE_GAP_MS
  );
}

/** Wall-clock length of a plan, including inter-stroke gaps and page turns. */
export function planDurationMs(strokes: PenStroke[]): number {
  let total = 0;
  for (let i = 0; i < strokes.length; i++) {
    if (i > 0) {
      total += strokes[i].page !== strokes[i - 1].page ? PAGE_BREAK_MS : STROKE_GAP_MS;
    }
    total += strokes[i].durationMs;
  }
  return total;
}

export function buildPlan(
  ops: Op[],
  opts: { seed?: number; jitterAmount?: number; board?: Board } = {}
): RenderPlan {
  const rng = mulberry32(opts.seed ?? 1);
  const { board } = opts;
  const margin = board?.margin ?? DEFAULT_MARGIN;
  const strokes: PenStroke[] = [];
  let page = 0;
  let pendingBreak = false;
  // Carried down the op list so the steps after an auto break keep their
  // relative spacing instead of each triggering a page of its own.
  let yOffset = 0;

  for (const op of ops) {
    if (op.type === "new_page") {
      pendingBreak = true;
      yOffset = 0; // explicit break: the caller's coordinates are taken as given
      continue;
    }

    let at: Point = { x: op.at.x, y: op.at.y + yOffset };
    let realized = opStrokes(op, at);

    if (board) {
      const box = bboxOf(realized.strokes);
      if (box && !fitsBoard(box, board)) {
        // Translate the op so its ink starts at the top-left margin. This
        // preserves its internal geometry for math, text and diagrams alike.
        const moved: Point = { x: at.x + (margin - box.left), y: at.y + (margin - box.top) };
        const fresh = opStrokes(op, moved);
        const freshBox = bboxOf(fresh.strokes)!;
        if (!fitsBoard(freshBox, board)) {
          const width = Math.ceil(freshBox.right - freshBox.left);
          const height = Math.ceil(freshBox.bottom - freshBox.top);
          throw new LayoutOverflowError(
            `op needs ${width}x${height}px and does not fit on an empty ` +
              `${board.width}x${board.height}px board (margin ${margin})`,
            op,
            { width, height },
            board
          );
        }
        pendingBreak = true;
        yOffset += moved.y - at.y;
        at = moved;
        realized = fresh;
      }
    }

    const amount = opts.jitterAmount ?? realized.jitterPx;
    for (const s of realized.strokes) {
      if (s.length < 2) continue; // degenerate strokes never enter the plan
      if (pendingBreak) {
        page++;
        pendingBreak = false; // only counts once ink actually lands: no empty pages
      }
      const jittered = jitterStroke(s, rng, amount, realized.jitterStep);
      const durationMs = Math.min(
        MAX_STROKE_MS,
        Math.max(MIN_STROKE_MS, strokeLength(jittered) / PEN_SPEED_PX_PER_MS)
      );
      strokes.push({ points: jittered, durationMs, page });
    }
  }

  const pages = strokes.reduce(
    (n, s, i) => (i > 0 && s.page !== strokes[i - 1].page ? n + 1 : n),
    strokes.length > 0 ? 1 : 0
  );
  return { strokes, totalMs: planDurationMs(strokes), pages };
}
