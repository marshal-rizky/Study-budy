import { checkRenderable } from "@teacher/board-layout";
import { BoardStepSchema, parseBoardScript } from "@teacher/protocol";
import type { BoardScript, BoardStep } from "@teacher/protocol";
import { verifyStep } from "@teacher/verifier";
import { RetryableDirectorError } from "./client";
import type { DirectorClient, DirectorMessage, DirectorRequest, DirectorResponse, ToolCall } from "./client";
import { TOOLS, TOOL_TO_STEP_KIND } from "./tools";

export interface SolveOptions {
  /** Runaway guard: stop after this many accepted-or-rejected tool calls. */
  maxToolCalls?: number;
  /** Passed through to the client as the per-call token budget. */
  maxTokens?: number;
  /**
   * Cumulative spend guard across the whole loop (input + output tokens,
   * summed from each response's `usage`). Free-tier providers bill against
   * per-day quotas, so this bounds total spend independently of
   * `maxToolCalls` -- a loop emitting long steps could otherwise burn a
   * day's quota well before hitting the call-count cap. Default 60000.
   */
  maxTotalTokens?: number;
  /** Run each write_math step through the verifier before accepting it. */
  verify?: boolean;
  /** Deterministic id for the resulting script (design Flow C's stale-script guard). */
  scriptId?: string;
}

/** Token/call totals for one `solveProblem` run, for callers that want to log spend. */
export interface DirectorUsage {
  inputTokens: number;
  outputTokens: number;
  toolCalls: number;
}

/**
 * Why the loop stopped. `end_turn` is the clean case (model called no more
 * tools). The two `max_*` reasons are the runaway guards firing on a model
 * that never stops. `client_error` means a terminal client error broke the
 * loop before it reached a natural stop -- this is the case a caller must
 * not mistake for a clean run just because `script.steps` might still be
 * empty (Bug 2: a total failure and a trivial clean run used to look
 * identical).
 */
export type SolveStopReason = "end_turn" | "max_tool_calls" | "max_total_tokens" | "client_error";

/** Longest an error message included in a `SolveResult` may be. Some client errors
 * (e.g. openai-compat's HTTP-error path) embed the provider's raw response body,
 * which can be long and must never reach a log or a caller in full -- truncating
 * here, once, means no call site has to remember to. */
const MAX_ERROR_MESSAGE_LEN = 200;

function truncateErrorMessage(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  return message.length > MAX_ERROR_MESSAGE_LEN
    ? `${message.slice(0, MAX_ERROR_MESSAGE_LEN)}...`
    : message;
}

export interface SolveResult {
  script: BoardScript;
  usage: DirectorUsage;
  stopReason: SolveStopReason;
  /** Present only when `stopReason` is `"client_error"`. Message is truncated
   * (see `MAX_ERROR_MESSAGE_LEN`) and never includes an API key -- keys never
   * flow into a `DirectorClient` error message in the first place (they live
   * only in request headers), so there is nothing to strip, only to shorten. */
  error?: { message: string };
}

const DEFAULT_MAX_TOOL_CALLS = 24;
const DEFAULT_MAX_TOKENS = 4096;
const DEFAULT_MAX_TOTAL_TOKENS = 60000;
const DEFAULT_SCRIPT_ID = "script-1";

const MAX_REQUEST_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 50;

const SYSTEM_PROMPT = `You are a maths, physics, and chemistry teacher solving a problem on a shared \
whiteboard while a student watches.

Rules:
- Before calling a tool to write a step, work out and double-check the arithmetic or algebra for that \
step. The student sees every step you write as you write it -- a wrong step on the board is worse than \
a slow, careful one, because the student cannot tell a mistake on the board from the truth.
- Emit exactly ONE board step per tool call, in the order a teacher would write them on a physical \
board: state what's given and the goal first, then the derivation one step at a time, then the final \
answer clearly marked.
- Use write_math for every equation, formula, or standalone mathematical symbol. Use write_text only for \
plain narrative sentences -- it does not render TeX, so never put an equation there.
- If a tool call comes back as an error (invalid input, or a failed verification check), read the \
error, fix the actual mistake in your reasoning, and re-emit a corrected step -- do not repeat the same \
error and do not ignore it.
- When the solution is complete, stop calling tools.`;

interface ToolOutcome {
  content: string;
  isError: boolean;
  step?: BoardStep;
}

