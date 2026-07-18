# Board Director (AI Teacher Phase 2) Implementation Plan

**Date:** 2026-07-18
**Goal:** Claude solves a maths/physics/chemistry problem and drives the whiteboard through a validated `BoardScript`, with a text chat UI and no voice.
**Retires (design §8):** script format, math correctness, layout in practice.
**Relates to:** [design](../specs/2026-07-16-ai-teacher-design.md) §4.2–§4.3, §5 Flow A, §6, §7 · [P1 findings](../notes/2026-07-18-phase-1-findings.md)

---

## Central design decision: the model does not compute coordinates

The engine's `Op` takes absolute pixel positions. The obvious wiring — let
Claude emit `Op`s directly — is the wrong shape, for three reasons:

1. Asking an LLM to do pixel arithmetic burns reasoning on the thing it is
   worst at, while the real job (being correct about the maths) is the thing it
   is best at.
2. Layout correctness would become non-deterministic and unreviewable.
3. We already own exact layout metrics (`MathLayout.width/ascent/descent`) and
   bounds-checked pagination from P1. That machinery should decide positions.

So the director emits **position-free semantic steps**, and a deterministic
`BoardLayout` module assigns coordinates and pages. Claude decides *what* is
written; the engine guarantees *how* it looks — the same division already
stated in design §4.1 for the math layout engine, applied one level up.

This is what actually retires the "layout in practice" risk. It also means
layout is fully testable without an API key.

## Model

Design §2 names Claude Opus 4.8. The Claude 5 family now supersedes it and is
stronger at exactly the multi-step symbolic reasoning the director does, so
default to `claude-fable-5` with the model id read from `TEACHER_MODEL` so the
choice stays a config decision. Wrong maths on the board is the worst failure
this system has (design §6), which is what justifies the most capable model
rather than the cheapest.

## Constraint: no API key in this environment

`ANTHROPIC_API_KEY` is unset here, so the live loop cannot be exercised.
Everything except Task 3's network call must be verifiable without it:
the director takes an injectable client, and the eval harness is skipped
(not failed) when the key is absent. Task 5 must be visually checked with a
canned script. **The live loop remains unverified until someone runs it with a
key** — P1's lesson was that unrun code is unverified code, so this is called
out rather than assumed away.

## Global constraints

- TypeScript strict everywhere; npm workspaces; Vitest.
- `packages/protocol` has one runtime dependency (`zod`) and no engine import.
- The director package never imports the stroke engine; it speaks protocol only.
- No secrets in the repo. Key comes from the environment.
- Every task ends green: `npm test` at the root, `tsc --noEmit` in each package.

---

### Task 1: `packages/protocol` — BoardScript schema

**Files:** `packages/protocol/{package.json,tsconfig.json}`, `src/index.ts`,
`src/board-script.ts`, `src/board-script.test.ts`

Zod schemas, inferred types exported alongside:

```ts
BoardStep =
  | { kind: "math";    tex: string;  narration: string }
  | { kind: "text";    text: string; narration: string }
  | { kind: "diagram"; diagram: DiagramSpec; narration: string }
  | { kind: "new_page" }

BoardScript = { scriptId: string; steps: BoardStep[] }
```

`DiagramSpec` mirrors the engine's `Diagram` union but is declarative and
JSON-safe: `curve` carries `expr: string` (e.g. `"x^2"`), never a function.

- `narration` is the per-step `narrationHint` of design §4.3, carried from the
  start so P3 does not have to reshape the protocol.
- `scriptId` supports the stale-script guard of design Flow C.
- Export `parseBoardScript(json): BoardScript` throwing a readable error.

**Verify:** round-trips a valid script; rejects an unknown `kind`, a missing
`narration`, and a `curve` whose `expr` is not a string.

### Task 2: `packages/protocol` — deterministic BoardLayout

**Files:** `packages/board-layout/…` (depends on protocol **and** engine)

```ts
layoutScript(script: BoardScript, board: Board, opts?): Op[]
```

Walks the steps top to bottom, assigning each a baseline from a running cursor:

- Line advance from the step's own measured `ascent + descent` plus leading,
  not a fixed constant, so a tall fraction does not collide with the next line.
