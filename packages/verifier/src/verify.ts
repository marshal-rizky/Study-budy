import { compileExpr } from "@teacher/board-layout";
import type { BoardScript } from "@teacher/protocol";
import { texToExpr } from "./tex-to-expr";

export type Verdict =
  | { status: "ok" }
  | { status: "failed"; reason: string }
  | { status: "unchecked"; reason: string };

const OK: Verdict = { status: "ok" };
function unchecked(reason: string): Verdict {
  return { status: "unchecked", reason };
}
function failed(reason: string): Verdict {
  return { status: "failed", reason };
}

// Irrational-ish sample points -- avoid neat integers that could
// accidentally satisfy both a correct and an incorrect transformation.
const SAMPLES = [-3.7, -1.3, 0.5, 2.1, 4.9];
const REL_TOL = 1e-6;

function formatNum(v: number): string {
  const r = Math.round(v * 1e6) / 1e6;
  return String(r);
}

interface Equation {
  lhs: string;
  rhs: string;
}

/** Splits an expr-grammar string on a single top-level `=`. */
function splitEquation(exprSrc: string): Equation | null {
  let depth = 0;
  let eqIdx = -1;
  for (let i = 0; i < exprSrc.length; i++) {
    const c = exprSrc[i];
    if (c === "(") depth++;
    else if (c === ")") depth--;
    else if (c === "=" && depth === 0) {
      if (eqIdx !== -1) return null; // more than one top-level '='
      eqIdx = i;
    }
  }
  if (eqIdx === -1) return null;
  const lhs = exprSrc.slice(0, eqIdx);
  const rhs = exprSrc.slice(eqIdx + 1);
  if (lhs.trim().length === 0 || rhs.trim().length === 0) return null;
  return { lhs, rhs };
}

/** Compiles `lhs - rhs` as a single function, or null if either side fails to compile. */
function compileDiff(eq: Equation): ((x: number) => number) | null {
  try {
    const lhsFn = compileExpr(eq.lhs);
    const rhsFn = compileExpr(eq.rhs);
    return (x: number) => lhsFn(x) - rhsFn(x);
  } catch {
    return null;
  }
}

/** Evaluates an expr-grammar string as a constant (must not depend on x). */
function evalConstant(exprSrc: string): number | null {
  try {
    const fn = compileExpr(exprSrc);
    const a = fn(0);
    const b = fn(1.23456789);
    if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
    if (Math.abs(a - b) > 1e-9 * Math.max(1, Math.abs(a))) return null; // depends on x
    return a;
  } catch {
    return null;
  }
}

/**
 * Check A -- numeric spot-check of an equation-preserving step. `prevEq`
 * and `nextEq` should have the same root set: f_next must be a nonzero
 * constant multiple of f_prev across sample points. Returns null (not a
 * verdict) when there isn't enough usable numeric evidence -- caller
 * degrades to `unchecked`.
 */
function checkRatioPreserving(prevEq: Equation, nextEq: Equation, prevTex: string, nextTex: string): Verdict | null {
  const fPrev = compileDiff(prevEq);
  const fNext = compileDiff(nextEq);
  if (!fPrev || !fNext) return null;

  const ratios: number[] = [];
  for (const x of SAMPLES) {
    let p: number, n: number;
    try {
      p = fPrev(x);
      n = fNext(x);
    } catch {
      continue;
    }
    if (!Number.isFinite(p) || !Number.isFinite(n)) continue;
    if (Math.abs(p) < 1e-9) continue; // avoid dividing by ~0
    ratios.push(n / p);
  }

  if (ratios.length < 3) return null;

  const r0 = ratios[0];
  if (!Number.isFinite(r0) || Math.abs(r0) < 1e-9) return null;

  for (const r of ratios) {
    if (!Number.isFinite(r)) return null;
    const relDiff = Math.abs(r - r0) / Math.max(1, Math.abs(r0));
    if (relDiff > REL_TOL) {
      return failed(
        `step does not preserve the equation's root set: ${prevTex} -> ${nextTex} (ratio ${formatNum(r0)} vs ${formatNum(r)})`
      );
    }
  }
  return OK;
}

