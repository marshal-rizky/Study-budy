import type { RenderPlan, PenStroke } from "./planner";
import { STROKE_GAP_MS } from "./planner";
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

/** Draw the state of the plan at `elapsedMs`. Returns true when complete. */
export function renderFrame(plan: RenderPlan, elapsedMs: number, ctx: StrokeCtx): boolean {
  let t = elapsedMs;
  for (let i = 0; i < plan.strokes.length; i++) {
    const s = plan.strokes[i];
    if (t >= s.durationMs) {
      drawFull(s, ctx);
      t -= s.durationMs;
      if (i < plan.strokes.length - 1) {
        if (t < STROKE_GAP_MS) return false; // in the gap; later strokes not started
        t -= STROKE_GAP_MS;
      }
    } else {
      drawPartial(s, t / s.durationMs, ctx);
      return false;
    }
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
