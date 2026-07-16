# AI Teacher — Design Document

**Date:** 2026-07-16
**Status:** Approved by user (brainstorm session)
**Purpose:** Portfolio/research project

## 1. Vision

A Neuro-sama-inspired dual-AI system that teaches 1-on-1 lessons like a human teacher on Zoom with an iPad: the student hears a teacher's voice and watches handwriting and diagrams appear stroke-by-stroke on a virtual whiteboard. The student talks back in full-duplex (can interrupt mid-sentence) and can scribble on the board themselves. Subjects: math, physics, chemistry. Supports both teacher-led lessons and student-driven Q&A, plus a document mode where students upload homework (PDF/photo) and the teacher annotates it directly.

**Analogy to Neuro-sama's framework:** Neuro-sama = ML model (plays the game) + LLM (talks to chat). AI Teacher = realtime voice model (talks with the student) + strong LLM (drives the whiteboard). The whiteboard is the "game."

## 2. Locked decisions

| Decision | Choice |
|---|---|
| Purpose | Portfolio/research project |
| Presence | Whiteboard + voice only (no avatar) |
| Subjects | Math, physics, chemistry from the start (content phased) |
| Student input | Voice + board access (student can scribble) |
| Platform | Web app (React + TS), Node/TS backend; packaged as desktop app later (Tauri/Electron) |
| AI stack | Cloud APIs: OpenAI Realtime (voice), Claude Opus 4.8 (board director) |
| Lesson flow | Both: teacher-led lessons AND student-driven Q&A |
| Voice model | Full-duplex realtime (student can interrupt mid-sentence) |
| Handwriting | Vector stroke engine (approach B); ML handwriting synthesis (approach C) as future upgrade — see §4.3 |
| Architecture | Dual brain (approach B): realtime voice brain + Claude board director |

