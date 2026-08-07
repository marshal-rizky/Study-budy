import { z } from "zod";
import { RetryableDirectorError } from "../client";
import type { DirectorClient, DirectorMessage, DirectorRequest, DirectorResponse, ToolCall } from "../client";

/**
 * Talks to any OpenAI-compatible `/chat/completions` endpoint (Groq,
 * Cerebras, OpenRouter, Ollama, LM Studio) with plain `fetch` -- no SDK
 * dependency, since these providers only need the one endpoint. Owns the
 * translation between our provider-neutral shape and OpenAI's tool-call
 * shape so `director.ts` never has to know the difference.
 */

type FetchLike = typeof fetch;

export interface OpenAICompatClientOptions {
  apiKey: string;
  model: string;
  baseUrl: string;
  /** Injectable for tests -- never call a real network endpoint from a test. */
  fetchImpl?: FetchLike;
}

interface OpenAIToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

// The response is untrusted wire data from whatever's behind TEACHER_BASE_URL -- free-tier
// and self-hosted providers are exactly the ones most likely to send a near-miss shape.
// `{"choices":[{}]}` used to crash with an unguarded cast; validating it here, once,
// means every field read below is genuinely the type it claims to be -- in particular,
// `usage` values must be numbers, so a provider sending `"123"` (a string) fails
// validation loudly instead of silently turning `inputTokens += ...` into string
// concatenation and disabling the maxTotalTokens comparison.
const ResponseToolCallSchema = z.object({
  id: z.string(),
  type: z.literal("function"),
  function: z.object({ name: z.string(), arguments: z.string() }),
});

const ResponseMessageSchema = z.object({
  role: z.string(),
  content: z.string().nullable().optional(),
  tool_calls: z.array(ResponseToolCallSchema).optional(),
});

const ChatCompletionResponseSchema = z.object({
  choices: z
    .array(z.object({ message: ResponseMessageSchema, finish_reason: z.string().optional() }))
    .min(1),
  usage: z.object({ prompt_tokens: z.number(), completion_tokens: z.number() }).optional(),
});

/**
 * Parses an HTTP `Retry-After` header value, which is either a delay in
 * whole seconds (`"120"`) or an HTTP-date (`"Fri, 31 Jul 2026 12:00:00 GMT"`)
 * per RFC 9110 §10.2.3. Returns undefined for a missing or unparseable
 * header -- the caller falls back to its own exponential backoff.
 */
function parseRetryAfterMs(header: string | null): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const dateMs = Date.parse(header);
  if (!Number.isNaN(dateMs)) return Math.max(0, dateMs - Date.now());
  return undefined;
}

function mapFinishReason(reason: string | undefined): DirectorResponse["stopReason"] {
  switch (reason) {
    case "stop":
      return "end_turn";
    case "tool_calls":
      return "tool_use";
    case "length":
      return "max_tokens";
    default:
      return "other";
  }
}

/** Builds the OpenAI-shaped message list, with the system prompt as the first message. */
function toOpenAIMessages(system: string, messages: DirectorMessage[]): unknown[] {
  const out: unknown[] = [{ role: "system", content: system }];

  for (const msg of messages) {
    if (msg.role === "user") {
      out.push({ role: "user", content: msg.content });
    } else if (msg.role === "assistant") {
      const toolCalls: OpenAIToolCall[] = msg.toolCalls.map((tc) => ({
        id: tc.id,
        type: "function",
        function: { name: tc.name, arguments: JSON.stringify(tc.input ?? {}) },
      }));
      out.push({
        role: "assistant",
        content: msg.text ?? null,
        ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
      });
    } else {
      // tool_results -- OpenAI wants one "tool" message per result.
      for (const r of msg.results) {
        out.push({
          role: "tool",
          tool_call_id: r.id,
          content: r.isError ? `Error: ${r.content}` : r.content,
        });
      }
    }
  }

  return out;
}

export class OpenAICompatClient implements DirectorClient {
  private readonly fetchImpl: FetchLike;

  constructor(private readonly opts: OpenAICompatClientOptions) {
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  async createMessage(req: DirectorRequest): Promise<DirectorResponse> {
    const body = {
      model: this.opts.model,
      messages: toOpenAIMessages(req.system, req.messages),
      tools: req.tools.map((t) => ({
        type: "function",
        function: { name: t.name, description: t.description, parameters: t.inputSchema },
      })),
      max_tokens: req.maxTokens,
    };

    let res: Response;
    try {
      res = await this.fetchImpl(`${this.opts.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.opts.apiKey}`,
        },
        body: JSON.stringify(body),
      });
    } catch (err) {
      // Network-level failure (DNS, connection reset, timeout) -- transient.
      throw new RetryableDirectorError("openai-compat: network error calling chat/completions", {
        cause: err,
      });
    }

    if (!res.ok) {
      const bodyText = await res.text().catch(() => "");
      if (res.status === 429 || res.status >= 500) {
        const retryAfterMs =
          res.status === 429 ? parseRetryAfterMs(res.headers.get("retry-after")) : undefined;
        throw new RetryableDirectorError(
          `openai-compat: transient HTTP ${res.status} from chat/completions`,
          { retryAfterMs }
        );
      }
      throw new Error(`openai-compat: HTTP ${res.status} from chat/completions: ${bodyText}`);
    }

    let rawJson: unknown;
    try {
      rawJson = await res.json();
    } catch (err) {
      throw new Error(`openai-compat: response body was not valid JSON: ${String(err)}`);
    }

    const parsed = ChatCompletionResponseSchema.safeParse(rawJson);
    if (!parsed.success) {
      const issues = parsed.error.issues
        .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
        .join("; ");
      // Not retryable: retrying an unexpected response shape won't fix it, and the
      // caller (director.ts) treats any terminal error the same way -- stop and
      // return the script accumulated so far.
      throw new Error(`openai-compat: response did not match the expected shape: ${issues}`);
    }
    const json = parsed.data;
    const choice = json.choices[0];
    if (!choice) {
      throw new Error("openai-compat: response had no choices");
    }

    const toolCalls: ToolCall[] = (choice.message.tool_calls ?? []).map((tc) => {
      let input: unknown = {};
      try {
        input = JSON.parse(tc.function.arguments);
      } catch {
        // Small free-tier models frequently emit malformed JSON arguments.
        // Never crash: fall back to an empty object so schema validation
        // downstream rejects it and the model gets a self-correction path.
        input = {};
      }
      return { id: tc.id, name: tc.function.name, input };
    });

    return {
      toolCalls,
      text: choice.message.content ?? "",
      stopReason: mapFinishReason(choice.finish_reason),
      usage: json.usage
        ? { inputTokens: json.usage.prompt_tokens, outputTokens: json.usage.completion_tokens }
        : undefined,
    };
  }
}
