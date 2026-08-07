import { describe, expect, it } from "vitest";
import type { BoardStep } from "@teacher/protocol";
import { buildPlan, mulberry32 } from "@teacher/stroke-engine";
import type { Board } from "@teacher/stroke-engine";
import { checkStepRenderable, layoutScript } from "./layout-script";
import { MODEL_OUTPUT_CORPUS } from "./__fixtures__/model-output-corpus";

/**
 * These are property tests, not example tests -- see docs/superpowers/notes/2026-07-31-handoff.md
 * section 4: a green suite of hand-written happy-path examples has repeatedly hidden real
 * defects in this codebase because the tests were written to agree with the code, not to
 * check it against anything independent. `MODEL_OUTPUT_CORPUS` is real model output; the fuzz
 * generator below is adversarial by construction. Neither is tuned to make the code look good.
 */

const board: Board = { width: 900, height: 520 };

function mathStep(tex: string): BoardStep {
  return { kind: "math", tex, narration: "corpus entry" };
}

describe("checkStepRenderable -- totality", () => {
  it("returns a verdict, and never throws, for every corpus entry", () => {
    for (const entry of MODEL_OUTPUT_CORPUS) {
      expect(() => checkStepRenderable(mathStep(entry.tex), board), `input: ${entry.tex}`).not.toThrow();
    }
  });
});

describe("checkStepRenderable -- bad curve expressions (the third named bug class, alongside TeX and overflow)", () => {
  it("rejects a diagram step whose expr the safe expression compiler cannot parse, naming the construct", () => {
    const step: BoardStep = {
      kind: "diagram",
      narration: "bad curve",
      diagram: { kind: "curve", expr: "2 3", domain: [-1, 1], width: 200, height: 150, yRange: [-2, 2] },
    };

    const verdict = checkStepRenderable(step, board);
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) {
      expect(verdict.reason).toContain("invalid curve expression");
    }
  });

  it("accepts a diagram step whose expr the safe expression compiler CAN parse", () => {
    const step: BoardStep = {
      kind: "diagram",
      narration: "good curve",
      diagram: { kind: "curve", expr: "x^2", domain: [-2, 2], width: 200, height: 150, yRange: [0, 4] },
    };

    expect(checkStepRenderable(step, board)).toEqual({ ok: true });
  });
});

describe("checkStepRenderable -- soundness", () => {
  it("returns {ok:true} for every entry marked renderable, and it actually survives layoutScript+buildPlan", () => {
    const renderable = MODEL_OUTPUT_CORPUS.filter((e) => e.expectRenderable);
    expect(renderable.length).toBeGreaterThan(0);

    for (const entry of renderable) {
      const verdict = checkStepRenderable(mathStep(entry.tex), board);
      expect(verdict, `expected "${entry.tex}" to be renderable, got ${JSON.stringify(verdict)}`).toEqual({
        ok: true,
      });

      // Independently re-run the real render path -- checkStepRenderable must not be
      // lying about what it checked.
      expect(() => {
        const ops = layoutScript({ scriptId: "soundness-check", steps: [mathStep(entry.tex)] }, board);
        buildPlan(ops, { board });
      }, `"${entry.tex}" marked renderable but does not survive the real render path`).not.toThrow();
    }
  });

  it("returns {ok:false} with a non-empty reason for every entry marked non-renderable", () => {
    const nonRenderable = MODEL_OUTPUT_CORPUS.filter((e) => !e.expectRenderable);
    expect(nonRenderable.length).toBeGreaterThan(0);

    for (const entry of nonRenderable) {
      const verdict = checkStepRenderable(mathStep(entry.tex), board);
      expect(verdict.ok, `expected "${entry.tex}" to be rejected, got ${JSON.stringify(verdict)}`).toBe(false);
      if (!verdict.ok) {
        expect(verdict.reason.length, `"${entry.tex}" was rejected with an empty reason`).toBeGreaterThan(0);
      }
    }
  });
});

// --- Fuzz: seeded so any failure is reproducible from the seed printed below. ---

const FUZZ_SEED = 20260807;
const FUZZ_ITERATIONS = 500;

const LETTERS = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
const SYMBOL_CHARS = "\\{}^_+-*/=().0123456789 ";
// Math symbols, CJK, emoji (surrogate pair), a zero-width char, and a combining accent --
// deliberately mixed encodings, since a naive char-by-char parser can choke on any of these.
const UNICODE_SAMPLE = [..."π∑√∞漢字é中文\u200b\u0301", "😀"];

