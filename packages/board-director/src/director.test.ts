import { describe, expect, it } from "vitest";
import { checkStepRenderable } from "@teacher/board-layout";
import { verifyStep } from "@teacher/verifier";
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

/**
 * Finds the tool_result envelope for call `id` across the whole recorded
 * request history -- it lands in whichever request came after the call was
 * executed, so a flat search across every request's messages is the only
 * reliable way to find it. Centralized so a change to the message/envelope
 * shape is one edit instead of one per call site.
 */
function toolResultFor(client: FakeClient, id: string) {
  return client.requests
    .flatMap((r) => r.messages)
    .filter((m): m is Extract<typeof m, { role: "tool_results" }> => m.role === "tool_results")
    .flatMap((m) => m.results)
    .find((r) => r.id === id);
}

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
    const errorResult = toolResultFor(client, "2");

    expect(errorResult).toBeDefined();
    expect(errorResult?.isError).toBe(true);
    expect(errorResult?.content).toContain("verification failed");
  });

  it("rejects a write_math step with unsupported TeX (the renderability gate, Fix 1) and lets the model self-correct", async () => {
    const client = new FakeClient([
      // \boxed is outside the stroke engine's TeX subset -- from the handoff note's Bug 4
      // ("Add a regression test with \\boxed{x}").
      toolUse("1", "write_math", { tex: "\\boxed{x}", narration: "bad" }),
      toolUse("2", "write_math", { tex: "x = \\frac{1}{2}", narration: "corrected" }),
      END_TURN,
    ]);

    const script = await solveProblem("solve", client, { verify: false });

    // Only the corrected step made it in -- the unrenderable one never entered the script.
    expect(script.steps).toEqual([{ kind: "math", tex: "x = \\frac{1}{2}", narration: "corrected" }]);

    const errorResult = client.requests
      .flatMap((r) => r.messages)
      .filter((m): m is Extract<typeof m, { role: "tool_results" }> => m.role === "tool_results")
      .flatMap((m) => m.results)
      .find((r) => r.id === "1");

    expect(errorResult).toBeDefined();
    expect(errorResult?.isError).toBe(true);
    expect(errorResult?.content).toContain("cannot render");
    // Actionable: names the offending command, not just "invalid".
    expect(errorResult?.content).toContain("\\boxed");
  });

  it("rejects the real OpenRouter output combining \\/ , \\boxed and \\quad in one step (handoff Bug 4)", async () => {
    const client = new FakeClient([
      toolUse("1", "write_math", { tex: "x = \\frac{2}{4} \\/\\boxed{\\frac{1}{2}}, \\quad", narration: "bad" }),
      toolUse("2", "write_math", { tex: "x = \\frac{1}{2}", narration: "corrected" }),
      END_TURN,
    ]);

    const script = await solveProblem("solve", client, { verify: false });

    expect(script.steps).toEqual([{ kind: "math", tex: "x = \\frac{1}{2}", narration: "corrected" }]);

    const errorResult = client.requests
      .flatMap((r) => r.messages)
      .filter((m): m is Extract<typeof m, { role: "tool_results" }> => m.role === "tool_results")
      .flatMap((m) => m.results)
      .find((r) => r.id === "1");

    expect(errorResult?.isError).toBe(true);
    expect(errorResult?.content).toContain("cannot render");
  });

  it("rejects a write_math step too wide for the configured board, without crashing solveProblem (Fix 1)", async () => {
    // The exact 959px-wide chained equation from the live harvest that used to throw
    // LayoutOverflowError straight out of buildPlan and discard the whole script.
    const client = new FakeClient([
      toolUse("1", "write_math", {
        tex: "(x^2 - 9)/(x - 3) = (x + 3)(x - 3)/(x - 3) = x + 3",
        narration: "chained",
      }),
      toolUse("2", "write_math", { tex: "x + 3", narration: "simplified" }),
      END_TURN,
    ]);

    const script = await solveProblem("simplify", client, {
      verify: false,
      board: { width: 900, height: 520 },
    });

    expect(script.steps).toEqual([{ kind: "math", tex: "x + 3", narration: "simplified" }]);

    const errorResult = client.requests
      .flatMap((r) => r.messages)
      .filter((m): m is Extract<typeof m, { role: "tool_results" }> => m.role === "tool_results")
      .flatMap((m) => m.results)
      .find((r) => r.id === "1");

    expect(errorResult?.isError).toBe(true);
    expect(errorResult?.content).toContain("cannot render");
    expect(errorResult?.content).toMatch(/wide|split/);
  });

  it("honours a custom board option -- a step that fits 900x520 can be rejected on a smaller board", async () => {
    const client = new FakeClient([toolUse("1", "write_math", { tex: "x = 1", narration: "n" }), END_TURN]);

    const script = await solveProblem("solve", client, {
      verify: false,
      board: { width: 10, height: 10 }, // nothing can fit
    });

    expect(script.steps).toEqual([]);
    const errorResult = client.requests
      .flatMap((r) => r.messages)
      .filter((m): m is Extract<typeof m, { role: "tool_results" }> => m.role === "tool_results")
      .flatMap((m) => m.results)
      .find((r) => r.id === "1");
    expect(errorResult?.isError).toBe(true);
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

    const errorResult = toolResultFor(client, "2");

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
    // Fast sleep -- Fix 2 raised the real backoff base to 1000ms, so tests that hit several
    // retries must inject a no-op sleep or every run of the suite pays real wall-clock time.
    const script = await solveProblem("q", flakyThenOk, { sleep: async () => {} });
    expect(script.steps).toEqual([]);
    expect(calls).toBe(3);
  });

  it("honours a RetryableDirectorError's retryAfterMs instead of computing its own backoff (Fix 2)", async () => {
    let calls = 0;
    const client: DirectorClient = {
      async createMessage(_req: DirectorRequest) {
        calls++;
        if (calls === 1) throw new RetryableDirectorError("rate limited", { retryAfterMs: 5000 });
        return END_TURN;
      },
    };
    const delays: number[] = [];
    await solveProblem("q", client, {
      sleep: async (ms) => {
        delays.push(ms);
      },
    });

    expect(delays).toEqual([5000]);
    expect(calls).toBe(2);
  });

  it("caps an honoured retryAfterMs at the maximum backoff delay rather than waiting arbitrarily long (Fix 2)", async () => {
    let calls = 0;
    const client: DirectorClient = {
      async createMessage(_req: DirectorRequest) {
        calls++;
        if (calls === 1) throw new RetryableDirectorError("rate limited", { retryAfterMs: 120_000 });
        return END_TURN;
      },
    };
    const delays: number[] = [];
    await solveProblem("q", client, {
      sleep: async (ms) => {
        delays.push(ms);
      },
    });

    expect(delays).toHaveLength(1);
    expect(delays[0]).toBeLessThanOrEqual(30_000);
  });

  it("falls back to jittered exponential backoff from a >=1000ms base when the client gives no retryAfterMs (Fix 2)", async () => {
    let calls = 0;
    const client: DirectorClient = {
      async createMessage(_req: DirectorRequest) {
        calls++;
        if (calls < 3) throw new RetryableDirectorError("transient"); // no retryAfterMs
        return END_TURN;
      },
    };
    const delays: number[] = [];
    await solveProblem("q", client, {
      sleep: async (ms) => {
        delays.push(ms);
      },
    });

    // Two retries (attempts 1 and 2) before the third call succeeds. Full-jitter backoff:
    // attempt N's delay is uniform in [0, min(30000, 1000 * 2^(N-1))] -- unlike the old
    // 50ms base, this is large enough to actually clear a real free-tier rate-limit window.
    expect(delays).toHaveLength(2);
    expect(delays[0]).toBeGreaterThanOrEqual(0);
    expect(delays[0]).toBeLessThanOrEqual(1000);
    expect(delays[1]).toBeGreaterThanOrEqual(0);
    expect(delays[1]).toBeLessThanOrEqual(2000);
  });

  it("treats a terminal error (retries exhausted, or never retryable) as a stop signal, not an exception, at the solveProblemDetailed level (I2)", async () => {
    // Retries exhausted: still fails on every attempt within the single
    // createMessageWithRetry call, which itself caps at 3 attempts.
    let neverOkCalls = 0;
    const alwaysFlaky: DirectorClient = {
      async createMessage(_req: DirectorRequest) {
        neverOkCalls++;
        throw new RetryableDirectorError("still transient");
      },
    };
    const result1 = await solveProblemDetailed("q", alwaysFlaky, { sleep: async () => {} });
    expect(result1.stopReason).toBe("client_error");
    expect(result1.script.steps).toEqual([]); // no exception -- an empty partial script instead
    expect(neverOkCalls).toBe(3); // capped, not infinite

    // Never retryable: createMessageWithRetry gives up on the first attempt.
    let nonRetryableCalls = 0;
    const hardFailure: DirectorClient = {
      async createMessage(_req: DirectorRequest) {
        nonRetryableCalls++;
        throw new Error("not retryable");
      },
    };
    const result2 = await solveProblemDetailed("q", hardFailure);
    expect(result2.stopReason).toBe("client_error");
    expect(result2.script.steps).toEqual([]);
    expect(nonRetryableCalls).toBe(1); // never retried, but still doesn't throw out of solveProblemDetailed
  });

  it("solveProblem (unlike solveProblemDetailed) throws when the run stops on a client error (Fix 5)", async () => {
    // This is the exact gap the handoff note flagged: solveProblem used to discard
    // stopReason entirely, so a hard client_error and a clean trivial run both came back
    // as an empty script -- indistinguishable. solveProblem must now surface the failure
    // instead of returning a script that looks identical to a successful empty run.
    const alwaysFlaky: DirectorClient = {
      async createMessage(_req: DirectorRequest) {
        throw new RetryableDirectorError("still transient");
      },
    };
    await expect(solveProblem("q", alwaysFlaky, { sleep: async () => {} })).rejects.toThrow(
      /client error/
    );

    const hardFailure: DirectorClient = {
      async createMessage(_req: DirectorRequest) {
        throw new Error("not retryable");
      },
    };
    await expect(solveProblem("q", hardFailure)).rejects.toThrow(/client error/);
  });

  it("solveProblem still returns the partial script without throwing when a run stops on a cap, not a client error (Fix 5)", async () => {
    const client = new FakeClient([toolUse("x", "write_text", { text: "again", narration: "n" })]);

    const script = await solveProblem("never stop", client, { maxToolCalls: 3, verify: false });

    expect(script.steps).toHaveLength(3);
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

  it("rejects a write_math step the stroke engine cannot render (Bug 4), then accepts the corrected retry", async () => {
    const client = new FakeClient([
      toolUse("1", "write_math", { tex: "x = \\frac{2}{4} \\boxed{\\frac{1}{2}}, \\quad y=1", narration: "boxed answer" }),
      toolUse("2", "write_math", { tex: "x = \\frac{1}{2}", narration: "corrected" }),
      END_TURN,
    ]);

    const script = await solveProblem("solve", client, { verify: false });

    // The unrenderable step never made it into the script; only the correction did.
    expect(script.steps).toEqual([{ kind: "math", tex: "x = \\frac{1}{2}", narration: "corrected" }]);

    const errorResult = toolResultFor(client, "1");

    expect(errorResult).toBeDefined();
    expect(errorResult?.isError).toBe(true);
    // Assert on the engine's actual diagnostic (surfaced through checkStepRenderable's
    // reason), not just that the static part of the error template mentions "\boxed" --
    // the template's trailing sentence doesn't name any command itself, so this only
    // passes if the gate's own reason made it into `content`.
    expect(errorResult?.content).toContain("\\boxed");
  });

  it("renderability is checked even when verify is off and even for the unverifiable anchor step", async () => {
    // \boxed{x} is the FIRST math step, so anchorTex is null when it's evaluated -- the
    // verifier would score a null-anchor step "unchecked" (never "failed"; see
    // verifyOneStep), so if renderability ran only inside the `verify` branch, or after
    // the verifier instead of before it, this bad step would slip through when verify
    // is false. Renderability must catch it regardless.
    const client = new FakeClient([
      toolUse("1", "write_math", { tex: "\\boxed{x}", narration: "boxed" }),
      toolUse("2", "write_math", { tex: "x = 1", narration: "corrected" }),
      END_TURN,
    ]);

    const script = await solveProblem("solve", client, { verify: false });

    expect(script.steps).toEqual([{ kind: "math", tex: "x = 1", narration: "corrected" }]);

    const errorResult = toolResultFor(client, "1");

    expect(errorResult?.isError).toBe(true);
    // Same discrimination as above: the gate's own diagnostic, not the static
    // template text.
    expect(errorResult?.content).toContain("\\boxed");
  });

  it("checks renderability BEFORE verification even when the same step would also fail verification, proving order rather than just presence (Bug 4)", async () => {
    // \cdot is a case where the two parsers disagree: the stroke engine's parseMath
    // does not know it (rejected -- see stroke-engine's SYMBOL_COMMANDS), but the
    // verifier's texToExpr does (it maps \cdot -> "*", see tex-to-expr.ts's
    // OPERATOR_COMMANDS) and can therefore evaluate this step's arithmetic. That
    // means this exact tex is BOTH unrenderable AND would fail arithmetic
    // verification if verifyStep ran on it. If renderability were checked after
    // verifyStep (or removed and rendered moot by verify alone), the tool_result
    // would read "verification failed"; because it's checked first, it must read
    // the engine's parse diagnostic instead. A test using verify:false (as the two
    // tests above do) cannot distinguish these -- it only proves verify-independence,
    // not ordering.
    //
    // Both preconditions this test depends on are asserted directly, right here,
    // rather than assumed. The handoff doc lists \cdot as a likely near-term
    // addition to the engine's TeX subset -- if that happens, the first assertion
    // below fails with a message that says exactly why, instead of the ordering
    // assertions failing deep in the FakeClient plumbing with no explanation, and
    // instead of the tempting (wrong) fix of switching to verify:false, which would
    // silently delete the only coverage of the ordering guarantee.
    const renderablePrecondition = checkStepRenderable(
      { kind: "math", tex: "2 \\cdot x=10", narration: "precondition check" },
      { width: 900, height: 520 }
    );
    expect(
      renderablePrecondition.ok,
      "precondition for this test: \\cdot must still be unrenderable by the engine. If this fails, the engine's TeX subset grew \\cdot -- rewrite this test with a different disagreement case between parseMath and texToExpr; do not switch to verify:false."
    ).toBe(false);

    const verifyVerdict = verifyStep("2x+3=7", "2 \\cdot x=10");
    expect(
      verifyVerdict.status,
      "precondition for this test: this tex must still fail arithmetic verification (not just render). Only status matters here -- the verifier's wording is not this test's concern."
    ).toBe("failed");

    const client = new FakeClient([
      toolUse("1", "write_math", { tex: "2x+3=7", narration: "anchor" }),
      toolUse("2", "write_math", { tex: "2 \\cdot x=10", narration: "wrong and unrenderable" }),
      END_TURN,
    ]);

    const script = await solveProblem("solve 2x+3=7", client, { verify: true });

    expect(script.steps).toEqual([{ kind: "math", tex: "2x+3=7", narration: "anchor" }]);

    const errorResult = toolResultFor(client, "2");

    expect(errorResult?.isError).toBe(true);
    expect(errorResult?.content).toContain("\\cdot");
    expect(errorResult?.content).not.toContain("verification failed");
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
