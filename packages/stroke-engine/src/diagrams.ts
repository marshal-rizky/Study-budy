import type { Point, Stroke } from "./types";

export type Diagram =
  | { kind: "axes"; width: number; height: number }
  | { kind: "curve"; fn: (x: number) => number; domain: [number, number];
      width: number; height: number; yRange: [number, number] }
  | { kind: "arrow"; from: Point; to: Point }
  | { kind: "benzene"; center: Point; radius: number };

const HEAD_LEN = 12;
const HEAD_ANGLE = Math.PI / 7;

function arrowHead(from: Point, to: Point): Stroke[] {
  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  const wing = (side: number): Stroke => [
    {
      x: to.x - HEAD_LEN * Math.cos(angle + side * HEAD_ANGLE),
      y: to.y - HEAD_LEN * Math.sin(angle + side * HEAD_ANGLE),
    },
    { x: to.x, y: to.y },
  ];
  return [wing(1), wing(-1)];
}

export function diagramStrokes(d: Diagram, origin: Point): Stroke[] {
  switch (d.kind) {
    case "axes": {
      const xEnd = { x: origin.x + d.width, y: origin.y };
      const yEnd = { x: origin.x, y: origin.y - d.height };
      return [
        [{ x: origin.x, y: origin.y }, xEnd],
        ...arrowHead(origin, xEnd),
        [{ x: origin.x, y: origin.y }, yEnd],
        ...arrowHead(origin, yEnd),
      ];
    }
    case "curve": {
      const [x0, x1] = d.domain;
      const [y0, y1] = d.yRange;
      const n = 48;
      const pts: Stroke = [];
      for (let i = 0; i <= n; i++) {
        const mx = x0 + ((x1 - x0) * i) / n;
        const raw = d.fn(mx);
        if (!Number.isFinite(raw)) continue; // skip undefined regions (e.g. sqrt of negative)
        const my = Math.min(y1, Math.max(y0, raw));
        pts.push({
          x: origin.x + ((mx - x0) / (x1 - x0)) * d.width,
          y: origin.y - ((my - y0) / (y1 - y0)) * d.height,
        });
      }
      return [pts];
    }
    case "arrow": {
      const from = { x: origin.x + d.from.x, y: origin.y + d.from.y };
      const to = { x: origin.x + d.to.x, y: origin.y + d.to.y };
      // shaft, then a single bent head stroke (wing-tip -> tip -> wing-tip)
      const [w1, w2] = arrowHead(from, to);
      return [[from, to], [w1[0], w1[1], w2[0]]];
    }
    case "benzene": {
      const c = { x: origin.x + d.center.x, y: origin.y + d.center.y };
      const hex: Stroke = [];
      for (let i = 0; i <= 6; i++) {
        const a = (i / 6) * Math.PI * 2 - Math.PI / 2;
        hex.push({ x: c.x + d.radius * Math.cos(a), y: c.y + d.radius * Math.sin(a) });
      }
      const circle: Stroke = [];
      const r = d.radius * 0.6;
      for (let i = 0; i <= 20; i++) {
        const a = (i / 20) * Math.PI * 2;
        circle.push({ x: c.x + r * Math.cos(a), y: c.y + r * Math.sin(a) });
      }
      return [hex, circle];
    }
  }
}
