import { describe, expect, it, vi } from "vitest";

/**
 * `checkStepRenderable` must convert only *model-output* failures
 * (MathParseError / ExprError / LayoutOverflowError) into `ok: false`. Any
 * other exception is a defect in our own code and must propagate.
 *
 * Why this matters: a blanket catch would report an engine crash as "the model
 * wrote bad TeX", the director would dutifully ask the model to rewrite
 * perfectly good input, and a real bug would never surface. This project has
 * repeatedly shipped defects hidden behind green suites; that is exactly the
 * shape of failure this asserts against.
 *
 * Unreachable against the real engine (it only throws MathParseError here), so
 * the engine is mocked. Kept in its own file so the mock cannot leak into the
 * tests that assert real engine behaviour.
 */
vi.mock("@teacher/stroke-engine", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@teacher/stroke-engine")>();
  return {
    ...actual,
    parseMath: () => {
      throw new TypeError("engine bug, not bad TeX");
    },
  };
});

const { checkStepRenderable } = await import("./layout-script");

const BOARD = { width: 900, height: 520 };
const step = { kind: "math", tex: "x=1", narration: "n" } as const;

describe("checkStepRenderable — engine faults are not disguised as bad model output", () => {
  it("rethrows a non-model-output exception instead of returning ok:false", () => {
    expect(() => checkStepRenderable(step, BOARD)).toThrow(TypeError);
    expect(() => checkStepRenderable(step, BOARD)).toThrow("engine bug, not bad TeX");
  });
});
