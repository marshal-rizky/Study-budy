# Phase 1 Findings — Stroke Engine

**Date:** 2026-07-18
**Status:** P1 complete; three defects found and fixed after the plan's tasks were all "done"
**Relates to:** [P1 plan](../plans/2026-07-16-stroke-engine.md), [design](../specs/2026-07-16-ai-teacher-design.md) §4.1, §6, §8

All thirteen P1 tasks were implemented, reviewed, merged, and green: 73 tests
passing, both packages typechecking. The engine was still producing unreadable
handwriting. This note records what was wrong, why the suite did not notice,
and what to change before P2 builds on top.

---

## 1. Curved glyphs collapsed to stubs

**Symptom.** The quadratic formula rendered as `x= -| ± √( |˙ −/| ˙ )`. Every
letter and digit was missing or reduced to a fragment.

**Cause.** `scripts/build-glyphs.mjs` parsed the Hershey `d` attribute with

```js
/([ML])\s*(-?\d+(?:\.\d+)?)[\s,]+(-?\d+(?:\.\d+)?)/g
```

which requires a command letter before *every* coordinate pair. SVG path
syntax allows implicit repetition, and the Hershey data uses it heavily:

```
2 -> "M4,6 L4,5 5,3 6,2 8,1 12,1 14,2 15,3 16,5 16,7 15,9 13,12 3,22 17,22"
```

That is one moveto and **thirteen** linetos. The regex captured the first pair
after each command and discarded the rest, so `2` became a 1.4px dot and `b`
lost its bowl. Up to 33 pairs follow a single command in this font.

**Fix.** Parse each command chunk and consume all of its pairs (commit
`07bd4f4`).

## 2. Advance widths were half their true value

**Symptom.** With curves restored, `Solve:` rendered as `Sdve` — the `o` and
`l` overlapped into a `d` and the colon was buried under the `e`.

**Cause.** The same script computed

```js
const left  = Math.min(...xs);      // ink shifted so left edge sits at 0
const advance = entry.o * scale + 0.1;
```

Two independent errors. In Hershey coordinates the ink sits inside `[0, 2*o]`,
so `o` is the **half**-advance and `minX`/`maxX` are the side bearings
(`H`: ink 4→18 within advance 22, bearings 4 and 4; `m`: 4→26 within 30).
Taking `o` as the full advance halved it, and shifting ink to `x=0` stripped
the left bearing. `advance - inkWidth` came out zero or negative for most
letters; `m` overlapped its neighbour by 0.133em.

**Fix.** Use `2*o` as the advance and keep x as authored (commit `af554a2`).

**Why it hid behind defect 1.** Math expressions looked acceptable because the
layout engine adds `OP_PAD` around binary operators, which masked the missing
bearings. Only running prose exposed it.

## 3. Overflow silently destroyed content

**Symptom.** A ten-step solution displayed seven lines, clipped one through the
middle of its glyphs, and dropped the last three — **including the answer**. A
long derivation cut off mid-radical. No error, no warning.

**Cause.** Nothing consulted the canvas bounds. `buildPlan` emitted strokes at
any coordinate and the browser discarded whatever fell outside. Design §6
specifies "Layout overflow → Auto `new_page`", and P1 shipped no `new_page`
primitive at all.

**Fix.** Optional `board` on `buildPlan` enabling measure-before-draw, with
auto-pagination and `LayoutOverflowError` for content no page break can rescue
(commit `8b9a341`).

---

## Why the test suite missed all three

76 tests passed over a library in which most characters were unreadable. Three
distinct blind spots, worth understanding separately because they have
different remedies.

**Fixtures shared the bug's blind spot.** Every glyph assertion used `H`, `x`,
`=`, `+`, `A`, `2`, `(`, `)`. Of these only `2` is curved, and the sole
assertion touching it was `strokes.length > 0` — true of a 1.4px dot. The
straight-line glyphs are exactly the ones with one coordinate pair per command,
so they survived the broken parser intact. The tests were not weak in general;
they were unlucky in a way that correlated perfectly with the defect.

**Snapshots validated the output against itself.** `golden.test.ts` pins
`buildPlan` geometry for seed 42. Those snapshots were generated *from the
broken engine*, so they encoded a dot-shaped `2` as the expected result and
would have failed had anyone fixed it. A snapshot proves stability, never
correctness. It cannot distinguish "still right" from "still wrong".

**No test rendered anything.** The whole of P1 exists to answer one question —
"does it look like real handwriting?" (design §8). Every test asserted on
numbers. The plan's Task 13 Step 4 *was* a manual visual checklist, and it was
the one step never performed. Both defects 1 and 2 are obvious within two
seconds of looking at the screen and invisible in any assertion that was
actually written.

## Changes made to the suite

- Curved glyphs (`2 3 S b o e`) must retain ≥6 points in their longest stroke.
- No letter or digit may have ink height ≤ 0.3em.
- Every glyph's ink must lie within `[0, advance]`, so neighbours cannot
  collide. `F` and `L` are named exceptions: they overhang their right bearing
  by one unit in the source `futural` data, verified against the raw font
  rather than papered over by loosening the bound for all 94 glyphs.
- Paged plans keep all ink inside the board.

## Recommendations for P2

1. **Look at the output.** Any phase with a visual deliverable needs a step
   where a human or an agent with vision inspects a render. Treat "the tests
   pass" as necessary and not sufficient. This is the single highest-value
   change on this list.
2. **Anchor snapshots to something external.** Keep the golden files for drift
   detection, but add a handful of assertions against independently known
   geometry (a glyph's expected stroke count and rough extent) so a wrong
   baseline cannot be silently blessed by `-u`.
3. **Prefer generated-data invariants to spot checks.** The three tests that
   would have caught these defects all quantify over *every* glyph rather than
   a hand-picked list. Where data is generated by a build script, assert
   properties across the whole output.
4. **Distrust a build script that no test covers.** All three defects lived in
   or were enabled by a 40-line `.mjs` file with zero direct tests, whose
   output every other test depended upon.
5. **`write_text` does not parse TeX.** Passing `3x^2` renders a literal `^`.
   Correct behaviour, easy trap: the board director should route anything
   mathematical to `write_math`. Worth an explicit check in P2.

## Open follow-ups

- Curve strokes join disjoint finite regions through an asymptote
  (`diagrams.ts`): `1/x` over a domain spanning zero draws a line connecting
  the branches. Fix is splitting into separate strokes at non-finite gaps.
- Pagination is live but there is no page-navigation UI, so earlier pages
  cannot be revisited. Design §4.1 schedules `PageNavigator` for P5; it becomes
  user-visible as soon as pagination is on.
- Inter-stroke gaps are a fixed 60ms and account for ~40% of animation time on
  a 115-stroke plan (10.1s pen, 6.8s gaps). Relevant to voice sync in P3.
