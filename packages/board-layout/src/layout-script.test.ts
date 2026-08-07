import { describe, expect, it } from "vitest";
import type { BoardScript } from "@teacher/protocol";
import { buildPlan, layoutMath, layoutText, parseMath } from "@teacher/stroke-engine";
import type { Board, Op } from "@teacher/stroke-engine";
import { layoutScript } from "./layout-script";

const board: Board = { width: 900, height: 520 };

function isDrawTextOrMath(
  op: Op
): op is Extract<Op, { type: "write_math" }> | Extract<Op, { type: "write_text" }> {
  return op.type === "write_math" || op.type === "write_text";
}

describe("layoutScript", () => {
  it("lays out a 4-step script in order with a strictly descending board (increasing y)", () => {
    const script: BoardScript = {
      scriptId: "s1",
      steps: [
        { kind: "text", text: "Solve for x", narration: "n1" },
        { kind: "math", tex: "x^2=4", narration: "n2" },
        { kind: "text", text: "So x equals", narration: "n3" },
        { kind: "math", tex: "x=2", narration: "n4" },
      ],
    };

    const ops = layoutScript(script, board);
    expect(ops).toHaveLength(4);
    expect(ops.map((o) => o.type)).toEqual([
      "write_text",
      "write_math",
      "write_text",
      "write_math",
    ]);

    const draw = ops.filter(isDrawTextOrMath);
    for (let i = 1; i < draw.length; i++) {
      expect(draw[i].at.y).toBeGreaterThan(draw[i - 1].at.y);
    }
  });

  it("advances the cursor further after a tall step than after a plain one", () => {
    const tallScript: BoardScript = {
      scriptId: "tall",
      steps: [
        { kind: "math", tex: "\\frac{\\frac{a}{b}}{c}", narration: "n1" },
        { kind: "math", tex: "x=2", narration: "n2" },
      ],
    };
    const plainScript: BoardScript = {
      scriptId: "plain",
      steps: [
        { kind: "math", tex: "x=2", narration: "n1" },
        { kind: "math", tex: "x=2", narration: "n2" },
      ],
    };

    const tallOps = layoutScript(tallScript, board).filter(isDrawTextOrMath);
    const plainOps = layoutScript(plainScript, board).filter(isDrawTextOrMath);

    const tallGap = tallOps[1].at.y - tallOps[0].at.y;
    const plainGap = plainOps[1].at.y - plainOps[0].at.y;

    expect(tallGap).toBeGreaterThan(plainGap);
  });

  it("emits new_page and resets the cursor for the following step", () => {
    const script: BoardScript = {
      scriptId: "s3",
      steps: [
        { kind: "math", tex: "x=1", narration: "n1" },
        { kind: "math", tex: "y=2", narration: "n2" },
        { kind: "new_page" },
        { kind: "math", tex: "z=3", narration: "n4" },
      ],
    };

    const ops = layoutScript(script, board);
    expect(ops[2]).toEqual({ type: "new_page" });

    const beforeBreak = ops[1] as Extract<Op, { type: "write_math" }>;
    const afterBreak = ops[3] as Extract<Op, { type: "write_math" }>;
    expect(afterBreak.at.y).toBeLessThan(beforeBreak.at.y);
  });

  it("produces a draw_diagram op for a curve whose fn evaluates the compiled expr", () => {
    const script: BoardScript = {
      scriptId: "s4",
      steps: [
        {
          kind: "diagram",
          narration: "n1",
          diagram: {
            kind: "curve",
            expr: "x^2",
            domain: [-2, 2],
            width: 200,
            height: 150,
            yRange: [0, 4],
          },
        },
      ],
    };

    const ops = layoutScript(script, board);
    expect(ops).toHaveLength(1);
    const op = ops[0];
    expect(op.type).toBe("draw_diagram");
    if (op.type !== "draw_diagram") throw new Error("unreachable");
    expect(op.diagram.kind).toBe("curve");
    if (op.diagram.kind !== "curve") throw new Error("unreachable");
    expect(op.diagram.fn(2)).toBe(4);
  });

  it("keeps consecutive math/text steps from overlapping", () => {
    const script: BoardScript = {
      scriptId: "s5",
      steps: [
        { kind: "text", text: "Given", narration: "n1" },
        { kind: "math", tex: "x^2=4", narration: "n2" },
        { kind: "text", text: "Then", narration: "n3" },
        { kind: "math", tex: "x=2", narration: "n4" },
      ],
    };

    const draw = layoutScript(script, board).filter(isDrawTextOrMath);
    for (let i = 0; i < draw.length - 1; i++) {
      const cur = draw[i];
      const next = draw[i + 1];
      const curLayout = cur.type === "write_math" ? layoutMath(parseMath(cur.tex)) : layoutText(cur.text);
      const nextLayout =
        next.type === "write_math" ? layoutMath(parseMath(next.tex)) : layoutText(next.text);
      const curBottom = cur.at.y + curLayout.descent * cur.size;
      const nextTop = next.at.y - nextLayout.ascent * next.size;
      expect(curBottom).toBeLessThanOrEqual(nextTop);
    }
  });

  it("keeps every wrapped line's width within both margins of the board (mutation survivor: dropping the margin from usableWidth)", () => {
    const longText = "word ".repeat(80).trim(); // far too wide to fit unwrapped on a 900px board
    const script: BoardScript = {
      scriptId: "wrap",
      steps: [{ kind: "text", text: longText, narration: "n" }],
    };

    const ops = layoutScript(script, board);
    const textOps = ops.filter(
      (o): o is Extract<Op, { type: "write_text" }> => o.type === "write_text"
    );
    expect(textOps.length).toBeGreaterThan(1); // actually wrapped into multiple lines

    const margin = 24; // DEFAULT_MARGIN -- `board` here carries no explicit margin
    for (const op of textOps) {
      const lineWidth = layoutText(op.text).width * op.size;
      expect(margin + lineWidth + margin).toBeLessThanOrEqual(board.width);
    }
  });

  it("integration: a realistic 9-step quadratic solution stays within the board through buildPlan", () => {
    const script: BoardScript = {
      scriptId: "quadratic",
      steps: [
        { kind: "text", text: "We solve x squared minus 5x plus 6 equals 0", narration: "n1" },
        { kind: "math", tex: "x^2-5x+6=0", narration: "n2" },
        { kind: "text", text: "Factor into two binomials", narration: "n3" },
        { kind: "math", tex: "(x-2)(x-3)=0", narration: "n4" },
        { kind: "text", text: "By the zero product property", narration: "n5" },
        { kind: "math", tex: "x-2=0", narration: "n6" },
        { kind: "math", tex: "x=2", narration: "n7" },
        { kind: "math", tex: "x-3=0", narration: "n8" },
        { kind: "math", tex: "x=3", narration: "n9" },
      ],
    };

    const ops = layoutScript(script, board);
    const plan = buildPlan(ops, { seed: 1, board: { width: 900, height: 520 } });

    expect(plan.pages).toBeGreaterThanOrEqual(1);
    for (const stroke of plan.strokes) {
      for (const p of stroke.points) {
        expect(p.x).toBeGreaterThanOrEqual(0);
        expect(p.x).toBeLessThanOrEqual(900);
        expect(p.y).toBeGreaterThanOrEqual(0);
        expect(p.y).toBeLessThanOrEqual(520);
      }
    }
  });
});