/**
 * Validates one tool call against the protocol's zod schema (re-attaching
 * the `kind` the tool name implies), then, for `write_math`, checks that the
 * stroke engine can actually render the TeX before running the verifier
 * against the derivation's anchor equation. Never throws -- failures come
 * back as a `ToolOutcome` with `isError: true` so the caller can report them
 * to the model as a `tool_result` instead of crashing the loop or silently
 * accepting a bad step.
 *
 * Renderability is checked before arithmetic verification and regardless of
 * `verify`: if the engine can't even parse the TeX, that's the most
 * actionable error to hand back, and there's no point verifying arithmetic
 * in a string that will never reach the board (Bug 4 -- `parseMath` threw on
 * `\boxed`/`\quad` at layout time, downstream of this loop entirely, and
 * discarded an otherwise-correct 9-step derivation).
 */
function handleToolCall(call: ToolCall, verify: boolean, anchorTex: string | null): ToolOutcome {
  const kind = TOOL_TO_STEP_KIND[call.name];
  if (!kind) {
    return { content: `unknown tool "${call.name}"`, isError: true };
  }

  const inputObj =
    typeof call.input === "object" && call.input !== null ? (call.input as Record<string, unknown>) : {};
  // `kind` must come LAST: it's derived from the tool name the model actually called,
  // which is authoritative. A model-supplied `kind` in the input (small models echo
  // schema-adjacent fields routinely) must never override it -- if it could, a
  // write_math call carrying {kind:"text", ...} would validate as a text step and skip
  // the verifier entirely, putting unchecked algebra on the board.
  const candidate = { ...inputObj, kind };

  const parsed = BoardStepSchema.safeParse(candidate);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("; ");
    return { content: `invalid ${call.name} input: ${issues}`, isError: true };
  }

  const step = parsed.data;

  if (step.kind === "math") {
    const renderable = checkRenderable(step.tex);
    if (!renderable.ok) {
      return {
        content: `cannot render "${step.tex}": ${renderable.reason}. Re-emit this step using only the supported TeX subset -- no \\boxed, \\quad, or other commands outside it.`,
        isError: true,
      };
    }

    if (verify) {
      const verdict = verifyStep(anchorTex, step.tex);
      if (verdict.status === "failed") {
        return {
          content: `verification failed for "${step.tex}": ${verdict.reason}. Re-derive this step -- do not write it as-is.`,
          isError: true,
        };
      }
    }
  }

  return { content: "ok", isError: false, step };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Calls the client, retrying a `RetryableDirectorError` (rate limit,
 * connection reset, 5xx -- whatever the adapter judged transient) with
 * exponential backoff, capped at `MAX_REQUEST_ATTEMPTS` total tries.
 * Anything else -- including validation failures, which never throw from
 * a client -- propagates on the first attempt.
 */
async function createMessageWithRetry(
  client: DirectorClient,
  req: DirectorRequest
): Promise<DirectorResponse> {
  for (let attempt = 1; attempt <= MAX_REQUEST_ATTEMPTS; attempt++) {
    try {
      return await client.createMessage(req);
    } catch (err) {
      const retryable = err instanceof RetryableDirectorError;
      if (!retryable || attempt >= MAX_REQUEST_ATTEMPTS) throw err;
      await sleep(RETRY_BASE_DELAY_MS * 2 ** (attempt - 1));
    }
  }
  // Unreachable: the loop above always either returns or throws.
  throw new Error("board-director: retry loop exited without a result");
}

/**
 * Drives the agentic tool-use loop that turns a question into a validated
 * `BoardScript`, and reports token/call totals alongside it. The model
 * never emits coordinates -- only semantic steps via the four tools in
 * `tools.ts` -- and every step is validated through the protocol's zod
 * schema (and, for math, the verifier) before it is accepted into the
 * script.
 *
 * Two runaway guards bound the loop independently: `maxToolCalls` caps the
 * number of steps, `maxTotalTokens` caps cumulative spend (input + output
 * tokens summed across every response). Either one stops the loop and
 * returns the script built so far -- never throws for hitting a cap.
 */
