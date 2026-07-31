import { describe, expect, it } from "vitest";
import type { BoardScript, BoardStep } from "@teacher/protocol";
import { verifyScript, verifyStep } from "./verify";

function mathStep(tex: string): BoardStep {
  return { kind: "math", tex, narration: "step" };
}

function script(steps: string[]): BoardScript {
  return { scriptId: "s", steps: steps.map(mathStep) };
}

describe("verifyStep", () => {
  it("catches a planted sign error", () => {
    const v = verifyStep("2x+3=7", "2x=10");
    expect(v.status).toBe("failed");
  });

  it("catches a wrong root against the anchor equation", () => {
    const v = verifyStep("x^2-5x+6=0", "x=4");
    expect(v.status).toBe("failed");
  });

  it("accepts correct roots of a quadratic", () => {
    expect(verifyStep("x^2-5x+6=0", "x=2").status).toBe("ok");
    expect(verifyStep("x^2-5x+6=0", "x=3").status).toBe("ok");
  });

  it("returns unchecked, not failed, for a step it cannot parse", () => {
    const v = verifyStep("x^2-5x+6=0", "v_0=4");
    expect(v.status).toBe("unchecked");
  });

  it("returns unchecked for a step with no prior context to compare against", () => {
    const v = verifyStep(null, "2x+3=7");
    expect(v.status).not.toBe("failed");
  });
});

describe("verifyScript", () => {
  it("aligns one verdict per step, marking non-math steps unchecked", () => {
    const s: BoardScript = {
      scriptId: "s",
      steps: [
        mathStep("x^2-5x+6=0"),
        { kind: "text", text: "factor it", narration: "n" },
        mathStep("(x-2)(x-3)=0"),
        { kind: "new_page" },
        mathStep("x=2"),
      ],
    };
    const verdicts = verifyScript(s);
    expect(verdicts).toHaveLength(5);
    expect(verdicts[1]).toEqual({ status: "unchecked", reason: "not a math step" });
    expect(verdicts[3]).toEqual({ status: "unchecked", reason: "not a math step" });
    expect(verdicts.some((v) => v.status === "failed")).toBe(false);
  });

  it("accepts a correct 6-step quadratic derivation end to end", () => {
    const s = script([
      "x^2-5x+6=0",
      "2x^2-10x+12=0",
      "x^2-5x+6=0",
      "(x-2)(x-3)=0",
      "x=2",
      "x=3",
    ]);
    const verdicts = verifyScript(s);
    expect(verdicts.some((v) => v.status === "failed")).toBe(false);
  });

  it("accepts the zero-product case split (a case split narrows the root set, which is valid)", () => {
    const s = script(["x^2-5x+6=0", "(x-2)(x-3)=0", "x-2=0", "x=2", "x-3=0", "x=3"]);
    const verdicts = verifyScript(s);
    expect(verdicts.filter((v) => v.status === "failed")).toEqual([]);
    expect(verdicts[1].status).toBe("ok");
    expect(verdicts[2].status).toBe("ok");
    expect(verdicts[3].status).toBe("ok");
    expect(verdicts[4].status).toBe("ok");
    expect(verdicts[5].status).toBe("ok");
  });

  it("accepts a case split on a difference of squares", () => {
    const s = script(["x^2-9=0", "(x-3)(x+3)=0", "x-3=0", "x=3"]);
    const verdicts = verifyScript(s);
    expect(verdicts.filter((v) => v.status === "failed")).toEqual([]);
    expect(verdicts[2].status).toBe("ok");
  });

  it("anchors to the earliest equation, not the previous step, after a solved root", () => {
    // "x-3=0" follows "x=2"; comparing against the previous step would be
    // meaningless. It must be judged against the anchor.
    const s = script(["x^2-5x+6=0", "x=2", "x-3=0"]);
    const verdicts = verifyScript(s);
    expect(verdicts[2].status).toBe("ok");
  });

  it("accepts a correct derivation containing \\frac and \\sqrt", () => {
    const s = script([
      "\\frac{x}{2}+\\sqrt{4}=5",
      "\\frac{x}{2}=3",
      "x=6",
    ]);
    const verdicts = verifyScript(s);
    expect(verdicts.some((v) => v.status === "failed")).toBe(false);
  });

  it("catches a case split onto a factor that is not a real factor", () => {
    // The split is structurally plausible but 5 is not a root of the anchor.
    const s = script(["x^2-5x+6=0", "(x-2)(x-3)=0", "x-5=0"]);
    const verdicts = verifyScript(s);
    expect(verdicts[2].status).toBe("failed");
  });

  it("catches a sign slip mid-derivation and the root that follows from it", () => {
    const s = script(["2x+3=7", "2x=10", "x=5"]);
    const verdicts = verifyScript(s);
    expect(verdicts[1].status).toBe("failed");
    expect(verdicts[2].status).toBe("failed");
  });

  it("catches a wrong root planted among two correct ones", () => {
    const s = script(["x^2-5x+6=0", "x=2", "x=3", "x=5"]);
    const verdicts = verifyScript(s);
    expect(verdicts[1].status).toBe("ok");
    expect(verdicts[2].status).toBe("ok");
    expect(verdicts[3].status).toBe("failed");
  });
});

