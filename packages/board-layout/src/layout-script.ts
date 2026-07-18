import type { BoardScript, DiagramSpec } from "@teacher/protocol";
import { layoutMath, layoutText, parseMath } from "@teacher/stroke-engine";
import type { Board, Diagram, Op } from "@teacher/stroke-engine";
import { compileExpr } from "./expr";

export interface LayoutOptions {
  /** Font size in px for math/text ops. Default 32. */
  size?: number;
  /** Left/top inset in px. Default 40. */
  margin?: number;
  /** Vertical gap in px between steps. Default 18. */
  leading?: number;
}

function toDiagram(spec: DiagramSpec): Diagram {
  switch (spec.kind) {
    case "axes":
      return { kind: "axes", width: spec.width, height: spec.height };
    case "curve":
      return {
        kind: "curve",
        fn: compileExpr(spec.expr),
        domain: spec.domain,
        width: spec.width,
        height: spec.height,
        yRange: spec.yRange,
      };
    case "arrow":
      return { kind: "arrow", from: spec.from, to: spec.to };
    case "benzene":
      // Engine's benzene adds `at` to `center`; anchoring center at
      // (radius, radius) makes the ring span [cursor, cursor + 2*radius].
      return { kind: "benzene", center: { x: spec.radius, y: spec.radius }, radius: spec.radius };
  }
}

/**
 * Deterministically assigns coordinates to a position-free BoardScript. The
 * director (LLM) never computes pixels -- it emits semantic steps in order,
 * and this walks them top-to-bottom, left-aligned at `margin`, advancing the
 * vertical cursor by each step's own measured height (never a fixed line
 * height) so tall content never collides with what follows.
 *
 * `board` is accepted per the Phase 2 op contract for future width-aware
 * layout decisions; this implementation does not use it -- `buildPlan`
 * already measures ops against the board and paginates/throws on overflow.
 */
export function layoutScript(script: BoardScript, board: Board, opts: LayoutOptions = {}): Op[] {
  void board;
  const size = opts.size ?? 32;
  const margin = opts.margin ?? 40;
  const leading = opts.leading ?? 18;

  const ops: Op[] = [];
  let cursor = margin;

  for (const step of script.steps) {
    switch (step.kind) {
      case "new_page": {
        ops.push({ type: "new_page" });
        cursor = margin;
        break;
      }

      case "math": {
        const layout = layoutMath(parseMath(step.tex));
        const baseline = cursor + layout.ascent * size;
        ops.push({ type: "write_math", tex: step.tex, at: { x: margin, y: baseline }, size });
        cursor = baseline + layout.descent * size + leading;
        break;
      }

      case "text": {
        const layout = layoutText(step.text);
        const baseline = cursor + layout.ascent * size;
        ops.push({ type: "write_text", text: step.text, at: { x: margin, y: baseline }, size });
        cursor = baseline + layout.descent * size + leading;
        break;
      }

      case "diagram": {
        const diagram = toDiagram(step.diagram);
        let at: { x: number; y: number };
        switch (diagram.kind) {
          case "axes":
          case "curve": {
            at = { x: margin, y: cursor + diagram.height };
            cursor = at.y + leading;
            break;
          }
          case "benzene": {
            at = { x: margin, y: cursor };
            cursor = cursor + 2 * diagram.radius + leading;
            break;
          }
          case "arrow": {
            at = { x: margin, y: cursor };
            cursor = cursor + Math.max(Math.abs(diagram.to.y - diagram.from.y), 1) + leading;
            break;
          }
        }
        ops.push({ type: "draw_diagram", diagram, at });
        break;
      }
    }
  }

  return ops;
}
