import type { MathNode } from "./parser";
import { getGlyph } from "../glyphs/library";

export interface GlyphPlacement { char: string; x: number; y: number; scale: number }
export interface LineSeg { x1: number; y1: number; x2: number; y2: number }
export interface MathLayout {
  placements: GlyphPlacement[];
  lines: LineSeg[];
  width: number;
  ascent: number;
  descent: number;
}

const AXIS = -0.26;          // math axis (fraction bar height), em × scale
const SCRIPT_SCALE = 0.6;
const SUP_SHIFT = -0.42;
const SUB_SHIFT = 0.18;
const FRAC_GAP = 0.1;
const OP_PAD = 0.12;
const ROW_ASCENT = 0.8;
const ROW_DESCENT = 0.25;
const BINARY_OPS = new Set(["+", "-", "−", "=", "×", "÷", "±", "→", "≠", "≤", "≥", "≈", "<", ">", "⇌"]);
const DEFAULT_ADVANCE = 0.6;

function advanceOf(char: string): number {
  return getGlyph(char)?.advance ?? DEFAULT_ADVANCE;
}

function translate(l: MathLayout, dx: number, dy: number): MathLayout {
  return {
    placements: l.placements.map((p) => ({ ...p, x: p.x + dx, y: p.y + dy })),
    lines: l.lines.map((s) => ({ x1: s.x1 + dx, y1: s.y1 + dy, x2: s.x2 + dx, y2: s.y2 + dy })),
    width: l.width,
    ascent: l.ascent - dy, // shifting down (dy>0) reduces ascent relative to new baseline caller frame
    descent: l.descent + dy,
  };
}

function layoutNode(node: MathNode, scale: number): MathLayout {
  switch (node.type) {
    case "sym": {
      const pad = BINARY_OPS.has(node.char) ? OP_PAD * scale : 0;
      return {
        placements: [{ char: node.char, x: pad, y: 0, scale }],
        lines: [],
        width: advanceOf(node.char) * scale + 2 * pad,
        ascent: ROW_ASCENT * scale,
        descent: ROW_DESCENT * scale,
      };
    }
    case "row": {
      const out: MathLayout = { placements: [], lines: [], width: 0, ascent: 0, descent: 0 };
      for (const child of node.children) {
        const c = layoutNode(child, scale);
        const shifted = translate(c, out.width, 0);
        out.placements.push(...shifted.placements);
        out.lines.push(...shifted.lines);
        out.width += c.width;
        out.ascent = Math.max(out.ascent, c.ascent);
        out.descent = Math.max(out.descent, c.descent);
      }
      if (node.children.length === 0) {
        out.ascent = ROW_ASCENT * scale;
        out.descent = ROW_DESCENT * scale;
      }
      return out;
    }
    case "frac": {
      const num = layoutNode(node.num, scale);
      const den = layoutNode(node.den, scale);
      const axis = AXIS * scale;
      const gap = FRAC_GAP * scale;
      const width = Math.max(num.width, den.width) + 0.2 * scale;
      const numDy = axis - gap - num.descent;   // numerator baseline
      const denDy = axis + gap + den.ascent;    // denominator baseline
      const numL = translate(num, (width - num.width) / 2, numDy);
      const denL = translate(den, (width - den.width) / 2, denDy);
      return {
        placements: [...numL.placements, ...denL.placements],
        lines: [
          ...numL.lines, ...denL.lines,
          { x1: 0.05 * scale, y1: axis, x2: width - 0.05 * scale, y2: axis },
        ],
        width,
        ascent: -(numDy) + num.ascent,
        descent: denDy + den.descent,
      };
    }
    case "sup": {
      const base = layoutNode(node.base, scale);
      const exp = layoutNode(node.exp, scale * SCRIPT_SCALE);
      const shift = SUP_SHIFT * scale;
      const expL = translate(exp, base.width, shift);
      return {
        placements: [...base.placements, ...expL.placements],
        lines: [...base.lines, ...expL.lines],
        width: base.width + exp.width,
        ascent: Math.max(base.ascent, -shift + exp.ascent),
        descent: base.descent,
      };
    }
    case "sub": {
      const base = layoutNode(node.base, scale);
      const sub = layoutNode(node.sub, scale * SCRIPT_SCALE);
      const shift = SUB_SHIFT * scale;
      const subL = translate(sub, base.width, shift);
      return {
        placements: [...base.placements, ...subL.placements],
        lines: [...base.lines, ...subL.lines],
        width: base.width + sub.width,
        ascent: base.ascent,
        descent: Math.max(base.descent, shift + sub.descent),
      };
    }
    case "sqrt": {
      // √ glyph ink (see glyphs/overrides.ts): y ∈ [RADICAL_TOP, RADICAL_BOTTOM], arm tip at x = RADICAL_TIP_X
      const RADICAL_TOP = -0.78;
      const RADICAL_BOTTOM = -0.05;
      const RADICAL_TIP_X = 0.85;
      const RADICAL_HEIGHT = RADICAL_BOTTOM - RADICAL_TOP; // 0.73
      const body = layoutNode(node.body, scale);
      const gap = 0.08 * scale; // vinculum clearance above body ink
      // scale the radical so its ink spans the body plus the bar clearance
      const radicalScale = Math.max(
        scale,
        (body.ascent + body.descent + gap) / RADICAL_HEIGHT
      );
      // anchor the glyph so its bottom hook sits at the body's descent
      const dy = body.descent - RADICAL_BOTTOM * radicalScale;
      const glyphTop = dy + RADICAL_TOP * radicalScale; // == -(body.ascent + gap)
      const radicalAdvance = advanceOf("√") * radicalScale;
      const bodyL = translate(body, radicalAdvance, 0);
      const barY = glyphTop; // vinculum meets the arm exactly
      return {
        placements: [
          { char: "√", x: 0, y: dy, scale: radicalScale },
          ...bodyL.placements,
        ],
        lines: [
          ...bodyL.lines,
          { x1: RADICAL_TIP_X * radicalScale, y1: barY, x2: radicalAdvance + body.width, y2: barY },
        ],
        width: radicalAdvance + body.width + 0.05 * scale,
        ascent: -barY + 0.05 * scale,
        descent: body.descent,
      };
    }
  }
}

export function layoutMath(node: MathNode, scale = 1): MathLayout {
  return layoutNode(node, scale);
}

export function layoutText(text: string, scale = 1): MathLayout {
  return layoutNode(
    { type: "row", children: [...text].map((char) => ({ type: "sym" as const, char })) },
    scale
  );
}
