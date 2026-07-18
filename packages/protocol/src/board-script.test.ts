import { describe, expect, it } from "vitest";
import { parseBoardScript } from "./board-script";

describe("parseBoardScript", () => {
  it("round-trips a valid multi-step script and preserves step order", () => {
    const input = {
      scriptId: "script-1",
      steps: [
        { kind: "math", tex: "x^2 + 1", narration: "square plus one" },
        { kind: "text", text: "hello world", narration: "say hello" },
        {
          kind: "diagram",
          diagram: {
            kind: "curve",
            expr: "x * x",
            domain: [-1, 1],
            width: 400,
            height: 300,
            yRange: [-2, 2],
          },
          narration: "draw the curve",
        },
        { kind: "new_page" },
      ],
    };

    const result = parseBoardScript(input);

    expect(result.scriptId).toBe("script-1");
    expect(result.steps).toHaveLength(4);
    expect(result.steps[0].kind).toBe("math");
    expect(result.steps[1].kind).toBe("text");
    expect(result.steps[2].kind).toBe("diagram");
    expect(result.steps[3].kind).toBe("new_page");
  });

  it("rejects an unknown step kind", () => {
    const input = {
      scriptId: "script-1",
      steps: [{ kind: "wat", tex: "x", narration: "n" }],
    };

    expect(() => parseBoardScript(input)).toThrow();
  });

  it("rejects a math step missing narration, naming the field and index", () => {
    const input = {
      scriptId: "script-1",
      steps: [{ kind: "math", tex: "x^2" }],
    };

    try {
      parseBoardScript(input);
      expect.fail("expected parseBoardScript to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(Error);
      const message = (err as Error).message;
      expect(message).toContain("narration");
      expect(message).toContain("steps.0");
    }
  });

  it("rejects a curve whose expr is a number, not a string", () => {
    const input = {
      scriptId: "script-1",
      steps: [
        {
          kind: "diagram",
          diagram: {
            kind: "curve",
            expr: 42,
            domain: [-1, 1],
            width: 400,
            height: 300,
            yRange: [-2, 2],
          },
          narration: "n",
        },
      ],
    };

    expect(() => parseBoardScript(input)).toThrow();
  });

  it("accepts a curve whose expr is a string (no functions cross the wire)", () => {
    const input = {
      scriptId: "script-1",
      steps: [
        {
          kind: "diagram",
          diagram: {
            kind: "curve",
            expr: "sin(x)",
            domain: [0, 6.28],
            width: 400,
            height: 300,
            yRange: [-1, 1],
          },
          narration: "n",
        },
      ],
    };

    const result = parseBoardScript(input);
    const step = result.steps[0];
    if (step.kind !== "diagram" || step.diagram.kind !== "curve") {
      throw new Error("expected a curve diagram step");
    }
    expect(step.diagram.expr).toBe("sin(x)");
    expect(typeof step.diagram.expr).toBe("string");
  });

  it("rejects an empty scriptId", () => {
    const input = {
      scriptId: "",
      steps: [{ kind: "new_page" }],
    };

    expect(() => parseBoardScript(input)).toThrow();
  });

  it("rejects non-finite and negative dimensions", () => {
    const infiniteWidth = {
      scriptId: "script-1",
      steps: [
        {
          kind: "diagram",
          diagram: { kind: "axes", width: Infinity, height: 300 },
          narration: "n",
        },
      ],
    };
    expect(() => parseBoardScript(infiniteWidth)).toThrow();

    const negativeRadius = {
      scriptId: "script-1",
      steps: [
        {
          kind: "diagram",
          diagram: { kind: "benzene", radius: -1 },
          narration: "n",
        },
      ],
    };
    expect(() => parseBoardScript(negativeRadius)).toThrow();
  });

  it("throws a plain Error with a readable message, not a raw ZodError", () => {
    try {
      parseBoardScript({ scriptId: "script-1", steps: [{ kind: "math", tex: "", narration: "n" }] });
      expect.fail("expected parseBoardScript to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(Error);
      expect(err).not.toHaveProperty("issues");
      expect((err as Error).message).toContain("invalid BoardScript");
    }
  });
});
