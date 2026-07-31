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

const REL_TOL = 1e-6;

// Range and resolution of the numeric root sweep for Check A. Roots outside
// this window are simply not found -- which degrades to `unchecked`, never
// to a false `failed`.
const ROOT_SCAN_MIN = -50;
const ROOT_SCAN_MAX = 50;
const ROOT_SCAN_STEP = 0.01;

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
function safeEval(fn: (x: number) => number, x: number): number {
  try {
    const v = fn(x);
    return Number.isFinite(v) ? v : NaN;
  } catch {
    return NaN;
  }
}

/** Refines a bracketed sign change to high precision by bisection. */
function bisect(fn: (x: number) => number, lo: number, hi: number): number | null {
  let a = lo;
  let b = hi;
  let fa = safeEval(fn, a);
  let fb = safeEval(fn, b);
  if (Number.isNaN(fa) || Number.isNaN(fb) || fa * fb > 0) return null;
  for (let i = 0; i < 200 && b - a > 1e-14 * Math.max(1, Math.abs(a)); i++) {
    const mid = (a + b) / 2;
    const fm = safeEval(fn, mid);
    if (Number.isNaN(fm)) return null; // pole inside the bracket -- not a root
    if (fm === 0) return mid;
    if (fa * fm < 0) {
      b = mid;
      fb = fm;
    } else {
      a = mid;
      fa = fm;
    }
  }
  return (a + b) / 2;
}

/** Local scale of `fn` near `x`, used to size residual tolerances. */
function localScale(fn: (x: number) => number, x: number): number {
  const h = 1e-6 * Math.max(1, Math.abs(x));
  const up = safeEval(fn, x + h);
  const down = safeEval(fn, x - h);
  if (Number.isNaN(up) || Number.isNaN(down)) return 1;
  const slope = Math.abs(up - down) / (2 * h);
  return Math.max(1, slope * Math.max(1, Math.abs(x)));
}

interface RootScan {
  roots: number[];
  /** True when the scan hit something it could not resolve confidently. */
  ambiguous: boolean;
  /** True when f is ~0 everywhere (an identity -- every x is a "root"). */
  identity: boolean;
}

/**
 * Finds the real roots of `fn` over the scan window: dense sampling, then
 * bisection on every sign change, plus detection of tangent roots (local
 * minima of |f| that touch zero without crossing, e.g. (x-2)^2=0).
 */
function findRoots(fn: (x: number) => number): RootScan {
  const xs: number[] = [];
  const ys: number[] = [];
  for (let x = ROOT_SCAN_MIN; x <= ROOT_SCAN_MAX + 1e-9; x += ROOT_SCAN_STEP) {
    const rounded = Math.round(x * 1e6) / 1e6;
    xs.push(rounded);
    ys.push(safeEval(fn, rounded));
  }

  const finite = ys.filter((y) => !Number.isNaN(y));
  if (finite.length === 0) return { roots: [], ambiguous: true, identity: false };

  const maxAbs = finite.reduce((m, y) => Math.max(m, Math.abs(y)), 0);
  if (maxAbs < 1e-12) return { roots: [], ambiguous: false, identity: true };

  const roots: number[] = [];
  let ambiguous = false;

  const pushRoot = (r: number) => {
    if (!Number.isFinite(r)) return;
    if (roots.some((e) => Math.abs(e - r) < 1e-6 * Math.max(1, Math.abs(r)))) return;
    roots.push(r);
  };

  for (let i = 0; i + 1 < xs.length; i++) {
    const y0 = ys[i];
    const y1 = ys[i + 1];
    if (Number.isNaN(y0) || Number.isNaN(y1)) continue;

    if (y0 === 0) pushRoot(xs[i]);

    if (y0 * y1 < 0) {
      const r = bisect(fn, xs[i], xs[i + 1]);
      if (r === null) continue; // pole, not a root -- ignore, don't accuse
      pushRoot(r);
    }
  }

  // Tangent roots: |f| dips to a local minimum near zero without crossing.
  for (let i = 1; i + 1 < xs.length; i++) {
    const a = Math.abs(ys[i - 1]);
    const b = Math.abs(ys[i]);
    const c = Math.abs(ys[i + 1]);
    if (Number.isNaN(a) || Number.isNaN(b) || Number.isNaN(c)) continue;
    if (!(b <= a && b <= c)) continue;
    if (roots.some((r) => Math.abs(r - xs[i]) < 0.05)) continue;

    const scale = Math.max(1e-12, localScale(fn, xs[i]));
    if (b > 1e-3 * scale) continue; // not close enough to zero to be a root

    // Ternary-search |f| to the bottom of the dip.
    let lo = xs[i - 1];
    let hi = xs[i + 1];
    for (let k = 0; k < 200 && hi - lo > 1e-14 * Math.max(1, Math.abs(lo)); k++) {
      const m1 = lo + (hi - lo) / 3;
      const m2 = hi - (hi - lo) / 3;
      const f1 = Math.abs(safeEval(fn, m1));
      const f2 = Math.abs(safeEval(fn, m2));
      if (Number.isNaN(f1) || Number.isNaN(f2)) break;
      if (f1 <= f2) hi = m2;
      else lo = m1;
    }
    const cand = (lo + hi) / 2;
    const residual = Math.abs(safeEval(fn, cand));
    const candScale = Math.max(1e-12, localScale(fn, cand));
    if (residual < 1e-9 * candScale) {
      pushRoot(cand);
    } else {
      // Near-zero but not resolvably zero -- refuse to conclude anything.
      ambiguous = true;
    }
  }

  return { roots, ambiguous, identity: false };
}

