import { describe, it, expect } from "vitest";
import { ENGINE_VERSION } from "./index";

describe("smoke", () => {
  it("package loads", () => {
    expect(ENGINE_VERSION).toBe("0.1.0");
  });
});