describe("no-false-positive suite: correct derivations must never be flagged failed", () => {
  const derivations: Record<string, string[]> = {
    // --- Linear equations ---
    "L1: 2x+3=7": ["2x+3=7", "2x=4", "x=2"],
    "L2: 3x-5=10": ["3x-5=10", "3x=15", "x=5"],
    "L3: 5x+2=3x+10": ["5x+2=3x+10", "2x+2=10", "2x=8", "x=4"],
    "L4: x+7=2": ["x+7=2", "x=-5"],
    "L5: 4x=20": ["4x=20", "x=5"],
    "L6: 7-2x=1": ["7-2x=1", "-2x=-6", "x=3"],
    "L7: x/3+2=5": ["\\frac{x}{3}+2=5", "\\frac{x}{3}=3", "x=9"],
    "L8: 2(x+3)=10": ["2(x+3)=10", "2x+6=10", "2x=4", "x=2"],

    // --- Quadratics via factoring, INCLUDING the zero-product case split
    // (`(x-2)(x-3)=0` -> `x-2=0`), which is the most common shape at this
    // level and must never be flagged. ---
    "Q1: x^2-5x+6=0": ["x^2-5x+6=0", "(x-2)(x-3)=0", "x-2=0", "x=2", "x-3=0", "x=3"],
    "Q2: x^2-x-6=0": ["x^2-x-6=0", "(x-3)(x+2)=0", "x-3=0", "x=3", "x+2=0", "x=-2"],
    "Q3: x^2-9=0": ["x^2-9=0", "(x-3)(x+3)=0", "x-3=0", "x=3", "x+3=0", "x=-3"],
    "Q4: x^2+2x-8=0": ["x^2+2x-8=0", "(x+4)(x-2)=0", "x+4=0", "x=-4", "x-2=0", "x=2"],
    "Q5: 2x^2-8=0": ["2x^2-8=0", "x^2-4=0", "(x-2)(x+2)=0", "x-2=0", "x=2", "x+2=0", "x=-2"],
    "Q6: x^2-4x+4=0 (repeated root)": ["x^2-4x+4=0", "(x-2)(x-2)=0", "x-2=0", "x=2"],
    "Q7: x^2+5x=0": ["x^2+5x=0", "x(x+5)=0", "x=0", "x+5=0", "x=-5"],

    // --- Quadratics via the quadratic formula (roots checked against the
    // anchor via Check B, sidestepping the ratio test entirely for the
    // sqrt-of-discriminant step, since taking a square root of both sides
    // of an equation is not a proportional (ratio-preserving) transform) ---
    "QF1: x^2-5x+6=0": [
      "x^2-5x+6=0",
      "x=\\frac{5+\\sqrt{1}}{2}",
      "x=3",
      "x=\\frac{5-\\sqrt{1}}{2}",
      "x=2",
    ],
    "QF2: x^2-x-6=0": [
      "x^2-x-6=0",
      "x=\\frac{1+\\sqrt{25}}{2}",
      "x=3",
      "x=\\frac{1-\\sqrt{25}}{2}",
      "x=-2",
    ],
    "QF3: x^2-9=0": [
      "x^2-9=0",
      "x=\\frac{0+\\sqrt{36}}{2}",
      "x=3",
      "x=\\frac{0-\\sqrt{36}}{2}",
      "x=-3",
    ],
    "QF4: x^2+2x-8=0": [
      "x^2+2x-8=0",
      "x=\\frac{-2+\\sqrt{36}}{2}",
      "x=2",
      "x=\\frac{-2-\\sqrt{36}}{2}",
      "x=-4",
    ],

    // --- Fraction manipulation ---
    "F1: x/2=3": ["\\frac{x}{2}=3", "x=6"],
    "F2: x/3+x/6=1": ["\\frac{x}{3}+\\frac{x}{6}=1", "2x+x=6", "3x=6", "x=2"],
    "F3: 1/2 x + 1/3 = 5/6": [
      "\\frac{1}{2}x+\\frac{1}{3}=\\frac{5}{6}",
      "3x+2=5",
      "3x=3",
      "x=1",
    ],
    "F4: 2x/3=4": ["\\frac{2x}{3}=4", "2x=12", "x=6"],
    "F5: (x+1)/4=3/2": ["\\frac{x+1}{4}=\\frac{3}{2}", "x+1=6", "x=5"],
  };

  const cases = Object.entries(derivations);

  it(`covers at least 20 correct derivations (found ${cases.length})`, () => {
    expect(cases.length).toBeGreaterThanOrEqual(20);
  });

  it.each(cases)("%s has zero failed verdicts", (_name, steps) => {
    const verdicts = verifyScript(script(steps));
    const failedVerdicts = verdicts.filter((v) => v.status === "failed");
    expect(failedVerdicts).toEqual([]);
  });

  it("zero failed verdicts across the entire no-false-positive suite", () => {
    let totalSteps = 0;
    let totalFailed = 0;
    for (const steps of Object.values(derivations)) {
      const verdicts = verifyScript(script(steps));
      totalSteps += verdicts.length;
      totalFailed += verdicts.filter((v) => v.status === "failed").length;
    }
    expect(totalFailed).toBe(0);
    expect(totalSteps).toBeGreaterThan(0);
  });
});
