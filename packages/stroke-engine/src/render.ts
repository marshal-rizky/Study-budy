import type { RenderPlan, PenStroke } from "./planner";
import { STROKE_GAP_MS, PAGE_BREAK_MS } from "./planner";
import { strokeLength } from "./types";

export interface StrokeCtx {
  beginPath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  stroke(): void;
}

function drawFull(s: PenStroke, ctx: StrokeCtx): void {
  ctx.beginPath();
  ctx.moveTo(s.points[0].x, s.points[0].y);
  for (let i = 1; i < s.points.length; i++) ctx.lineTo(s.points[i].x, s.points[i].y);
  ctx.stroke();
}

function drawPartial(s: PenStroke, fraction: number, ctx: StrokeCtx): void {
  const target = strokeLength(s.points) * fraction;
  if (target <= 0) return;
  ctx.beginPath();
  ctx.moveTo(s.points[0].x, s.points[0].y);
  let acc = 0;
  let drew = false;
  for (let i = 1; i < s.points.length; i++) {
    const a = s.points[i - 1];
    const b = s.points[i];
    const seg = Math.hypot(b.x - a.x, b.y - a.y);
    if (acc + seg <= target) {
      ctx.lineTo(b.x, b.y);
      drew = true;
      acc += seg;
    } else {
      const t = (target - acc) / seg;
      ctx.lineTo(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);
      drew = true;
      break;
    }
  }
  if (drew) ctx.stroke();
}

/** Draw one page's strokes at local time `t`. Returns true once all are drawn. */
function drawPage(page: PenStroke[], t: number, ctx: StrokeCtx): boolean {
  let rem = t;
  for (let i = 0; i < page.length; i++) {
    const s = page[i];
    if (rem >= s.durationMs) {
      drawFull(s, ctx);
      rem -= s.durationMs;
      if (i < page.length - 1) {
        if (rem < STROKE_GAP_MS) return false; // in the gap; later strokes not started
        rem -= STROKE_GAP_MS;
      }
    } else {
      drawPartial(s, rem / s.durationMs, ctx);
      return false;
    }
  }
  return true;
}

/**
 * Draw the state of the plan at `elapsedMs`. Returns true when complete.
 * Only the page current at `elapsedMs` is drawn: finished pages are held for
 * PAGE_BREAK_MS and then wiped, so the caller's clear leaves a blank board.
 */
export function renderFrame(plan: RenderPlan, elapsedMs: number, ctx: StrokeCtx): boolean {
  const n = plan.strokes.length;
  if (n === 0) return true;
  let t = elapsedMs;
  let i = 0;
  while (i < n) {
    let j = i;
    while (j < n && plan.strokes[j].page === plan.strokes[i].page) j++;
    const page = plan.strokes.slice(i, j);
    if (j >= n) return drawPage(page, t, ctx); // last page
    const pageMs =
      page.reduce((acc, s) => acc + s.durationMs, 0) + (page.length - 1) * STROKE_GAP_MS;
    if (t < pageMs) return drawPage(page, t, ctx);
    t -= pageMs;
    if (t < PAGE_BREAK_MS) {
      drawPage(page, pageMs, ctx); // hold the finished page during the turn
      return false;
    }
    t -= PAGE_BREAK_MS;
    i = j;
  }
  return true;
}

/** Thin requestAnimationFrame wrapper around renderFrame. Not unit-tested. */
export class Player {
  private plan: RenderPlan | null = null;
  private startTime = 0;
  private pausedAt: number | null = null;
  private raf = 0;

  constructor(
    private ctx: StrokeCtx,
    private opts: { clear?: () => void } = {}
  ) {}

  play(plan: RenderPlan): void {
    this.stop();
    this.plan = plan;
    this.startTime = performance.now();
    this.tick();
  }

  pause(): void {
    if (this.pausedAt === null && this.plan) {
      this.pausedAt = performance.now();
      cancelAnimationFrame(this.raf);
    }
  }

  resume(): void {
    if (this.pausedAt !== null) {
      this.startTime += performance.now() - this.pausedAt;
      this.pausedAt = null;
      this.tick();
    }
  }

  replay(): void {
    if (this.plan) this.play(this.plan);
  }

  stop(): void {
    cancelAnimationFrame(this.raf);
    this.pausedAt = null;
  }

  private tick = (): void => {
    if (!this.plan) return;
    this.opts.clear?.();
    const done = renderFrame(this.plan, performance.now() - this.startTime, this.ctx);
    if (!done && this.pausedAt === null) {
      this.raf = requestAnimationFrame(this.tick);
    }
  };
}