/**
 * Check A -- root membership against the anchor equation.
 *
 * A step is accepted when every root of the new equation also satisfies the
 * derivation's original (anchor) equation. This admits plain rearrangement
 * (same root set) AND case splits such as `(x-2)(x-3)=0` -> `x-2=0`, which
 * legitimately *narrow* the root set -- narrowing is valid algebra, so an
 * earlier root-set-preservation rule was wrong to flag it.
 *
 * It still catches sign slips: `2x+3=7` -> `2x=10` has root 5, and 5 does
 * not satisfy the anchor, so that fails.
 *
 * Returns null (not a verdict) when there isn't enough numeric evidence --
 * the caller degrades that to `unchecked`.
 */
function checkRootMembership(
  anchorEq: Equation,
  nextEq: Equation,
  anchorTex: string,
  nextTex: string
): Verdict | null {
  const fAnchor = compileDiff(anchorEq);
  const fNext = compileDiff(nextEq);
  if (!fAnchor || !fNext) return null;

  const scan = findRoots(fNext);
  // An identity (0=0), an unresolvable near-zero dip, or no roots at all in
  // the scan window is not evidence of an error.
  if (scan.identity || scan.ambiguous || scan.roots.length === 0) return null;

  for (const root of scan.roots) {
    const residual = safeEval(fAnchor, root);
    if (Number.isNaN(residual)) return null; // anchor undefined there -- can't judge
    const tol = REL_TOL * localScale(fAnchor, root);
    if (Math.abs(residual) > tol) {
      return failed(
        `x=${formatNum(root)} solves ${nextTex} but does not satisfy ${anchorTex} (residual ${formatNum(residual)})`
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
 * Verifies one math step against the derivation's anchor equation -- the
 * EARLIEST equation in the derivation, never the immediately preceding
 * step. After a solved root ("x=2"), the preceding step is not a meaningful
 * reference: comparing "x-3=0" against "x=2" would flag correct work.
 */
function verifyOneStep(nextTex: string, anchorTex: string | null): Verdict {
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
    // to Check A, which may still be able to judge it.
  }

  // Check A: every root of this step must satisfy the anchor equation.
  if (anchorTex !== null && nextEq) {
    const anchorExprSrc = texToExpr(anchorTex);
    if (anchorExprSrc !== null) {
      const anchorEq = splitEquation(anchorExprSrc);
      if (anchorEq) {
        const verdict = checkRootMembership(anchorEq, nextEq, anchorTex, nextTex);
        if (verdict !== null) return verdict;
      }
    }
  }

  return unchecked(`step not confidently checkable: ${nextTex}`);
}

/** Verifies a single step in isolation; `prev` acts as the anchor equation. */
export function verifyStep(prev: string | null, next: string): Verdict {
  return verifyOneStep(next, prev);
}

/**
 * Verifies every step of a board script, aligned by index with
 * `script.steps`. Non-math steps are always `unchecked`. Every math step is
 * checked against the derivation's earliest math step (the anchor) -- both
 * Check A and Check B use that anchor, never the previous step.
 */
export function verifyScript(script: BoardScript): Verdict[] {
  const verdicts: Verdict[] = [];
  let anchorTex: string | null = null;

  for (const step of script.steps) {
    if (step.kind !== "math") {
      verdicts.push(unchecked("not a math step"));
      continue;
    }
    if (anchorTex === null) {
      // The anchor itself has nothing earlier to be checked against.
      anchorTex = step.tex;
      verdicts.push(unchecked(`anchor equation, nothing earlier to check against: ${step.tex}`));
      continue;
    }
    verdicts.push(verifyOneStep(step.tex, anchorTex));
  }

  return verdicts;
}
