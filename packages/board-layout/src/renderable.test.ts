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

  it("reproduces Bug 4 exactly: the literal OpenRouter output fails on the bare '\\/' before it ever reaches \\boxed", () => {
    // Literal string from docs/superpowers/notes/2026-07-31-handoff.md §2: OpenRouter's
    // real output was `x = \frac{2}{4} \/\boxed{\frac{1}{2}}, \quad ...` -- note the bare
    // `\/` immediately before `\boxed` (not dropped here, unlike an earlier version of
    // this test). `\/` is a backslash followed by a non-letter, so the parser reads an
    // empty command name and throws on the backslash itself at position 16 -- it never
    // gets far enough to see `\boxed` at all. This is confirmed against the handoff's own
    // recorded smoke-test output, which says exactly "unknown command \ (at 16)", not
    // anything naming \boxed.
    const bug4Literal = "x = \\frac{2}{4} \\/\\boxed{\\frac{1}{2}}, \\quad ...";
    const result = checkRenderable(bug4Literal);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.reason).toBe("unknown command \\ (at 16)");
  });

  it("Bug 4 end-to-end: a script assembled only from checkRenderable-accepted steps survives layoutScript", () => {
    // Mirrors what a gated board-director tool-call loop produces: the bad step
    // (unsupported TeX, the literal OpenRouter output) never reaches the script, only
    // its corrected re-emission does. This is the property the original bug violated --
    // layoutScript throwing MathParseError at layout time, downstream, and discarding
    // the whole derivation.
    const candidateSteps = [
      "x = \\frac{2}{4} \\/\\boxed{\\frac{1}{2}}, \\quad ...",
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
