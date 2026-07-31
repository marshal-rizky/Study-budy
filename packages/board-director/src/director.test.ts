import { describe, expect, it } from "vitest";
import type { DirectorClient, DirectorRequest, DirectorResponse } from "./client";
import { RetryableDirectorError } from "./client";
import { FakeClient } from "./clients/fake";
import { solveProblem } from "./director";

function toolUse(id: string, name: string, input: unknown): DirectorResponse {
  return { toolCalls: [{ id, name, input }], text: "", stopReason: "tool_use" };
}

const END_TURN: DirectorResponse = { toolCalls: [], text: "Done.", stopReason: "end_turn" };

describe("solveProblem", () => {
  it("produces an ordered script from a two-tool-call conversation", async () => {
    const client = new FakeClient([
      toolUse("1", "write_math", { tex: "x=1", narration: "first" }),
      toolUse("2", "write_text", { text: "done", narration: "second" }),
      END_TURN,
    ]);

    const script = await solveProblem("solve for x", client, { scriptId: "s-1" });

    expect(script.scriptId).toBe("s-1");
    expect(script.steps).toEqual([
      { kind: "math", tex: "x=1", narration: "first" },
      { kind: "text", text: "done", narration: "second" },
    ]);
  });

  it("terminates on end_turn without exhausting maxToolCalls", async () => {
    const client = new FakeClient([END_TURN]);

    const script = await solveProblem("what is 2+2", client, { maxToolCalls: 50 });

    expect(script.steps).toEqual([]);
    expect(client.requests).toHaveLength(1);
  });

  it("reports a malformed tool input as a tool_result error, then accepts the corrected retry", async () => {
    const client = new FakeClient([
      toolUse("1", "write_math", { tex: "x=2" }), // missing narration -- invalid
      toolUse("2", "write_math", { tex: "x=2", narration: "corrected" }),
      END_TURN,
    ]);

    const script = await solveProblem("solve", client, { verify: false });

    expect(script.steps).toEqual([{ kind: "math", tex: "x=2", narration: "corrected" }]);

    // The second request's history must carry the first call's error result.
    const secondRequest = client.requests[1];
    const toolResultsMsg = secondRequest.messages.find((m) => m.role === "tool_results");
    expect(toolResultsMsg).toBeDefined();
    if (toolResultsMsg?.role === "tool_results") {
      expect(toolResultsMsg.results).toEqual([
        expect.objectContaining({ id: "1", isError: true }),
      ]);
      expect(toolResultsMsg.results[0].content.toLowerCase()).toContain("narration");
    }
  });

  it("caps a runaway loop at maxToolCalls and returns what it has", async () => {
    // A single scripted response that always demands another tool call -- FakeClient
    // repeats the last entry forever, simulating a model that never stops.
    const client = new FakeClient([toolUse("x", "write_text", { text: "again", narration: "n" })]);

    const script = await solveProblem("never stop", client, { maxToolCalls: 5, verify: false });

    expect(script.steps).toHaveLength(5);
    expect(client.requests).toHaveLength(5);
  });

  it("rejects a write_math step that fails verification, and does not put it in the script", async () => {
    const client = new FakeClient([
      toolUse("1", "write_math", { tex: "2x+3=7", narration: "anchor" }),
      toolUse("2", "write_math", { tex: "2x=10", narration: "wrong step" }), // sign error
      END_TURN,
    ]);

    const script = await solveProblem("solve 2x+3=7", client, { verify: true });

    expect(script.steps).toEqual([{ kind: "math", tex: "2x+3=7", narration: "anchor" }]);

    // Find, across the whole recorded history, the tool_results entry for call "2" (the
    // rejected step) -- it lands in whichever request came after it was executed.
    const errorResult = client.requests
      .flatMap((r) => r.messages)
      .filter((m): m is Extract<typeof m, { role: "tool_results" }> => m.role === "tool_results")
      .flatMap((m) => m.results)
      .find((r) => r.id === "2");

    expect(errorResult).toBeDefined();
    expect(errorResult?.isError).toBe(true);
    expect(errorResult?.content).toContain("verification failed");
  });

  it("accepts the same wrong step when verify is false", async () => {
    const client = new FakeClient([
      toolUse("1", "write_math", { tex: "2x+3=7", narration: "anchor" }),
      toolUse("2", "write_math", { tex: "2x=10", narration: "wrong step" }),
      END_TURN,
    ]);

    const script = await solveProblem("solve 2x+3=7", client, { verify: false });

    expect(script.steps).toEqual([
      { kind: "math", tex: "2x+3=7", narration: "anchor" },
      { kind: "math", tex: "2x=10", narration: "wrong step" },
    ]);
  });

  it("uses the default scriptId when none is given", async () => {
    const client = new FakeClient([END_TURN]);
    const script = await solveProblem("q", client);
    expect(script.scriptId).toBe("script-1");
  });

  it("retries a RetryableDirectorError with backoff, up to a cap, before giving up", async () => {
    let calls = 0;
    const flakyThenOk: DirectorClient = {
      async createMessage(_req: DirectorRequest) {
        calls++;
        if (calls < 3) throw new RetryableDirectorError("transient");
        return END_TURN;
      },
    };
    const script = await solveProblem("q", flakyThenOk);
    expect(script.steps).toEqual([]);
    expect(calls).toBe(3);

    let neverOkCalls = 0;
    const alwaysFlaky: DirectorClient = {
      async createMessage(_req: DirectorRequest) {
        neverOkCalls++;
        throw new RetryableDirectorError("still transient");
      },
    };
    await expect(solveProblem("q", alwaysFlaky)).rejects.toBeInstanceOf(RetryableDirectorError);
    expect(neverOkCalls).toBe(3); // capped, not infinite

    let nonRetryableCalls = 0;
    const hardFailure: DirectorClient = {
      async createMessage(_req: DirectorRequest) {
        nonRetryableCalls++;
        throw new Error("not retryable");
      },
    };
    await expect(solveProblem("q", hardFailure)).rejects.toThrow("not retryable");
    expect(nonRetryableCalls).toBe(1); // never retried
  });
});
