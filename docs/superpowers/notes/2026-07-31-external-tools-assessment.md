# Assessment: agency-swarm, make-it-heavy, LiCoMemory

**Date:** 2026-07-31
**Status:** analysis; one recommendation needing sign-off (§4)
**Relates to:** [design](../specs/2026-07-16-ai-teacher-design.md) §3, §4.4, §8 · [capability note](2026-07-18-model-capability-and-student-ink.md)

Three installed tools evaluated for use in AI Teacher. Summary: **adopt one
pattern, adopt one requirement, skip one framework.** None of the three should
become a runtime dependency.

| Tool | Verdict | Why |
|---|---|---|
| agency-swarm 0.7.2 | **skip** | conflicts with the latency architecture; Python |
| make-it-heavy | **adopt the pattern, not the code** | right idea, wrong tier — offline only |
| LiCoMemory | **skip the code, adopt the requirement** | exposes a real gap: cross-session student memory |

---

## 1. agency-swarm — skip

*What it is:* a Python framework for orchestrating many agents with roles,
threads, and agent-to-agent communication flows.

Two independent reasons not to use it:

**It solves a problem this project deliberately does not have.** Its value is
coordinating *many* conversing agents. The [capability
note](2026-07-18-model-capability-and-student-ink.md) §6 established that the
binding constraint here is latency, that roughly one model can sit on the
critical path, and that every added brain multiplies error and invites state
divergence. AI Teacher is two brains by design, with orchestration already
owned by `EventBus` + `SessionManager` — deterministic, in-process, debuggable.
Adopting an agent-mesh framework would import the exact failure mode the
two-brain split was chosen to avoid.

**It is Python; the stack is TypeScript end to end.** A live voice loop cannot
afford a cross-process hop on the critical path.

Nothing to salvage. The one transferable idea — typed messages between roles —
the project already has in `packages/protocol`, zod-validated and shared.

## 2. make-it-heavy — adopt the pattern, in the offline tier only

*What it is:* decompose a question into N subtasks, run N agents in parallel
(OpenRouter), synthesize the results. ~200 lines: `orchestrator.py` does
`decompose_task` → `run_agent_parallel` → synthesis call.

The pattern is quality-through-redundancy: N× tokens and N× latency for a
better answer. That trade is **disqualifying on the live path** and **excellent
off it**. Mapping to the tiering in the capability note:

| Use | Verdict |
|---|---|
| Live lesson (voice, board director) | **no** — multiplies latency on a budget already tight |
| Task 6 eval grading | **yes** — independent graders voting beats a single judge |
| Misconception diagnosis (async tier) | **yes, promising** — generate N candidate explanations for a wrong answer in parallel, then select |
| P6 lesson planning | **yes** — decompose a topic into segments, offline |

The diagnosis case is the most interesting. Diagnosis is the one capability
verification cannot substitute for, and it is abductive: enumerate plausible
wrong paths, test each against the evidence. That is naturally parallel and
naturally offline.

**Do not vendor the code.** It is Python, OpenRouter-coupled, and small enough
that a TypeScript equivalent is cheaper than a bridge. Reimplement the pattern
where needed; the existing `DirectorClient` seam already reaches OpenRouter.

## 3. LiCoMemory — skip the code, adopt the requirement

*What it is:* a research implementation of hierarchical graph memory
("Cognigraph") for multi-session dialogue — entities and relations as semantic
index layers, temporal- and hierarchy-aware retrieval with reranking. Ships
with dataset loaders and an evaluation harness for LOCOMO / LongMemEval.

*Why not the code:* it is a paper artifact, not a library. Its shape is
`main.py -opt config/Memory.yaml -dataset_name ...` — a benchmark runner. It is
Python, its interface is a config file, and its complexity is calibrated to
scoring well on long-dialogue benchmarks, not to serving a tutor.

**But it points at a genuine hole in the design**, which is the reason this
assessment is worth writing at all:

- §4.4 requires **adaptivity**: "probe prior knowledge first, adjust level."
- The only persistence in the phase plan is "session persistence" in P6 (§8) —
  storing a session, not modelling a student.
- So today the tutor forgets the student between sessions. It re-probes prior
  knowledge every time, cannot notice that factoring has now failed three weeks
  running, and cannot adjust level from history. That undercuts a stated
  pedagogical requirement.

### What is actually needed

Far less than a Cognigraph. A **student model**: a small structured record,
updated at session end and read at session start.

```
student_id
concept        e.g. "quadratic.factoring"
attempts, successes, last_seen
observed_errors  e.g. ["sign error distributing", "drops second root"]
level_estimate
```

A table plus a summarisation pass — not a graph, not a retrieval stack. The
board director reads the relevant rows when a topic opens; the voice brain gets
a one-paragraph digest. Deterministic, inspectable, and cheap, consistent with
the project's standing preference for moving work out of models and into code.

### When LiCoMemory's ideas would matter

Its transferable insight is that **temporal-aware, hierarchical retrieval**
starts to matter once memory outgrows what fits in context. For one student
over months of tutoring, the naive approach — a few rows plus a digest — should
hold comfortably. Revisit if memory grows past that, and treat this as a
pointer to prior art rather than a dependency.

**Recommendation:** add a student-model phase to §8 (P7, or fold into P6), and
note in §4.4 that adaptivity spans sessions, not just the current one. Not yet
applied to the design doc — needs sign-off.

---

## Meta

None of the three is a dependency worth taking. Their value here was
diagnostic: evaluating LiCoMemory surfaced a requirement gap that had been sitting
unnoticed in the phase plan, which is worth more than any of the code would
have been.
