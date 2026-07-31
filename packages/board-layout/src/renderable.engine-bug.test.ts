import { describe, expect, it, vi } from "vitest";

/**
 * `checkRenderable` must only treat `MathParseError` as "not renderable" --
 * any other exception type is a bug in the engine itself, not bad model
 * output, and must propagate rather than being swallowed into an `ok:
 * false` result. This is untestable against the real `parseMath` (it never
 * throws anything else), so this file mocks `@teacher/stroke-engine` to
 * make it throw a `TypeError`, kept in its own file so the mock doesn't
 * affect `renderable.test.ts`'s assertions against real engine behaviour.
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

const { checkRenderable } = await import("./renderable");

describe("checkRenderable", () => {
  it("does not swallow an exception that isn't a MathParseError -- it propagates", () => {
    expect(() => checkRenderable("x=1")).toThrow(TypeError);
    expect(() => checkRenderable("x=1")).toThrow("engine bug, not bad TeX");
  });
});
