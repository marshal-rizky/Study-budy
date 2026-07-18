import { describe, expect, it } from "vitest";
import { compileExpr, ExprError } from "./expr";

describe("compileExpr", () => {
  it("evaluates powers", () => {
    expect(compileExpr("x^2")(3)).toBe(9);
  });

  it("evaluates implicit multiplication: number then x", () => {
    expect(compileExpr("2x+1")(4)).toBe(9);
  });

  it("evaluates implicit multiplication: number then parens", () => {
    expect(compileExpr("3(x+1)")(2)).toBe(9);
  });

  it("evaluates implicit multiplication: number then function", () => {
    expect(compileExpr("2sin(x)")(0)).toBe(0);
  });

  it("evaluates sqrt", () => {
    expect(compileExpr("sqrt(x)")(9)).toBe(3);
  });

  it("evaluates ln(e) as 1", () => {
    expect(compileExpr("ln(e)")(0)).toBeCloseTo(1);
  });

  it("evaluates pi constant", () => {
    expect(compileExpr("pi")(0)).toBeCloseTo(3.14159, 4);
  });

  it("applies unary minus to the whole power, not just the base", () => {
    expect(compileExpr("-x^2")(3)).toBe(-9);
  });

  it("is right-associative for '^'", () => {
    expect(compileExpr("2^3^2")(0)).toBe(512);
  });

  it("is left-associative for '/'", () => {
    expect(compileExpr("8/4/2")(0)).toBe(1);
  });

  it("lets ln(x) at x<=0 pass through as -Infinity/NaN instead of throwing", () => {
    const fn = compileExpr("ln(x)");
    expect(fn(0)).toBe(-Infinity);
  });

  it("lets 1/x at x=0 pass through as Infinity instead of throwing", () => {
    const fn = compileExpr("1/x");
    expect(fn(0)).toBe(Infinity);
  });

  it.each([
    ["process.exit(1)"],
    ["constructor"],
    ["foo(x)"],
    ["(x"],
    ["x)"],
    [""],
    ["2 3"],
    ["sin"],
  ])("throws ExprError for %s", (src) => {
    expect(() => compileExpr(src)).toThrow(ExprError);
  });

  it("never invokes arbitrary code (no eval / Function escape)", () => {
    expect(() => compileExpr("globalThis.__pwned=1")).toThrow(ExprError);
    expect((globalThis as any).__pwned).toBeUndefined();
  });
});
