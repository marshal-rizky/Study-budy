import type { GlyphDef, Stroke } from "../types";
import hersheyJson from "./hershey.json";
import { overrides } from "./overrides";

type JsonGlyph = { advance: number; strokes: [number, number][][] };

function toGlyph(j: JsonGlyph): GlyphDef {
  const strokes: Stroke[] = j.strokes.map((s) => s.map(([x, y]) => ({ x, y })));
  return { advance: j.advance, strokes };
}

const lib = new Map<string, GlyphDef>();
for (const [ch, j] of Object.entries(hersheyJson as Record<string, JsonGlyph>)) {
  lib.set(ch, toGlyph(j));
}

for (const [ch, def] of Object.entries(overrides)) {
  lib.set(ch, def);
}

/** Drawn when a char has no glyph: a small open box on the baseline. */
export const FALLBACK_GLYPH: GlyphDef = {
  advance: 0.7,
  strokes: [[
    { x: 0.05, y: 0 }, { x: 0.05, y: -0.6 }, { x: 0.55, y: -0.6 },
    { x: 0.55, y: 0 }, { x: 0.05, y: 0 },
  ]],
};

export function getGlyph(char: string): GlyphDef | undefined {
  return lib.get(char);
}

/** Register/override a glyph (used by overrides module and future ML swap-in). */
export function registerGlyph(char: string, def: GlyphDef): void {
  lib.set(char, def);
}
