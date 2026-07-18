export const ENGINE_VERSION = "0.1.0";
export * from "./types";
export * from "./rng";
export { getGlyph, registerGlyph, FALLBACK_GLYPH } from "./glyphs/library";
export { jitterStroke, resample } from "./jitter";
export { parseMath, MathParseError } from "./math/parser";
export type { MathNode } from "./math/parser";
export { layoutMath, layoutText } from "./math/layout";
export type { MathLayout, GlyphPlacement, LineSeg } from "./math/layout";
export { realizeLayout } from "./realize";
export { diagramStrokes } from "./diagrams";
export type { Diagram } from "./diagrams";
export {
  buildPlan,
  planDurationMs,
  LayoutOverflowError,
  STROKE_GAP_MS,
  PAGE_BREAK_MS,
} from "./planner";
export type { Op, DrawOp, Board, PenStroke, RenderPlan } from "./planner";
export { renderFrame, Player } from "./render";
export type { StrokeCtx } from "./render";
