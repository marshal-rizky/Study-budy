/**
 * Glyph coordinate convention (whole engine):
 * - em units; font size in px is applied at realization time
 * - baseline at y = 0, y increases DOWNWARD (canvas convention)
 * - cap height ≈ 0.7 em (so 'H' spans y ∈ [-0.7, 0]); descenders go below (y > 0)
 */
export interface Point {
  x: number;
  y: number;
}

export type Stroke = Point[];

/** One pre-baked glyph: ordered pen strokes in em units + horizontal advance. */
export interface GlyphDef {
  advance: number;
  strokes: Stroke[];
}

export function strokeLength(s: Stroke): number {
  let len = 0;
  for (let i = 1; i < s.length; i++) {
    len += Math.hypot(s[i].x - s[i - 1].x, s[i].y - s[i - 1].y);
  }
  return len;
}
