import type { BoardScript, BoardStep, DiagramSpec } from "@teacher/protocol";
import {
  buildPlan,
  DEFAULT_MARGIN,
  LayoutOverflowError,
  layoutMath,
  layoutText,
  MathParseError,
  parseMath,
  SYMBOL_COMMANDS,
} from "@teacher/stroke-engine";
import type { Board, Diagram, Op } from "@teacher/stroke-engine";
import { compileExpr, ExprError } from "./expr";

export interface LayoutOptions {
  /** Font size in px for math/text ops. Default 32. */
  size?: number;
  /** Left/top inset in px. Default 40. */
  margin?: number;
  /** Vertical gap in px between steps. Default 18. */
  leading?: number;
}

/**
 * Greedily word-wraps `text` so each line's measured width (via `layoutText`,
 * i.e. real glyph metrics -- not a character count) fits within `usableWidth`
 * px at the given font `size`. This is Bug 3: a model wrote a whole paragraph
 * as one `write_text` step, which measured ~1667px wide against a 900px
 * board and blew up the WHOLE derivation with a `LayoutOverflowError`
 * downstream in `buildPlan` -- one over-long step should never discard an
 * otherwise-correct multi-step derivation.
 *
 * Edge case: a single word wider than `usableWidth` on its own. We do not
 * hard-break it mid-word (splitting a word makes the board harder to read,
 * and hyphenation needs a dictionary this engine doesn't have) and we do not
 * loop forever trying to shrink it to fit -- it is emitted as its own line
 * and allowed to overflow. That line then either fits when `buildPlan`
 * relocates it to a fresh page's margin, or throws `LayoutOverflowError` --
 * the same behavior a single-word step already had before this fix, just
 * scoped to one line instead of the whole step.
 */
function wrapTextToWidth(text: string, size: number, usableWidth: number): string[] {
  const words = text.split(/\s+/).filter((w) => w.length > 0);
  if (words.length === 0) return [text];

  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const candidate = current.length > 0 ? `${current} ${word}` : word;
    const width = layoutText(candidate).width * size;
    if (width <= usableWidth || current.length === 0) {
      // Fits, or `current` is empty so `word` is the only thing that could
      // start this line (the over-long-word edge case above) -- either way
      // it belongs on the line being built.
      current = candidate;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current.length > 0) lines.push(current);

  return lines;
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
 * `board.width` is used to word-wrap `text` steps that would otherwise
 * overflow (see `wrapTextToWidth`); `buildPlan` still measures every op
 * against the board and paginates/throws on overflow independently of this.
 */
export function layoutScript(script: BoardScript, board: Board, opts: LayoutOptions = {}): Op[] {
  const size = opts.size ?? 32;
  const margin = opts.margin ?? 40;
  const leading = opts.leading ?? 18;
  const usableWidth = board.width - 2 * margin;

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
        const fullWidth = layoutText(step.text).width * size;
        const lines =
          fullWidth > usableWidth ? wrapTextToWidth(step.text, size, usableWidth) : [step.text];
        for (const line of lines) {
          const layout = layoutText(line);
          const baseline = cursor + layout.ascent * size;
          ops.push({ type: "write_text", text: line, at: { x: margin, y: baseline }, size });
          cursor = baseline + layout.descent * size + leading;
        }
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

export type RenderCheck = { ok: true } | { ok: false; reason: string };

/** Built from the parser's own supported-symbol table so this can never drift
 * from what `parseMath` actually accepts (see math/parser.ts SYMBOL_COMMANDS). */
const SUPPORTED_TEX_COMMANDS = ["\\frac", "\\sqrt", "^", "_", ...Object.keys(SYMBOL_COMMANDS).map((c) => `\\${c}`)].join(
  " "
);

/**
 * Turns a throw from the real render path into an actionable, model-readable
 * reason string -- naming the offending construct rather than just echoing a
 * raw stack-trace-flavored message.
 */
function describeRenderError(err: unknown, board: Board): string {
  if (err instanceof MathParseError) {
    const unknownCommand = /^unknown command (\\\S+)/.exec(err.message);
    if (unknownCommand) {
      return `unsupported TeX command ${unknownCommand[1]} — supported: ${SUPPORTED_TEX_COMMANDS}`;
    }
    return `invalid TeX: ${err.message}`;
  }

  if (err instanceof ExprError) {
    return `invalid curve expression: ${err.message}`;
  }

  if (err instanceof LayoutOverflowError) {
    const margin = board.margin ?? DEFAULT_MARGIN;
    const usableWidth = board.width - 2 * margin;
    const usableHeight = board.height - 2 * margin;
    if (err.required.width > usableWidth) {
      return `too wide for the board (${err.required.width}px of ${usableWidth}px usable) — split into shorter steps`;
    }
    if (err.required.height > usableHeight) {
      return `too tall for the board (${err.required.height}px of ${usableHeight}px usable) — split into shorter steps`;
    }
    return `does not fit the board (${err.required.width}x${err.required.height}px on a ${board.width}x${board.height}px board) — split into shorter steps`;
  }

  const message = err instanceof Error ? err.message : String(err);
  return `render failed: ${message}`;
}

/**
 * The three error types that mean "the model produced content this board
 * cannot draw". Anything else escaping the render path is a defect in our
 * own code, not bad model output.
 */
function isModelOutputError(err: unknown): boolean {
  return (
    err instanceof MathParseError ||
    err instanceof ExprError ||
    err instanceof LayoutOverflowError
  );
}

/**
 * Attempts the real render path -- `layoutScript` on a one-step script, then
 * `buildPlan` -- for a single step, converting a *model-output* failure into a
 * verdict instead of letting it propagate. This is the gate that lets
 * `board-director` reject unrenderable model output as a normal tool error
 * (self-correctable) instead of the whole pipeline crashing on it.
 *
 * Deliberately NOT a blanket catch. Only `MathParseError`, `ExprError` and
 * `LayoutOverflowError` become `ok: false`; any other exception is a bug in
 * the engine or in this package and is rethrown. Swallowing those would
 * disguise our own defects as "the model wrote bad TeX" -- silent, and
 * precisely the failure mode this gate exists to end.
 */
export function checkStepRenderable(step: BoardStep, board: Board): RenderCheck {
  try {
    const ops = layoutScript({ scriptId: "__renderability-check__", steps: [step] }, board);
    buildPlan(ops, { board });
    return { ok: true };
  } catch (err) {
    if (!isModelOutputError(err)) throw err;
    return { ok: false, reason: describeRenderError(err, board) };
  }
}
