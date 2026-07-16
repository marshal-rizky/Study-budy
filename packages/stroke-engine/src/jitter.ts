import type { Point, Stroke } from "./types";
import { strokeLength } from "./types";

/** Resample a polyline to points spaced ~`step` apart (arc-length parametrized). */
export function resample(stroke: Stroke, step: number): Stroke {
  const total = strokeLength(stroke);
  if (total === 0 || stroke.length < 2) return stroke.slice();
  const n = Math.max(2, Math.ceil(total / step) + 1);
  const out: Stroke = [stroke[0]];
  let target = total / (n - 1);
  let acc = 0;
  let i = 1;
  let prev = stroke[0];
  while (i < stroke.length && out.length < n - 1) {
    const cur = stroke[i];
    const seg = Math.hypot(cur.x - prev.x, cur.y - prev.y);
    if (acc + seg >= target) {
      const t = (target - acc) / seg;
      const p = { x: prev.x + (cur.x - prev.x) * t, y: prev.y + (cur.y - prev.y) * t };
      out.push(p);
      prev = p;
      acc = 0;
      target = total / (n - 1);
    } else {
      acc += seg;
      prev = cur;
      i++;
    }
  }
  out.push(stroke[stroke.length - 1]);
  return out;
}

/**
 * Hand-tremor jitter: resample, then displace each point by smoothed noise.
 * Deterministic given the rng. Displacement per axis is bounded by `amount`.
 */
export function jitterStroke(
  stroke: Stroke,
  rng: () => number,
  amount: number,
  step = 0.06
): Stroke {
  const pts = resample(stroke, step);
  if (pts.length < 2 || amount === 0) return pts;
  // raw noise per point
  const raw: Point[] = pts.map(() => ({
    x: (rng() * 2 - 1) * amount,
    y: (rng() * 2 - 1) * amount,
  }));
  // moving-average smoothing (window 3) keeps wobble low-frequency, like a wrist
  const out: Stroke = pts.map((p, idx) => {
    const a = raw[Math.max(0, idx - 1)];
    const b = raw[idx];
    const c = raw[Math.min(raw.length - 1, idx + 1)];
    return {
      x: p.x + (a.x + b.x + c.x) / 3,
      y: p.y + (a.y + b.y + c.y) / 3,
    };
  });
  return out;
}