/**
 * Check B -- solved-root substitution. `next` is `x = <value>`; substitute
 * into the anchor equation and check the residual is ~0.
 */
function checkSolvedRoot(rootVal: number, anchorTex: string | null, nextTex: string): Verdict {
  if (anchorTex === null) {
    return unchecked(`no anchor equation to verify root x=${formatNum(rootVal)} against`);
  }
  const anchorExprSrc = texToExpr(anchorTex);
  if (anchorExprSrc === null) {
    return unchecked(`cannot parse anchor equation TeX: ${anchorTex}`);
  }
  const anchorEq = splitEquation(anchorExprSrc);
  if (!anchorEq) {
    return unchecked(`anchor step is not a single-variable equation: ${anchorTex}`);
  }
  const diffFn = compileDiff(anchorEq);
  if (!diffFn) {
    return unchecked(`cannot compile anchor equation: ${anchorTex}`);
  }
  let residual: number;
  try {
    residual = diffFn(rootVal);
  } catch {
    return unchecked(`anchor equation not evaluable at x=${formatNum(rootVal)}`);
  }
  if (!Number.isFinite(residual)) {
    return unchecked(`anchor equation not finite at x=${formatNum(rootVal)}`);
  }
  if (Math.abs(residual) > REL_TOL * Math.max(1, Math.abs(rootVal))) {
    return failed(
      `x=${formatNum(rootVal)} does not satisfy ${anchorTex} (residual ${formatNum(residual)})`
    );
  }
  return OK;
}

/**
 * Verifies one math step against its predecessor and the derivation's
 * anchor equation. `anchorTex` is the earliest math step's TeX (used only
 * by Check B); for the bare `verifyStep` API the caller passes `prevTex`
 * as the anchor too.
 */
function verifyOneStep(prevTex: string | null, nextTex: string, anchorTex: string | null): Verdict {
  const nextExprSrc = texToExpr(nextTex);
  if (nextExprSrc === null) {
    return unchecked(`cannot convert TeX to a checkable expression: ${nextTex}`);
  }

  const nextEq = splitEquation(nextExprSrc);

  // Check B: a solved root, "x = <numeric expression>".
  if (nextEq && nextEq.lhs.trim() === "x") {
    const rootVal = evalConstant(nextEq.rhs);
    if (rootVal !== null) {
      return checkSolvedRoot(rootVal, anchorTex, nextTex);
    }
    // RHS isn't a pure constant (e.g. still references x) -- fall through
    // to Check A in case this is otherwise a checkable equation-preserving
    // step; otherwise it degrades to unchecked below.
  }

  // Check A: equation-preserving step.
  if (prevTex !== null && nextEq) {
    const prevExprSrc = texToExpr(prevTex);
    if (prevExprSrc !== null) {
      const prevEq = splitEquation(prevExprSrc);
      if (prevEq) {
        const verdict = checkRatioPreserving(prevEq, nextEq, prevTex, nextTex);
        if (verdict !== null) return verdict;
      }
    }
  }

  return unchecked(`step not confidently checkable: ${nextTex}`);
}

/** Verifies a single step in isolation; `prev` doubles as the anchor equation. */
export function verifyStep(prev: string | null, next: string): Verdict {
  return verifyOneStep(prev, next, prev);
}

/**
 * Verifies every step of a board script, aligned by index with
 * `script.steps`. Non-math steps are always `unchecked`. Math steps are
 * checked against the immediately preceding math step (Check A) and/or the
 * derivation's earliest math step as the anchor equation (Check B).
 */
export function verifyScript(script: BoardScript): Verdict[] {
  const verdicts: Verdict[] = [];
  let anchorTex: string | null = null;
  let prevMathTex: string | null = null;

  for (const step of script.steps) {
    if (step.kind !== "math") {
      verdicts.push(unchecked("not a math step"));
      continue;
    }
    if (anchorTex === null) anchorTex = step.tex;
    verdicts.push(verifyOneStep(prevMathTex, step.tex, anchorTex));
    prevMathTex = step.tex;
  }

  return verdicts;
}
