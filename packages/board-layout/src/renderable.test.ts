import { describe, expect, it } from "vitest";
import type { BoardScript } from "@teacher/protocol";
import type { Board } from "@teacher/stroke-engine";
import { checkRenderable } from "./renderable";
import { layoutScript } from "./layout-script";

const board: Board = { width: 900, height: 520 };

describe("checkRenderable", () => {
  it.each(["\\frac{2}{4}", "x^2 + 5x - 3 = 0", "\\sqrt{x}"])(
    "accepts a real supported expression: %s",
    (tex) => {
      expect(checkRenderable(tex)).toEqual({ ok: true });
    }
  );

  it("rejects \\boxed with a reason naming the offending command", () => {
    const result = checkRenderable("\\boxed{x}");
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.reason).toContain("\\boxed");
  });

  it("rejects \\quad with a reason naming the offending command", () => {
    const result = checkRenderable("\\quad");
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.reason).toContain("\\quad");
  });

  it("reproduces Bug 4: the exact OpenRouter output rejects on \\boxed, naming it", () => {
    // The real smoke-test output that started this: an otherwise-correct step
    // with unsupported TeX (`\boxed`, `\quad`) mixed in.
    const result = checkRenderable("x = \\frac{2}{4} \\boxed{\\frac{1}{2}}, \\quad y=1");
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.reason).toContain("\\boxed");
  });

  it("Bug 4 end-to-end: a script assembled only from checkRenderable-accepted steps survives layoutScript", () => {
    // Mirrors what a gated board-director tool-call loop produces: the bad step
    // (unsupported TeX) never reaches the script, only its corrected re-emission does.
    // This is the property the original bug violated -- layoutScript throwing
    // MathParseError at layout time, downstream, and discarding the whole derivation.
    const candidateSteps = [
      "x = \\frac{2}{4} \\boxed{\\frac{1}{2}}, \\quad y=1",
      "x = \\frac{1}{2}",
    ];

    const accepted = candidateSteps.filter((tex) => checkRenderable(tex).ok);
    expect(accepted).toEqual(["x = \\frac{1}{2}"]);

    const script: BoardScript = {
      scriptId: "bug4-regression",
      steps: accepted.map((tex, i) => ({ kind: "math" as const, tex, narration: `n${i}` })),
    };

    expect(() => layoutScript(script, board)).not.toThrow();
  });
});