**Rejected alternatives (for the record):**
- *Handwriting*: (A) handwriting-font character reveal — dead end for diagrams/chem structures; (C) ML stroke synthesis — weak on math symbols, research risk; kept as future upgrade since the engine interface ("strokes in, animation out") is identical.
- *Architecture*: (A) single realtime brain with board tool-calls — board quality capped by realtime-model reasoning; (C) scripted segments + barge-in — perfect sync but walks back full-duplex; kept as de-risk fallback (the segment format lives on as the board director's output format).

## 3. System overview

```
┌──────────────────────── Browser (React + TS) ───────────────────────┐
│  Whiteboard (canvas layers: background/doc · teacher ink · student  │
│  ink) · StrokeEngine · AudioClient · StudentInk · SessionUI          │
└───────────────▲──────────────────────────────▲──────────────────────┘
                │ WebSocket (audio + events)    │ BoardScripts
┌───────────────┴──────── Backend (Node + TS) ──┴─────────────────────┐
│  SessionManager · EventBus (single source of truth for ordering)    │
│  VoiceBridge ◄──────────► OpenAI Realtime API  (voice brain)        │
│  BoardDirector ◄────────► Claude Opus 4.8      (board brain)        │
│  DocumentManager (P5)                                               │
└──────────────────────────────────────────────────────────────────────┘
```

Three core pieces:

1. **Voice brain** — OpenAI Realtime API (speech-to-speech). Handles conversation: listens, talks, handles interruptions natively. Teacher personality lives here. Receives text events describing board activity and student ink so it can narrate.
2. **Board director** — Claude Opus 4.8 (streaming + tool use). Watches transcript + board state, does the actual math/physics/chemistry reasoning (correctness lives here, never in the voice model), and emits **BoardScripts**: structured sequences of drawing operations.
3. **Stroke engine** — client-side TypeScript renderer. Turns BoardScripts into animated pen strokes on canvas. Interface is "strokes in, animation out" so ML-generated strokes can swap in later without engine changes.

## 4. Components

### 4.1 Frontend (React + TS)

- **Whiteboard** — layered canvas: background (grid/axes/document page), teacher ink, student ink. Pan/scroll for "new page".
- **StrokeEngine** — consumes BoardScripts, animates strokes at realistic pen speed. Sub-modules:
  - *Glyph stroke library* (pre-baked): common symbols shipped as static, hand-tuned stroke data — digits 0-9, latin a-z A-Z, operators (+ − × ÷ = ≠ ≈ < > ≤ ≥ ± →), brackets, fraction bar, √ ∫ Σ, Greek set (π θ Δ …), chem symbols (⇌, charges). Each glyph = ordered stroke list with draw direction, matching real handwriting ("7" = two strokes, "=" = two lines).
  - *Jitter module*: per-instance random warp, baseline wobble, speed variation — same "x" never renders identically twice.
  - *Glyph fallback*: symbols not in the library → runtime font-outline→stroke conversion, cached after first use.
  - *Math layout engine*: takes TeX-subset input (`write_math("\frac{x+1}{x-2}")`), decomposes complex expressions into a positioned tree of preset glyphs — fractions, super/subscripts, radicals, matrices. The board director picks *what* to write; the engine guarantees *how* it looks.
  - *Diagram primitives*: `axes`, `curve(fn)`, `vector arrow`, `circuit parts`, `benzene ring`, `Lewis dots` — rendered rough/hand-drawn (rough.js technique).
- **AudioClient** — mic capture → WebSocket; teacher voice playback; barge-in (student speech pauses teacher audio).
- **StudentInk** — student draws with pointer/stylus in own color; vector strokes sent to backend.
- **SessionUI** — start/stop, subject picker, collapsible transcript panel.
- **PageNavigator** (P5) — document thumbnails, page switching, per-page ink persistence.

### 4.2 Backend (Node + TS, WebSocket)

- **SessionManager** — one session per student: transcript, board object list, lesson state.
- **VoiceBridge** — proxies audio browser ↔ OpenAI Realtime; injects text events (board intents, ink descriptions) into voice context; forwards voice transcript to session state.
- **BoardDirector** — Claude Opus 4.8 streaming loop with tool use. Tools: `write_math`, `write_text`, `draw_diagram`, `erase`, `new_page`, `annotate_student_work`; document mode adds `focus_problem(id)`, `annotate_document(region, ops)`. Triggered on: student question, voice brain requesting board support, lesson step advance. Sees transcript, current board objects, and student ink (as image via vision when needed). Prompted to self-check math in thinking before emitting a script.
- **EventBus** — orders all events (transcript ↔ board intents ↔ ink). Single source of truth for sync.
- **DocumentManager** (P5) — upload, page rasterization, page state, problem map.

### 4.3 Shared protocol (TS package, zod-validated)

- `BoardScript` = list of timed ops: `{type, payload, estimatedMs, narrationHint, scriptId}`.
- `BoardObject` = drawn item with id + bounding box (for erase/reference/annotation).
- The stroke engine's input boundary is the swap point for future ML handwriting synthesis (Graves-style RNN / diffusion pen trajectories): ML strokes replace font-derived strokes; engine and protocol unchanged.

### 4.4 Pedagogy spec

A versioned markdown "teaching constitution" (iterable without code changes) applied to **both** brains, based on Khanmigo's Socratic approach and Google LearnLM's pedagogical-instruction-following principles:

- **Socratic default**: never dump the answer; probing questions, graduated hints, ask the student to explain back.
- **Active learning**: student manipulates ideas (fills blanks the teacher leaves on the board: `2x = __`).
- **Cognitive load**: one concept per step; board mirrors step-by-step structure.
- **Adaptivity**: probe prior knowledge first, adjust level.
- **Motivation**: encouragement, never shame errors.
- **Metacognition**: prompt reflection ("how would you check this answer?").
- **Homework rule**: in document mode, annotate hints on the sheet, never write final answers on the student's homework.

Voice brain gets the conversational rules; board director gets the structural rules.

References: LearnLM paper (https://storage.googleapis.com/deepmind-media/LearnLM/LearnLM_paper.pdf, https://arxiv.org/html/2412.16429v2), Socratic physics tutor (https://arxiv.org/pdf/2507.05795), Khanmigo case study (https://www.buildmvpfast.com/blog/ai-tutoring-khanmigo-case-study-2026).

## 5. Data flow & sync

### Flow A — student-driven Q&A
1. Student speech → VoiceBridge → Realtime transcribes + responds conversationally ("Good question, let's work through it—").
2. Transcript event → EventBus → BoardDirector triggers.
3. Claude solves, emits BoardScript with step markers and per-step `narrationHint`.
4. StrokeEngine draws; each op start/end → EventBus → injected into voice context: `[board: now writing "2x=4", ~3s]`.
5. Voice narrates in step with the pen.

**Pacing rule:** pen leads slightly; voice narrates the current board event only, never states a result before its op is drawn.

### Flow B — teacher-led lesson
Lesson plan = ordered segments (JSON: goal, board content, check-question). BoardDirector generates each segment's script; voice teaches it; after the check-question, the student's answer decides advance vs re-explain (BoardDirector judges).

### Flow C — interruption
1. Mic activity → barge-in: teacher audio pauses instantly (Realtime native); pen finishes the current glyph (~300 ms) then pauses — mid-stroke stops look broken.
2. Quick interjection ("wait, why 3?") → voice answers, same script resumes.
3. Direction change → BoardDirector cancels remaining script, emits a new one. Stale-script guard: ops tagged with `scriptId`; engine drops ops from cancelled scripts.

### Flow D — student ink
1. Student draws (own color) → vector strokes → backend.
2. Pen-up + 800 ms idle → ink region rasterized → Claude vision reads it.
3. Text description → voice context (fast verbal reaction) + BoardDirector may annotate (circle mistake, ✓/✗).

### Flow E — document mode (P5)
1. Student uploads PDF/photo → backend rasterizes pages.
2. Page = whiteboard background layer; ink layers on top unchanged.
3. Page image → Claude vision → **problem map**: `[{problemId, text, bbox}]`.
4. Teacher annotates on the document (circles, underlines, margin work, ✓/✗) using existing stroke ops anchored to document coordinates.
5. Student selects a problem by voice ("help with number 3") or tap; student ink on the sheet flows as in Flow D.
6. Crowded margins → split view: worksheet left, blank board right.

### Sync fallback
Claude script slower than 2.5 s → voice fills naturally ("let me write this out…") — filler behavior prompted in the voice model instructions.

## 6. Error handling

| Failure | Behavior |
|---|---|
| Voice WebSocket drops | Auto-reconnect with backoff; session state lives on backend, context re-injected; subtle "reconnecting" UI chip |
| Claude slow (>2.5 s) | Voice filler; never dead air >3 s |
| Claude hard fail | Voice teaches that step without board ("let's do this one aloud") + retry |
| Invalid board op | Engine skips op, logs, reports back to BoardDirector via tool result → Claude self-corrects |
| Layout overflow | Auto `new_page` |
| Wrong math risk | BoardDirector self-check in thinking before emitting; wrong math on board is worse than slow board |
| STT ambiguity | Voice confirms ("did you say x squared or x times 2?") |
| Cost | Per-session token/minute caps; idle timeout auto-ends session |

## 7. Testing

- **Stroke engine**: unit tests (layout tree from TeX-subset, glyph decomposition, bbox math) + visual snapshot tests (script → PNG diff).
- **Protocol**: shared TS types + zod validation both ends; recorded BoardScript replay files for deterministic playback tests.
- **Board director**: golden-set evals — ~30 problems across 3 subjects; assert script validity + math correctness (Claude grader).
- **Pedagogy harness**: scripted fake-student personas (confused, quick, guess-happy, silent) × subjects drive automated sessions; a separate Claude instance grades transcripts against a LearnLM-style rubric. Run on every pedagogy-spec/prompt change — regression-test teaching quality like code.
- **Sync/e2e**: scripted sessions with fake voice events; assert narration-op ordering.
- **Manual**: weekly self-session as student; findings recorded.

## 8. Build phases

| Phase | Deliverable | Risk it retires |
|---|---|---|
| **P1 — Stroke engine standalone** | Glyph library, math layout, diagram primitives, jitter; demo page: type TeX-subset → animated handwriting | The core "does it look like real handwriting?" bet — no AI needed |
| **P2 — Board director** | Claude → BoardScript pipeline with text chat (no voice); solves problems on board with step narration text | Script format, math correctness, layout in practice |
| **P3 — Voice** | OpenAI Realtime full-duplex, EventBus sync, barge-in | The sync hard problem; first real "lesson" moment |
| **P4 — Student ink + pedagogy** | Student board access, vision reading, pedagogy spec + eval harness | Interactivity + teaching quality |
| **P5 — Document mode** | PDF upload, problem map, document annotation, split view | Homework use case |
| **P6 — Lessons + polish** | Teacher-led lesson plans, subject content packs, session persistence | Product completeness |

**Later (post-P6):** desktop app packaging (Tauri/Electron); ML handwriting synthesis swap-in (approach C).

## 9. Open questions (deferred, not blocking)

- Voice choice/persona details for the teacher (pick during P3).
- Exact TeX subset supported by the layout engine (define during P1 from the golden problem set).
- Chemistry structure primitive depth (benzene/Lewis first; full skeletal formulas later).
