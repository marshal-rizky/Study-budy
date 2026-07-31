# Model Capability Requirements, and the Student-Ink Decision

**Date:** 2026-07-18
**Status:** analysis + one recommendation awaiting sign-off (§4)
**Relates to:** [design](../specs/2026-07-16-ai-teacher-design.md) §2, §4.1–4.3, §5 Flow D, §6, §8 · [P2 plan](../plans/2026-07-18-board-director.md)

Target audience for the product: high school through early college maths,
physics and chemistry.

---

## 1. Content mastery is not the constraint

Raw problem-solving at this level is effectively saturated. Algebra, trig,
calculus I–II, Newtonian mechanics and stoichiometry are handled at high
accuracy by mid-tier current models; routine algebra is handled by small ones.
If the bar were "can it solve the problem", a cheap model would suffice.

Four capabilities actually matter, and they have very different bars:

| Capability | Bar | Can engineering substitute? |
|---|---|---|
| Solve the problem | low | — |
| Multi-step reliability | **high** | **yes, largely** |
| Diagnose the misconception | **high** | no |
| Calibration (knowing it is unsure) | high | partly |
| Pedagogical restraint | not a capability question | n/a — prompting/post-training |

## 2. The binding constraint is multi-step reliability

The board director emits 6–12 step derivations and **every step is visible to
the student**. A sign error on line 4 poisons everything below it, and the
student cannot detect it — that is the whole reason they are here.

Whole-solution accuracy is roughly per-step accuracy compounded:

| Per-step accuracy | 10-step solution correct |
|---|---|
| 95% | 60% |
| 98% | 82% |
| 99% | 90% |
| 99.5% | 95% |
| 99.9% | 99% |

Getting 95% of *whole solutions* clean across ten steps needs ~99.5% per step.
That is far harsher than "scores well on a maths benchmark", and it explains
the observed failure mode: almost never "could not do it", nearly always an
arithmetic slip, a dropped sign, or a silently changed unit.

(Errors are not independent and models often self-correct mid-derivation, so
this overstates the effect. Directionally it is the right intuition.)

## 3. Buy reliability with verification, not model size

Most of that error class is mechanically checkable:

- **Symbolic verification** — check each algebraic step with a CAS.
  `2x²+5x−3=0 → x=1/2` is verifiable by substitution, not by trust.
- **Dimensional analysis** — physics unit errors fall out deterministically.
- **Numeric spot-check** — evaluate both sides of a claimed identity.

A mid-tier model plus a verifier beats a frontier model alone on correctness,
and costs less. Extended thinking works for the same reason: it is verification
inside the step, raising per-step accuracy before anything reaches the board.

**Action:** add a verifier to P2 ahead of any further model-tier spending.
Design §6 already ranks wrong maths as the worst failure this system has; a
verifier is how that commitment is actually cashed in. Currently the P2 plan
relies on extended thinking and a self-check prompt alone, which is weaker.

What verification cannot fix is **misconception diagnosis**: inferring, from
"I got 7", *which* wrong path produces 7. That is abduction over a space of
plausible errors from sparse evidence, and it is harder than solving forward.
It is the best single test of whether a model can teach, and it is where model
strength genuinely has to be paid for.

## 4. Recommendation: drop free-form handwriting *interpretation*

Design §5 Flow D has student ink rasterised and read by Claude vision. Reading
messy handwritten derivations is the **highest capability bar in the system** —
higher than any of the maths above — and it is worth separating two things the
design currently bundles:

- **Ink as a drawing surface** — the student writes, points, sketches. Cheap,
  no model involved, genuinely useful. **Keep.**
- **Ink as something the AI reads** — vision interprets the writing. Expensive,
  slow, and highest-risk. **Defer.**

That seam is clean because nothing else depends on the second half: P2's
director and P3's voice are unaffected, and design §2's locked decision
("student input: voice + board access") is about *access*, which survives
intact.

Reasons to defer:

1. **The failure mode is corrosive.** Misreading work and then correcting the
   student wrongly — "you wrote 7, it should be 1", when they wrote 1 — damages
   trust faster than not reading at all. Silence beats confident misreading.
2. **The information is available more cheaply.** The student has a voice (P3)
   and a keyboard. "I got x equals 7" carries the same signal with no vision.
3. **Latency.** Rasterise → vision call → response sits badly inside a
   full-duplex loop that is already fighting for sync (§5 Flow C).
4. **Asking is not a degraded experience.** The product premise is a remote
   lesson over Zoom-with-an-iPad. Human tutors in exactly that setting ask
   students to read their work aloud constantly, because the camera is bad. So
   "I can't quite read that — what did you get?" is the *realistic* interaction,
   not a fallback.

### The cheap version, when it is wanted

Constrained recognition is dramatically easier than free-form: recognising a
short answer inside a **known box** is a far smaller problem than parsing a
page of derivation. The pedagogy spec (§4.3, active learning) already asks for
exactly this shape — the teacher leaves a blank, `2x = __`, and the student
fills it. That is both the pedagogically important case *and* the tractable
one, so it is the natural first step whenever ink reading returns.

Suggested progression:

1. **Now** — student writes freely; nothing reads it; the teacher asks them to
   say what they got.
2. **Cheap win** — constrained blanks: recognise a short expression in a known
   region, with low confidence falling back to asking.
3. **Later, possibly never** — free-form full-page reading.

### Cost of deferring

P4 loses "teacher spots the error in your working without being told", which is
a real pedagogical loss, not nothing. The mitigation is that the student states
their answer and the director reasons about *that* — which exercises the
misconception-diagnosis capability of §3 regardless, just from a verbal report
instead of an image.

**Not yet locked.** Design §5 Flow D and §8 P4 need editing if this is accepted.

## 5. Where difficulty actually rises

Within the target range the gradient is not uniform:

- Algebra → calculus II, mechanics, stoichiometry — comfortable
- E&M with vector calculus, thermodynamics — harder, more setup ambiguity
- Organic mechanisms — genuinely hard, and the stroke engine cannot draw them
- **Word problem → equations** — harder than solving once set up, and the most
  common place models are confidently wrong

## 6. Implications for the two brains

The dual-brain split (§3) maps onto this cleanly:

- **Voice brain** — personality, latency, turn-taking. Does not need to be
  smart, and must never be the source of truth.
- **Board director** — multi-step reliability plus diagnosis. This is where the
  capability budget belongs, and it justifies the frontier-model default in the
  P2 plan.
