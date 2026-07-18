import { describe, expect, it } from "vitest";
import { compileExpr } from "@teacher/board-layout";
import { texToExpr } from "./tex-to-expr";

describe("texToExpr", () => {
  it("converts \\frac{1}{2} to a half", () => {
    const src = texToExpr("\\frac{1}{2}");
    expect(src).not.toBeNull();
    expect(compileExpr(src!)(0)).toBeCloseTo(0.5);
  });

  it("converts \\sqrt{x}", () => {
    const src = texToExpr("\\sqrt{x}");
    expect(src).not.toBeNull();
    expect(compileExpr(src!)(9)).toBeCloseTo(3);
  });

  it("converts x^2", () => {
    const src = texToExpr("x^2");
    expect(src).not.toBeNull();
    expect(compileExpr(src!)(3)).toBeCloseTo(9);
  });

  it("converts nested \\frac{\\sqrt{x}}{2}", () => {
    const src = texToExpr("\\frac{\\sqrt{x}}{2}");
    expect(src).not.toBeNull();
    expect(compileExpr(src!)(16)).toBeCloseTo(2);
  });

  it("returns null for a subscript (v_0 names a distinct variable)", () => {
    expect(texToExpr("v_0")).toBeNull();
  });

  it("returns null for an unsupported command", () => {
    expect(texToExpr("\\theta")).toBeNull();
    expect(texToExpr("\\int")).toBeNull();
  });

  it("converts \\pi, \\times, \\div to expr equivalents", () => {
    const src = texToExpr("2\\times\\pi\\div2");
    expect(src).not.toBeNull();
    expect(compileExpr(src!)(0)).toBeCloseTo(Math.PI);
  });

  it("converts a full equation, preserving '=' as a literal splittable token", () => {
    const src = texToExpr("2x+3=7");
    expect(src).not.toBeNull();
    const [lhs, rhs] = src!.split("=");
    expect(compileExpr(lhs)(2)).toBe(7);
    expect(rhs.trim()).toBe("7");
  });
});