- `new_page` resets the cursor and emits the engine's `new_page` op.
- When a step would not fit, rely on `buildPlan`'s pagination rather than
  duplicating the rule; surface `LayoutOverflowError` unchanged.
- `expr` → curve function via a **small explicit evaluator** over a whitelisted
  grammar (numbers, `x`, `+ - * / ^`, parentheses, `sin cos tan sqrt exp ln`).
  Never `eval`/`new Function`: this string originates from a model.

**Verify:** a 10-step script lays out without overlap; tall fractions push the
next line down; ink stays inside the board; the evaluator computes `x^2` and
`sin(x)` correctly and rejects `process.exit(1)`.

### Task 3: `packages/board-director` — the Claude loop

**Files:** `packages/board-director/…`, depends on `@anthropic-ai/sdk`, protocol

```ts
interface DirectorClient { createMessage(req): Promise<Response> } // injectable
solveProblem(question: string, client: DirectorClient, opts?): Promise<BoardScript>
```

- Tools exposed to the model: `write_math`, `write_text`, `draw_diagram`,
  `new_page` — the design §4.2 set minus the ones needing student ink or
  documents (P4/P5). Each tool's schema is generated from the Task 1 zod
  schemas so protocol and tools cannot drift.
- Extended thinking enabled, with the system prompt requiring the model to
  verify its arithmetic in thinking before emitting steps (design §6, "wrong
  math on the board is worse than slow board").
- Agentic loop: run tool calls until `end_turn`, accumulating steps in order.
- Every tool input is parsed through the zod schema; a malformed call is
  returned to the model as a `tool_result` error so it can self-correct
  (design §6, "invalid board op").
- Retry `RateLimitError`/`APIConnectionError` with backoff; cap total tokens.

**Verify** with a scripted fake client, no network: a two-tool-call
conversation produces an ordered script; a malformed tool input produces a
tool_result error and the corrected retry is accepted; the loop terminates on
`end_turn`; a tool-call cap prevents runaways.

### Task 4: `apps/server` — HTTP endpoint

`POST /solve {question}` → `BoardScript`. Node's built-in `http`, no framework.
Reads the key from the environment and returns 503 with a clear message when it
is absent. `GET /health`. Errors map to sensible status codes; the API key is
never echoed. P3 replaces this with the WebSocket of design §3.

**Verify:** endpoint returns a valid script with a stubbed director; 400 on a
missing question; 503 with no key; supertest-style test over `http` only.

### Task 5: chat UI in `apps/web`

Split view: chat transcript left, existing whiteboard right. Submitting a
question calls `/solve`, lays the script out via Task 2, and plays it with the
existing `Player`. Each step's `narration` appears in the transcript as the pen
reaches it (design Flow A step 5) — the text stand-in for P3's voice.

**Verify (must be visual, per P1 findings):** with a canned script fixture and
no API key, drive the UI in a browser and confirm the board renders the
solution legibly, pagination behaves, and narration tracks the pen.

### Task 6: eval harness

`evals/` with ~30 problems across maths, physics and chemistry (design §7).
For each: run the director, assert the script parses, that layout produces no
overflow error, and grade final-answer correctness with a separate Claude call
given the expected answer. Report pass rate per subject; `describe.skipIf(no
key)` so the suite stays green offline.

**Verify:** harness runs and skips cleanly without a key; a deliberately wrong
canned answer is graded incorrect.

---

## Sequencing

1 → 2 can proceed immediately and are fully verifiable offline. 3 → 4 need the
SDK but not a key. 5 is visual. 6 needs a key to be meaningful.

## Self-review notes

- **Not** in P2, deferred as designed: voice (P3), student ink and the pedagogy
  eval harness (P4), documents (P5), `erase`/`annotate_student_work` (need
  `BoardObject` identity, which arrives with student ink in P4).
- `BoardObject` from design §4.3 is deliberately omitted: nothing in P2 erases
  or references prior objects, and inventing the identity scheme before P4's
  requirements exist would be speculative.
- Biggest residual risk is unchanged from the design: the model being confidently
  wrong about maths. Task 6 measures it; extended thinking and the self-check
  prompt are the mitigations.
