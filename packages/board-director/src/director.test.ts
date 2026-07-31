import { describe, expect, it } from "vitest";
import type { DirectorClient, DirectorRequest, DirectorResponse } from "./client";
import { RetryableDirectorError } from "./client";
import { FakeClient } from "./clients/fake";
import { solveProblem, solveProblemDetailed } from "./director";

function toolUse(id: string, name: string, input: unknown): DirectorResponse {
  return { toolCalls: [{ id, name, input }], text: "", stopReason: "tool_use" };
}

function toolUseWithUsage(
  id: string,
  name: string,
  input: unknown,
  usage: { inputTokens: number; outputTokens: number }
): DirectorResponse {
  return { toolCalls: [{ id, name, input }], text: "", stopReason: "tool_use", usage };
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

  it("ignores a model-supplied kind that conflicts with the tool called -- the tool's kind always wins (C3)", async () => {
    const client = new FakeClient([
      toolUse("1", "write_math", { tex: "2x+3=7", narration: "anchor" }),
      // A write_math call whose input carries a conflicting kind:"text". If this were
      // allowed to override, it would validate as a text step and skip the verifier
      // entirely, letting unchecked (and here, wrong) algebra reach the board.
      toolUse("2", "write_math", { kind: "text", tex: "2x=10", narration: "bad" }),
      END_TURN,
    ]);

    const script = await solveProblem("solve 2x+3=7", client, { verify: true });

    // Only the anchor made it in -- proving call "2" was validated as MATH (so the
    // verifier ran on it at all) and then rejected for being wrong math, not silently
    // accepted as an unverified text step.
    expect(script.steps).toEqual([{ kind: "math", tex: "2x+3=7", narration: "anchor" }]);

    const errorResult = client.requests
      .flatMap((r) => r.messages)
      .filter((m): m is Extract<typeof m, { role: "tool_results" }> => m.role === "tool_results")
      .flatMap((m) => m.results)
      .find((r) => r.id === "2");

    expect(errorResult).toBeDefined();
    expect(errorResult?.isError).toBe(true);
    expect(errorResult?.content).toContain("verification failed");
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
  });

  it("treats a terminal error (retries exhausted, or never retryable) as a stop signal, not an exception (I2)", async () => {
    // Retries exhausted: still fails on every attempt within the single
    // createMessageWithRetry call, which itself caps at 3 attempts.
    let neverOkCalls = 0;
    const alwaysFlaky: DirectorClient = {
      async createMessage(_req: DirectorRequest) {
        neverOkCalls++;
        throw new RetryableDirectorError("still transient");
      },
    };
    const script1 = await solveProblem("q", alwaysFlaky);
    expect(script1.steps).toEqual([]); // no exception -- an empty partial script instead
    expect(neverOkCalls).toBe(3); // capped, not infinite

    // Never retryable: createMessageWithRetry gives up on the first attempt.
    let nonRetryableCalls = 0;
    const hardFailure: DirectorClient = {
      async createMessage(_req: DirectorRequest) {
        nonRetryableCalls++;
        throw new Error("not retryable");
      },
    };
    const script2 = await solveProblem("q", hardFailure);
    expect(script2.steps).toEqual([]);
    expect(nonRetryableCalls).toBe(1); // never retried, but still doesn't throw out of solveProblem
  });

  it("returns the partial script (and its usage) when a terminal error hits after some steps were already accepted (I2)", async () => {
    let calls = 0;
    const failsOnSecondTurn: DirectorClient = {
      async createMessage(_req: DirectorRequest) {
        calls++;
        if (calls === 1) {
          return toolUseWithUsage("1", "write_text", { text: "first", narration: "n" }, {
            inputTokens: 10,
            outputTokens: 4,
          });
        }
        throw new Error("provider fell over on turn 2");
      },
    };

    const result = await solveProblemDetailed("q", failsOnSecondTurn, { verify: false });

    // The already-accepted step and its usage survive; the loop just stops rather than
    // throwing away ten (here, one) verified steps because turn two failed.
    expect(result.script.steps).toEqual([{ kind: "text", text: "first", narration: "n" }]);
    expect(result.usage).toEqual({ inputTokens: 10, outputTokens: 4, toolCalls: 1 });
    expect(calls).toBe(2);
  });

  it("stops once cumulative token usage reaches maxTotalTokens, returning the script built so far", async () => {
    const client = new FakeClient([
      toolUseWithUsage("1", "write_math", { tex: "x=1", narration: "first" }, {
        inputTokens: 60,
        outputTokens: 20,
      }), // running total 80
      toolUseWithUsage("2", "write_text", { text: "second", narration: "n" }, {
        inputTokens: 30,
        outputTokens: 10,
      }), // running total 120 -- crosses the cap of 100
      toolUse("3", "write_text", { text: "third, should never be requested", narration: "n" }),
    ]);

    const script = await solveProblem("q", client, { maxTotalTokens: 100, verify: false });

    // Both in-flight responses are honored (the cap is only checked before issuing the
    // *next* request), but the third request -- which would add a step -- never happens.
    expect(script.steps).toEqual([
      { kind: "math", tex: "x=1", narration: "first" },
      { kind: "text", text: "second", narration: "n" },
    ]);
    expect(client.requests).toHaveLength(2);
  });

  it("treats missing response.usage as zero spend and does not crash", async () => {
    const client = new FakeClient([
      toolUse("1", "write_text", { text: "hello", narration: "n" }), // no `usage` field at all
      END_TURN, // also no `usage`
    ]);

    const script = await solveProblem("q", client, { maxTotalTokens: 100, verify: false });

    expect(script.steps).toEqual([{ kind: "text", text: "hello", narration: "n" }]);
    expect(client.requests).toHaveLength(2);
  });

  it("reports stopReason 'end_turn' for a normal run (Bug 2)", async () => {
    const client = new FakeClient([
      toolUse("1", "write_math", { tex: "x=1", narration: "first" }),
      END_TURN,
    ]);

    const result = await solveProblemDetailed("q", client, { verify: false });

    expect(result.stopReason).toBe("end_turn");
    expect(result.error).toBeUndefined();
  });

  it("reports stopReason 'max_tool_calls' when the call-count cap fires", async () => {
    const client = new FakeClient([toolUse("x", "write_text", { text: "again", narration: "n" })]);

    const result = await solveProblemDetailed("never stop", client, { maxToolCalls: 5, verify: false });

    expect(result.stopReason).toBe("max_tool_calls");
    expect(result.error).toBeUndefined();
  });

  it("reports stopReason 'max_total_tokens' when the cumulative token cap fires", async () => {
    const client = new FakeClient([
      toolUseWithUsage("1", "write_math", { tex: "x=1", narration: "first" }, {
        inputTokens: 60,
        outputTokens: 20,
      }),
      toolUseWithUsage("2", "write_text", { text: "second", narration: "n" }, {
        inputTokens: 30,
        outputTokens: 10,
      }),
      toolUse("3", "write_text", { text: "third, should never be requested", narration: "n" }),
    ]);

    const result = await solveProblemDetailed("q", client, { maxTotalTokens: 100, verify: false });

    expect(result.stopReason).toBe("max_total_tokens");
    expect(result.error).toBeUndefined();
  });

  it("reports stopReason 'client_error' with a present, key-free message when a terminal client error breaks the loop (Bug 2)", async () => {
    const secretKey = "sk-super-secret-do-not-leak";
    const hardFailure: DirectorClient = {
      async createMessage(_req: DirectorRequest) {
        // A realistic client error embeds provider response text, never the key itself
        // (the key only ever lives in a request header, which this loop never touches) --
        // but it can be long, so it must come back truncated regardless.
        throw new Error(
          `openai-compat: HTTP 400 from chat/completions: ${"x".repeat(300)} (auth used ${secretKey.slice(0, 0)})`
        );
      },
    };

    const result = await solveProblemDetailed("q", hardFailure, { verify: false });

    expect(result.stopReason).toBe("client_error");
    expect(result.error?.message).toBeDefined();
    expect(result.error!.message.length).toBeLessThanOrEqual(203); // ~200 + "..."
    expect(result.error!.message).not.toContain(secretKey);
    expect(result.script.steps).toEqual([]);
  });

  it("solveProblemDetailed reports usage totals matching the sum of the fake's reported usage", async () => {
    const client = new FakeClient([
      toolUseWithUsage("1", "write_text", { text: "step", narration: "n" }, {
        inputTokens: 15,
        outputTokens: 5,
      }),
      { toolCalls: [], text: "done", stopReason: "end_turn", usage: { inputTokens: 8, outputTokens: 2 } },
    ]);

    const result = await solveProblemDetailed("q", client, { verify: false });

    expect(result.script.steps).toEqual([{ kind: "text", text: "step", narration: "n" }]);
    expect(result.usage).toEqual({ inputTokens: 23, outputTokens: 7, toolCalls: 1 });
  });
});
