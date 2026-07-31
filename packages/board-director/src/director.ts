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
  /** Run each write_math step through the verifier before accepting it. */
  verify?: boolean;
  /** Deterministic id for the resulting script (design Flow C's stale-script guard). */
  scriptId?: string;
}

const DEFAULT_MAX_TOOL_CALLS = 24;
const DEFAULT_MAX_TOKENS = 4096;
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
 * the `kind` the tool name implies) and, for `write_math`, runs the
 * verifier against the derivation's anchor equation. Never throws --
 * failures come back as a `ToolOutcome` with `isError: true` so the caller
 * can report them to the model as a `tool_result` instead of crashing the
 * loop or silently accepting a bad step.
 */
function handleToolCall(call: ToolCall, verify: boolean, anchorTex: string | null): ToolOutcome {
  const kind = TOOL_TO_STEP_KIND[call.name];
  if (!kind) {
    return { content: `unknown tool "${call.name}"`, isError: true };
  }

  const inputObj =
    typeof call.input === "object" && call.input !== null ? (call.input as Record<string, unknown>) : {};
  const candidate = { kind, ...inputObj };

  const parsed = BoardStepSchema.safeParse(candidate);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("; ");
    return { content: `invalid ${call.name} input: ${issues}`, isError: true };
  }

  const step = parsed.data;

  if (verify && step.kind === "math") {
    const verdict = verifyStep(anchorTex, step.tex);
    if (verdict.status === "failed") {
      return {
        content: `verification failed for "${step.tex}": ${verdict.reason}. Re-derive this step -- do not write it as-is.`,
        isError: true,
      };
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
 * `BoardScript`. The model never emits coordinates -- only semantic steps
 * via the four tools in `tools.ts` -- and every step is validated through
 * the protocol's zod schema (and, for math, the verifier) before it is
 * accepted into the script.
 */
export async function solveProblem(
  question: string,
  client: DirectorClient,
  opts: SolveOptions = {}
): Promise<BoardScript> {
  const maxToolCalls = opts.maxToolCalls ?? DEFAULT_MAX_TOOL_CALLS;
  const maxTokens = opts.maxTokens ?? DEFAULT_MAX_TOKENS;
  const verify = opts.verify ?? true;
  const scriptId = opts.scriptId ?? DEFAULT_SCRIPT_ID;

  const messages: DirectorMessage[] = [{ role: "user", content: question }];
  const steps: BoardStep[] = [];
  let anchorTex: string | null = null;
  let toolCallCount = 0;

  while (toolCallCount < maxToolCalls) {
    const response = await createMessageWithRetry(client, {
      system: SYSTEM_PROMPT,
      messages,
      tools: TOOLS,
      maxTokens,
    });

    messages.push({
      role: "assistant",
      toolCalls: response.toolCalls,
      text: response.text.length > 0 ? response.text : undefined,
    });

    if (response.toolCalls.length === 0) {
      // Nothing to execute and nothing to respond to -- the model is done.
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

    if (response.stopReason === "end_turn") break;
    if (toolCallCount >= maxToolCalls) break;
  }

  return parseBoardScript({ scriptId, steps });
}
