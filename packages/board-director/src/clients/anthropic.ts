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
  /**
   * Enable Claude's extended thinking. Uses the "adaptive" form (the model
   * decides how much to think, steered by `output_config.effort`) rather
   * than the deprecated fixed `budget_tokens` form, which current Claude 5
   * models reject with HTTP 400. Default true.
   */
  enableThinking?: boolean;
  /** Effort level passed via `output_config` when thinking is enabled. Default "high". */
  thinkingEffort?: "low" | "medium" | "high" | "xhigh" | "max";
  /** Injectable underlying client -- for tests. Never call a real endpoint from a test. */
  client?: { messages: AnthropicMessagesLike };
}

const DEFAULT_THINKING_EFFORT: NonNullable<AnthropicClientOptions["thinkingEffort"]> = "high";

/** Builds the request's `thinking` param as a typed SDK value, so the compiler checks the wire shape. */
function buildThinkingConfig(enableThinking: boolean): Anthropic.ThinkingConfigParam {
  return enableThinking ? { type: "adaptive" } : { type: "disabled" };
}

function toAnthropicMessages(messages: DirectorMessage[]): Anthropic.MessageParam[] {
  const out: Anthropic.MessageParam[] = [];

  for (const msg of messages) {
    if (msg.role === "user") {
      out.push({ role: "user", content: msg.content });
    } else if (msg.role === "assistant") {
      const blocks: Anthropic.ContentBlockParam[] = [];
      // Thinking blocks (captured verbatim from the response that produced this turn)
      // must come first and be replayed unchanged -- they carry a signature required
      // for multi-turn continuity. The loop never inspects this field; it only carries
      // it, so this is the one place that interprets it.
      if (msg.providerBlocks) {
        blocks.push(...(msg.providerBlocks as Anthropic.ContentBlockParam[]));
      }
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
    const thinking = buildThinkingConfig(enableThinking);
    const outputConfig: Anthropic.OutputConfig | undefined = enableThinking
      ? { effort: this.opts.thinkingEffort ?? DEFAULT_THINKING_EFFORT }
      : undefined;

    const params: Anthropic.MessageCreateParamsNonStreaming = {
      model: this.opts.model,
      system: req.system,
      messages: toAnthropicMessages(req.messages),
      tools,
      max_tokens: req.maxTokens,
      thinking,
      ...(outputConfig ? { output_config: outputConfig } : {}),
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
    const providerBlocks: unknown[] = [];
    let text = "";
    for (const block of response.content) {
      if (block.type === "text") {
        text += block.text;
      } else if (block.type === "tool_use") {
        toolCalls.push({ id: block.id, name: block.name, input: block.input });
      } else if (block.type === "thinking" || block.type === "redacted_thinking") {
        // Captured verbatim -- these carry a signature required for multi-turn
        // continuity. The loop never inspects this; `toAnthropicMessages` replays it
        // unchanged, first, the next time this turn is sent back as history.
        providerBlocks.push(block);
      }
    }

    return {
      toolCalls,
      text,
      stopReason: mapStopReason(response.stop_reason),
      usage: response.usage
        ? { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens }
        : undefined,
      providerBlocks: providerBlocks.length > 0 ? providerBlocks : undefined,
    };
  }
}
