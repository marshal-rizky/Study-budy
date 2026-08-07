import { describe, expect, it } from "vitest";
import { MODEL_OUTPUT_CORPUS } from "@teacher/board-layout/fixtures";
import type { DirectorResponse } from "./client";
import { FakeClient } from "./clients/fake";
import { solveProblem } from "./director";

/**
 * Property 3 from the adversarial corpus plan: drive the FULL agentic loop
 * (not just `checkStepRenderable` in isolation) with a `FakeClient` that
 * emits every corpus entry -- good and bad -- as `write_math` tool calls,
 * and assert `solveProblem` never throws and keeps exactly the entries
 * marked renderable. This is the end-to-end version of the same guarantee
 * `board-layout`'s own totality/soundness tests check at the unit level --
 * it is what actually stands in for the live harvest run in CI.
 */
describe("solveProblem -- end-to-end corpus totality (Fix 3, property 3)", () => {
  it("never throws when driven by a FakeClient emitting the entire real-model-output corpus", async () => {
    const toolCallResponses: DirectorResponse[] = MODEL_OUTPUT_CORPUS.map((entry, i) => ({
      toolCalls: [
        { id: `corpus-${i}`, name: "write_math", input: { tex: entry.tex, narration: `corpus entry ${i}` } },
      ],
      text: "",
      stopReason: "tool_use",
    }));
    const client = new FakeClient([
      ...toolCallResponses,
      { toolCalls: [], text: "done", stopReason: "end_turn" },
    ]);

    let threw: unknown;
    let script: Awaited<ReturnType<typeof solveProblem>> | undefined;
    try {
      script = await solveProblem("corpus smoke test", client, {
        verify: false, // isolate the renderability gate from the arithmetic verifier
        maxToolCalls: MODEL_OUTPUT_CORPUS.length + 2,
      });
    } catch (err) {
      threw = err;
    }

    expect(threw).toBeUndefined();
    expect(script).toBeDefined();

    const expectedTex = MODEL_OUTPUT_CORPUS.filter((e) => e.expectRenderable).map((e) => e.tex);
    const actualTex = script!.steps.map((s) => (s.kind === "math" ? s.tex : undefined));
    expect(actualTex).toEqual(expectedTex);
  });
});
