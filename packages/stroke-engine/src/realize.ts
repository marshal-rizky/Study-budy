import type { Point, Stroke } from "./types";
import type { MathLayout } from "./math/layout";
import { getGlyph, FALLBACK_GLYPH } from "./glyphs/library";

/** Convert an em-space layout into canvas-pixel strokes, in writing order. */
export function realizeLayout(layout: MathLayout, origin: Point, fontSizePx: number): Stroke[] {
  const out: Stroke[] = [];
  for (const p of layout.placements) {
    const glyph = getGlyph(p.char) ?? FALLBACK_GLYPH;
    for (const s of glyph.strokes) {
      out.push(
        s.map((pt) => ({
          x: origin.x + (p.x + pt.x * p.scale) * fontSizePx,
          y: origin.y + (p.y + pt.y * p.scale) * fontSizePx,
        }))
      );
    }
  }
  for (const l of layout.lines) {
    out.push([
      { x: origin.x + l.x1 * fontSizePx, y: origin.y + l.y1 * fontSizePx },
      { x: origin.x + l.x2 * fontSizePx, y: origin.y + l.y2 * fontSizePx },
    ]);
  }
  return out;
}