export async function solveProblemDetailed(
  question: string,
  client: DirectorClient,
  opts: SolveOptions = {}
): Promise<SolveResult> {
  const maxToolCalls = opts.maxToolCalls ?? DEFAULT_MAX_TOOL_CALLS;
  const maxTokens = opts.maxTokens ?? DEFAULT_MAX_TOKENS;
  const maxTotalTokens = opts.maxTotalTokens ?? DEFAULT_MAX_TOTAL_TOKENS;
  const verify = opts.verify ?? true;
  const scriptId = opts.scriptId ?? DEFAULT_SCRIPT_ID;

  const messages: DirectorMessage[] = [{ role: "user", content: question }];
  const steps: BoardStep[] = [];
  let anchorTex: string | null = null;
  let toolCallCount = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let stopReason: SolveStopReason | null = null;
  let error: { message: string } | undefined;

  while (toolCallCount < maxToolCalls && inputTokens + outputTokens < maxTotalTokens) {
    let response: DirectorResponse;
    try {
      response = await createMessageWithRetry(client, {
        system: SYSTEM_PROMPT,
        messages,
        tools: TOOLS,
        maxTokens,
      });
    } catch (err) {
      // Terminal client error -- retries (if any applied) are exhausted, or the
      // failure was never retryable to begin with. A partial, already-verified
      // script is worth more than an exception: stop here and return what we
      // have, with the same "return what's accumulated" contract as the caps --
      // but unlike the caps, this is a failure, and `stopReason: "client_error"`
      // says so instead of leaving a total failure looking identical to a run
      // that just happened to produce zero steps.
      stopReason = "client_error";
      error = { message: truncateErrorMessage(err) };
      break;
    }

    // Some OpenAI-compatible providers omit `usage` entirely -- treat that as 0
    // spend rather than crashing; it just means this call doesn't count against
    // the cumulative cap.
    inputTokens += response.usage?.inputTokens ?? 0;
    outputTokens += response.usage?.outputTokens ?? 0;

    messages.push({
      role: "assistant",
      toolCalls: response.toolCalls,
      text: response.text.length > 0 ? response.text : undefined,
      // Opaque to the loop -- only the adapter that produced it (if any) knows
      // what to do with it. Carried verbatim so it can be replayed next turn.
      providerBlocks: response.providerBlocks,
    });

    if (response.toolCalls.length === 0) {
      // Nothing to execute and nothing to respond to -- the model is done.
      stopReason = "end_turn";
      break;
    }

    const results: { id: string; content: string; isError: boolean }[] = [];

    for (const call of response.toolCalls) {
      toolCallCount++;
      const outcome = handleToolCall(call, verify, anchorTex);
      results.push({ id: call.id, content: outcome.content, isError: outcome.isError });

      if (!outcome.isError && outcome.step) {
        steps.push(outcome.step);
        if (outcome.step.kind === "math" && anchorTex === null) {
          anchorTex = outcome.step.tex;
        }
      }

      if (toolCallCount >= maxToolCalls) break;
    }

    messages.push({ role: "tool_results", results });

    if (toolCallCount >= maxToolCalls) {
      stopReason = "max_tool_calls";
      break;
    }
    // No stopReason==="end_turn" check here: for a spec-compliant provider,
    // toolCalls is always empty exactly when stop_reason isn't tool-use (the
    // `toolCalls.length === 0` branch above already handles that case), so
    // this point is only reached with toolCalls.length > 0 -- meaning a
    // compliant provider's stopReason literally cannot be "end_turn" here.
    // A non-compliant free-tier provider that *does* report "end_turn"
    // alongside tool calls is exactly the unreliable-tool-calling case the
    // plan warns about; trusting that signal to stop risks truncating a
    // derivation the model intended to continue. Not trusting it costs at
    // most one harmless extra request that self-terminates on the next
    // iteration via the toolCalls.length === 0 check. Investigated and
    // removed rather than kept as dead-for-good, risky-for-bad code.
  }

  // Every explicit `break` above sets `stopReason` before leaving the loop. The
  // only way to fall through with it still null is the `while` condition itself
  // going false -- i.e. a cap was already at/over its limit going into what
  // would have been the next iteration, without a step-processing break firing
  // in the iteration that crossed it (the `max_total_tokens` case: usage is
  // only checked at the top of the loop, never mid-iteration).
  if (stopReason === null) {
    stopReason = toolCallCount >= maxToolCalls ? "max_tool_calls" : "max_total_tokens";
  }

  const script = parseBoardScript({ scriptId, steps });
  return {
    script,
    usage: { inputTokens, outputTokens, toolCalls: toolCallCount },
    stopReason,
    ...(error ? { error } : {}),
  };
}

/** Convenience wrapper over `solveProblemDetailed` for callers that only want the script. */
export async function solveProblem(
  question: string,
  client: DirectorClient,
  opts: SolveOptions = {}
): Promise<BoardScript> {
  const { script } = await solveProblemDetailed(question, client, opts);
  return script;
}
