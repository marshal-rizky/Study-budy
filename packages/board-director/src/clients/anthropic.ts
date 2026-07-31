import Anthropic, { APIConnectionError, RateLimitError } from "@anthropic-ai/sdk";
import { RetryableDirectorError } from "../client";
import type { DirectorClient, DirectorMessage, DirectorRequest, DirectorResponse, ToolCall } from "../client";

/**
 * Wraps `@anthropic-ai/sdk`'s `messages.create`, translating to/from our
 * provider-neutral shape. Assistant tool calls become `tool_use` content
 * blocks; tool results become `tool_result` blocks with `is_error`; tools
 * are sent with `input_schema` (Anthropic's name for the JSON Schema).
 */

/** Just the surface of `Anthropic.Messages` this client uses -- lets tests inject a fake. */
export interface AnthropicMessagesLike {
  create(params: Anthropic.MessageCreateParamsNonStreaming): Promise<Anthropic.Message>;
}

export interface AnthropicClientOptions {
  apiKey: string;
  model: string;
  /** Enable Claude's extended thinking when there's token budget for it. Default true. */
  enableThinking?: boolean;
  /** Token budget reserved for thinking; must be >=1024 and < maxTokens to take effect. Default 1024. */
  thinkingBudgetTokens?: number;
  /** Injectable underlying client -- for tests. Never call a real endpoint from a test. */
  client?: { messages: AnthropicMessagesLike };
}

const MIN_THINKING_BUDGET_TOKENS = 1024;
const DEFAULT_THINKING_BUDGET_TOKENS = 1024;

function toAnthropicMessages(messages: DirectorMessage[]): Anthropic.MessageParam[] {
  const out: Anthropic.MessageParam[] = [];

  for (const msg of messages) {
    if (msg.role === "user") {
      out.push({ role: "user", content: msg.content });
    } else if (msg.role === "assistant") {
      const blocks: Anthropic.ContentBlockParam[] = [];
      if (msg.text) blocks.push({ type: "text", text: msg.text });
      for (const call of msg.toolCalls) {
        blocks.push({ type: "tool_use", id: call.id, name: call.name, input: call.input });
      }
      out.push({ role: "assistant", content: blocks });
    } else {
      // tool_results -- Anthropic wants these as tool_result blocks in a user message.
      const blocks: Anthropic.ToolResultBlockParam[] = msg.results.map((r) => ({
        type: "tool_result",
        tool_use_id: r.id,
        content: r.content,
        is_error: r.isError,
      }));
      out.push({ role: "user", content: blocks });
    }
  }

  return out;
}

function mapStopReason(reason: Anthropic.StopReason | null): DirectorResponse["stopReason"] {
  switch (reason) {
    case "end_turn":
      return "end_turn";
    case "tool_use":
      return "tool_use";
    case "max_tokens":
      return "max_tokens";
    default:
      return "other";
  }
}

export class AnthropicClient implements DirectorClient {
  private readonly sdk: { messages: AnthropicMessagesLike };

  constructor(private readonly opts: AnthropicClientOptions) {
    this.sdk = opts.client ?? new Anthropic({ apiKey: opts.apiKey });
  }

  async createMessage(req: DirectorRequest): Promise<DirectorResponse> {
    const tools: Anthropic.Tool[] = req.tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.inputSchema as Anthropic.Tool["input_schema"],
    }));

    const enableThinking = this.opts.enableThinking ?? true;
    const thinkingBudget = this.opts.thinkingBudgetTokens ?? DEFAULT_THINKING_BUDGET_TOKENS;
    // Extended thinking needs budget_tokens >= 1024 and strictly < max_tokens. When the
    // per-call token budget can't fit both, skip thinking instead of sending an invalid
    // request -- the practical meaning of "when the model supports it" here.
    const canThink =
      enableThinking && thinkingBudget >= MIN_THINKING_BUDGET_TOKENS && req.maxTokens > thinkingBudget;

    const params: Anthropic.MessageCreateParamsNonStreaming = {
      model: this.opts.model,
      system: req.system,
      messages: toAnthropicMessages(req.messages),
      tools,
      max_tokens: req.maxTokens,
      ...(canThink ? { thinking: { type: "enabled", budget_tokens: thinkingBudget } } : {}),
    };

    let response: Anthropic.Message;
    try {
      response = await this.sdk.messages.create(params);
    } catch (err) {
      if (err instanceof RateLimitError || err instanceof APIConnectionError) {
        throw new RetryableDirectorError("anthropic: transient error calling messages.create", {
          cause: err,
        });
      }
      throw err;
    }

    const toolCalls: ToolCall[] = [];
    let text = "";
    for (const block of response.content) {
      if (block.type === "text") {
        text += block.text;
      } else if (block.type === "tool_use") {
        toolCalls.push({ id: block.id, name: block.name, input: block.input });
      }
      // thinking / redacted_thinking blocks are intentionally not surfaced --
      // the director loop only ever sees the provider-neutral shape.
    }

    return {
      toolCalls,
      text,
      stopReason: mapStopReason(response.stop_reason),
      usage: response.usage
        ? { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens }
        : undefined,
    };
  }
}