function randInt(rng: () => number, max: number): number {
  return Math.floor(rng() * max);
}

function randChoice<T>(rng: () => number, arr: T[]): T {
  return arr[randInt(rng, arr.length)];
}

function randomWord(rng: () => number, minLen = 1, maxLen = 12): string {
  const len = minLen + randInt(rng, maxLen - minLen + 1);
  let s = "";
  for (let i = 0; i < len; i++) s += randChoice(rng, [...LETTERS]);
  return s;
}

/** Random `\word` command -- most will be unknown to the parser, some may coincide with real ones. */
function randomCommand(rng: () => number): string {
  return `\\${randomWord(rng, 1, 15)}`;
}

/** Unbalanced braces: a run of `{` or `}` with no matching partner. */
function randomUnbalanced(rng: () => number): string {
  const n = 1 + randInt(rng, 8);
  const brace = randChoice(rng, ["{", "}"]);
  return brace.repeat(n) + randomWord(rng);
}

/** Deeply nested (but balanced) `\frac{\frac{...}{..}}{..}`. */
function randomNestedFrac(rng: () => number): string {
  const depth = 1 + randInt(rng, 20);
  let inner = randomWord(rng, 1, 3);
  for (let i = 0; i < depth; i++) {
    inner = `\\frac{${inner}}{${randomWord(rng, 1, 3)}}`;
  }
  return inner;
}

function randomUnicode(rng: () => number): string {
  const len = 1 + randInt(rng, 10);
  let s = "";
  for (let i = 0; i < len; i++) s += randChoice(rng, UNICODE_SAMPLE);
  return s;
}

/** A very long string of random TeX-ish symbol/letter noise. */
function randomVeryLong(rng: () => number): string {
  const len = 500 + randInt(rng, 2000);
  const pool = [...SYMBOL_CHARS, ...LETTERS];
  let s = "";
  for (let i = 0; i < len; i++) s += randChoice(rng, pool);
  return s;
}

function randomChunk(rng: () => number): string {
  switch (randInt(rng, 7)) {
    case 0:
      return "";
    case 1:
      return randomCommand(rng);
    case 2:
      return randomUnbalanced(rng);
    case 3:
      return randomNestedFrac(rng);
    case 4:
      return randomUnicode(rng);
    case 5:
      return randomVeryLong(rng);
    default: {
      const len = randInt(rng, 20);
      let s = "";
      for (let i = 0; i < len; i++) s += randChoice(rng, [...SYMBOL_CHARS]);
      return s;
    }
  }
}

function generateFuzzString(rng: () => number): string {
  const parts = 1 + randInt(rng, 4);
  let s = "";
  for (let i = 0; i < parts; i++) s += randomChunk(rng);
  return s;
}

describe("checkStepRenderable -- fuzz", () => {
  it(`never throws across ${FUZZ_ITERATIONS} pseudo-random TeX-ish strings (seed ${FUZZ_SEED})`, () => {
    const rng = mulberry32(FUZZ_SEED);
    const crashes: { input: string; error: unknown }[] = [];

    for (let i = 0; i < FUZZ_ITERATIONS; i++) {
      const tex = generateFuzzString(rng);
      try {
        checkStepRenderable(mathStep(tex), board);
      } catch (error) {
        crashes.push({ input: tex, error });
      }
    }

    if (crashes.length > 0) {
      const report = crashes
        .slice(0, 10)
        .map((c) => `  input (${c.input.length} chars): ${JSON.stringify(c.input.slice(0, 120))}\n  error: ${String(c.error)}`)
        .join("\n\n");
      throw new Error(
        `${crashes.length}/${FUZZ_ITERATIONS} fuzz inputs crashed checkStepRenderable instead of returning a ` +
          `verdict (seed ${FUZZ_SEED}, reproduce with mulberry32(${FUZZ_SEED})):\n\n${report}`
      );
    }

    expect(crashes).toHaveLength(0);
  });

  it.each([
    ["empty string", ""],
    ["very long string", "x".repeat(5000)],
    ["deeply nested frac", "\\frac{".repeat(50) + "x" + "}{y}".repeat(50)],
    ["unicode", "π∑√😀漢字"],
    ["unbalanced braces", "{{{{{x"],
    ["lone backslash", "\\"],
    ["only whitespace", "   "],
  ])("never throws for: %s", (_label, tex) => {
    expect(() => checkStepRenderable(mathStep(tex), board)).not.toThrow();
  });
});
