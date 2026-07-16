import type { GlyphDef, Stroke } from "../types";

function ellipse(cx: number, cy: number, rx: number, ry: number, n = 16): Stroke {
  const pts: Stroke = [];
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2 - Math.PI / 2;
    pts.push({ x: cx + rx * Math.cos(a), y: cy + ry * Math.sin(a) });
  }
  return pts;
}

const dot = (x: number, y: number): Stroke => [
  { x, y }, { x: x + 0.03, y: y + 0.02 },
];

/** Hand-authored single-stroke math glyphs. Em units, baseline y=0, y down. */
export const overrides: Record<string, GlyphDef> = {
  "√": { advance: 0.9, strokes: [[
    { x: 0.05, y: -0.3 }, { x: 0.18, y: -0.05 }, { x: 0.4, y: -0.78 }, { x: 0.85, y: -0.78 },
  ]] },
  "∫": { advance: 0.5, strokes: [[
    { x: 0.42, y: -0.82 }, { x: 0.34, y: -0.9 }, { x: 0.26, y: -0.8 },
    { x: 0.26, y: 0.1 }, { x: 0.18, y: 0.2 }, { x: 0.1, y: 0.12 },
  ]] },
  "Σ": { advance: 0.7, strokes: [[
    { x: 0.6, y: -0.7 }, { x: 0.05, y: -0.7 }, { x: 0.35, y: -0.35 },
    { x: 0.05, y: 0 }, { x: 0.6, y: 0 },
  ]] },
  "π": { advance: 0.75, strokes: [
    [{ x: 0.02, y: -0.46 }, { x: 0.72, y: -0.5 }],
    [{ x: 0.2, y: -0.46 }, { x: 0.17, y: 0 }],
    [{ x: 0.52, y: -0.46 }, { x: 0.55, y: -0.06 }, { x: 0.63, y: 0 }],
  ] },
  "θ": { advance: 0.6, strokes: [
    ellipse(0.28, -0.35, 0.2, 0.37),
    [{ x: 0.1, y: -0.35 }, { x: 0.46, y: -0.35 }],
  ] },
  "Δ": { advance: 0.8, strokes: [[
    { x: 0.4, y: -0.7 }, { x: 0.05, y: 0 }, { x: 0.75, y: 0 }, { x: 0.4, y: -0.7 },
  ]] },
  "×": { advance: 0.6, strokes: [
    [{ x: 0.08, y: -0.5 }, { x: 0.5, y: -0.08 }],
    [{ x: 0.5, y: -0.5 }, { x: 0.08, y: -0.08 }],
  ] },
  "÷": { advance: 0.6, strokes: [
    [{ x: 0.06, y: -0.3 }, { x: 0.54, y: -0.3 }],
    dot(0.28, -0.5),
    dot(0.28, -0.1),
  ] },
  "±": { advance: 0.6, strokes: [
    [{ x: 0.3, y: -0.6 }, { x: 0.3, y: -0.2 }],
    [{ x: 0.08, y: -0.4 }, { x: 0.52, y: -0.4 }],
    [{ x: 0.08, y: -0.02 }, { x: 0.52, y: -0.02 }],
  ] },
  "→": { advance: 0.9, strokes: [
    [{ x: 0.05, y: -0.3 }, { x: 0.8, y: -0.3 }],
    [{ x: 0.62, y: -0.45 }, { x: 0.8, y: -0.3 }, { x: 0.62, y: -0.15 }],
  ] },
  "≠": { advance: 0.65, strokes: [
    [{ x: 0.08, y: -0.4 }, { x: 0.56, y: -0.4 }],
    [{ x: 0.08, y: -0.2 }, { x: 0.56, y: -0.2 }],
    [{ x: 0.44, y: -0.58 }, { x: 0.2, y: -0.02 }],
  ] },
  "≤": { advance: 0.65, strokes: [
    [{ x: 0.55, y: -0.6 }, { x: 0.08, y: -0.36 }, { x: 0.55, y: -0.14 }],
    [{ x: 0.08, y: 0 }, { x: 0.55, y: 0 }],
  ] },
  "≥": { advance: 0.65, strokes: [
    [{ x: 0.08, y: -0.6 }, { x: 0.55, y: -0.36 }, { x: 0.08, y: -0.14 }],
    [{ x: 0.08, y: 0 }, { x: 0.55, y: 0 }],
  ] },
  "≈": { advance: 0.65, strokes: [
    [{ x: 0.06, y: -0.38 }, { x: 0.2, y: -0.46 }, { x: 0.4, y: -0.32 }, { x: 0.56, y: -0.42 }],
    [{ x: 0.06, y: -0.16 }, { x: 0.2, y: -0.24 }, { x: 0.4, y: -0.1 }, { x: 0.56, y: -0.2 }],
  ] },
  "⇌": { advance: 0.95, strokes: [
    [{ x: 0.06, y: -0.42 }, { x: 0.85, y: -0.42 }],
    [{ x: 0.68, y: -0.56 }, { x: 0.85, y: -0.42 }],
    [{ x: 0.06, y: -0.22 }, { x: 0.85, y: -0.22 }],
    [{ x: 0.23, y: -0.08 }, { x: 0.06, y: -0.22 }],
  ] },
};
