import { describe, expect, it, vi } from "vitest";
import { RateLimitError, APIConnectionError } from "@anthropic-ai/sdk";
import type { DirectorRequest } from "../client";
import { RetryableDirectorError } from "../client";
import { AnthropicClient } from "./anthropic";

const BASE_REQUEST: DirectorRequest = {
  system: "you are a teacher",
  messages: [
    { role: "user", content: "solve 2x=4" },
    {
      role: "assistant",
      text: "let me check",
      toolCalls: [{ id: "call_1", name: "write_math", input: { tex: "x=2", narration: "n" } }],
    },
    { role: "tool_results", results: [{ id: "call_1", content: "ok", isError: false }] },
  ],
  tools: [{ name: "write_math", description: "writes math", inputSchema: { type: "object" } }],
  maxTokens: 4096,
};

describe("AnthropicClient", () => {
  it("maps the request into Anthropic's shape (tools, tool_use, tool_result, adaptive thinking) (C1)", async () => {
    const create = vi.fn(async (_params: unknown) => ({
      content: [{ type: "text", text: "done" }],
      stop_reason: "end_turn",
      usage: { input_tokens: 10, output_tokens: 5 },
    }));

    const client = new AnthropicClient({
      apiKey: "sk-ant-secret",
      model: "claude-fable-5",
      client: { messages: { create: create as never } },
    });

    await client.createMessage(BASE_REQUEST);

    const params = create.mock.calls[0][0] as Record<string, unknown>;
    expect(params.model).toBe("claude-fable-5");
    expect(params.system).toBe("you are a teacher");
    expect(params.tools).toEqual([
      { name: "write_math", description: "writes math", input_schema: { type: "object" } },
    ]);

    const messages = params.messages as Array<Record<string, unknown>>;
    expect(messages).toHaveLength(3);
    expect(messages[0]).toEqual({ role: "user", content: "solve 2x=4" });
    expect(messages[1]).toEqual({
      role: "assistant",
      content: [
        { type: "text", text: "let me check" },
        { type: "tool_use", id: "call_1", name: "write_math", input: { tex: "x=2", narration: "n" } },
      ],
    });
    expect(messages[2]).toEqual({
      role: "user",
      content: [{ type: "tool_result", tool_use_id: "call_1", content: "ok", is_error: false }],
    });

    // Extended thinking defaults on, using the "adaptive" form -- the fixed
    // {type:"enabled", budget_tokens} form is deprecated and current Claude 5 models
    // reject it with HTTP 400. Effort is steered via output_config, not a token budget.
    expect(params.thinking).toEqual({ type: "adaptive" });
    expect(params.output_config).toEqual({ effort: "high" });
  });

  it("sends thinking:disabled and omits output_config when enableThinking is false (C1)", async () => {
    const create = vi.fn(async (_params: unknown) => ({
      content: [],
      stop_reason: "end_turn",
      usage: { input_tokens: 1, output_tokens: 1 },
    }));

    const disabled = new AnthropicClient({
      apiKey: "k",
      model: "claude-fable-5",
      enableThinking: false,
      client: { messages: { create: create as never } },
    });
    await disabled.createMessage(BASE_REQUEST);

    const params = create.mock.calls[0][0] as Record<string, unknown>;
    expect(params.thinking).toEqual({ type: "disabled" });
    expect(params.output_config).toBeUndefined();
  });

  it("adaptive thinking does not depend on maxTokens headroom -- unlike the old fixed-budget form (C1)", async () => {
    // The deprecated form needed >=1024 spare tokens for a thinking budget and silently
    // skipped thinking otherwise. Adaptive thinking has no such budget, so a small
    // maxTokens must not suppress it.
    const create = vi.fn(async (_params: unknown) => ({
      content: [],
      stop_reason: "end_turn",
      usage: { input_tokens: 1, output_tokens: 1 },
    }));
    const client = new AnthropicClient({
      apiKey: "k",
      model: "claude-fable-5",
      client: { messages: { create: create as never } },
    });

    await client.createMessage({ ...BASE_REQUEST, maxTokens: 64 });

    const params = create.mock.calls[0][0] as Record<string, unknown>;
    expect(params.thinking).toEqual({ type: "adaptive" });
    expect(params.output_config).toEqual({ effort: "high" });
  });

  it("honors a custom thinkingEffort", async () => {
    const create = vi.fn(async (_params: unknown) => ({
      content: [],
      stop_reason: "end_turn",
      usage: { input_tokens: 1, output_tokens: 1 },
    }));
    const client = new AnthropicClient({
      apiKey: "k",
      model: "claude-fable-5",
      thinkingEffort: "low",
      client: { messages: { create: create as never } },
    });

    await client.createMessage(BASE_REQUEST);

    expect((create.mock.calls[0][0] as Record<string, unknown>).output_config).toEqual({
      effort: "low",
    });
  });

  it("captures thinking blocks verbatim into providerBlocks, and replays them first on the next turn (C2)", async () => {
    const thinkingBlock = { type: "thinking", thinking: "let me work this out...", signature: "sig-abc" };
    const create = vi.fn(async (_params: unknown) => ({
      content: [
        thinkingBlock,
        { type: "text", text: "here's the plan" },
        { type: "tool_use", id: "call_9", name: "write_math", input: { tex: "x=2", narration: "n" } },
      ],
      stop_reason: "tool_use",
      usage: { input_tokens: 5, output_tokens: 3 },
    }));
    const client = new AnthropicClient({
      apiKey: "k",
      model: "claude-fable-5",
      client: { messages: { create: create as never } },
    });

    const response = await client.createMessage(BASE_REQUEST);

    // Captured verbatim -- the exact block object, unmodified, not folded into `text`.
    expect(response.providerBlocks).toEqual([thinkingBlock]);
    expect(response.text).toBe("here's the plan");

    // Now feed that response's providerBlocks back in, the way director.ts's loop does
    // (carried on the assistant DirectorMessage), and confirm it's replayed first --
    // ahead of text and tool_use -- in the very next request.
    create.mockClear();
    await client.createMessage({
      ...BASE_REQUEST,
      messages: [
        { role: "user", content: "solve 2x=4" },
        {
          role: "assistant",
          text: "here's the plan",
          toolCalls: [{ id: "call_9", name: "write_math", input: { tex: "x=2", narration: "n" } }],
          providerBlocks: response.providerBlocks,
        },
        { role: "tool_results", results: [{ id: "call_9", content: "ok", isError: false }] },
      ],
    });

    const params = create.mock.calls[0][0] as Record<string, unknown>;
    const messages = params.messages as Array<Record<string, unknown>>;
    expect(messages[1]).toEqual({
      role: "assistant",
      content: [
        thinkingBlock, // first, verbatim
        { type: "text", text: "here's the plan" },
        { type: "tool_use", id: "call_9", name: "write_math", input: { tex: "x=2", narration: "n" } },
      ],
    });
  });

  it("maps tool_use content blocks and stop_reason back into the director shape", async () => {
    const create = vi.fn(async () => ({
      content: [
        { type: "text", text: "working on it" },
        { type: "tool_use", id: "t1", name: "write_math", input: { tex: "x=2", narration: "n" } },
      ],
      stop_reason: "tool_use",
      usage: { input_tokens: 20, output_tokens: 8 },
    }));

    const client = new AnthropicClient({
      apiKey: "k",
      model: "claude-fable-5",
      client: { messages: { create: create as never } },
    });

    const response = await client.createMessage(BASE_REQUEST);

    expect(response.text).toBe("working on it");
    expect(response.toolCalls).toEqual([{ id: "t1", name: "write_math", input: { tex: "x=2", narration: "n" } }]);
    expect(response.stopReason).toBe("tool_use");
    expect(response.usage).toEqual({ inputTokens: 20, outputTokens: 8 });
  });

  it("wraps RateLimitError and APIConnectionError as RetryableDirectorError", async () => {
    const rateLimited = new AnthropicClient({
      apiKey: "k",
      model: "claude-fable-5",
      client: {
        messages: {
          create: vi.fn(async () => {
            throw new RateLimitError(429, undefined, "rate limited", new Headers());
          }) as never,
        },
      },
    });
    await expect(rateLimited.createMessage(BASE_REQUEST)).rejects.toBeInstanceOf(RetryableDirectorError);

    const connectionFailed = new AnthropicClient({
      apiKey: "k",
      model: "claude-fable-5",
      client: {
        messages: {
          create: vi.fn(async () => {
            throw new APIConnectionError({ message: "connection reset" });
          }) as never,
        },
      },
    });
    await expect(connectionFailed.createMessage(BASE_REQUEST)).rejects.toBeInstanceOf(
      RetryableDirectorError
    );
  });

  it("does not wrap unrelated errors as retryable", async () => {
    const client = new AnthropicClient({
      apiKey: "k",
      model: "claude-fable-5",
      client: {
        messages: {
          create: vi.fn(async () => {
            throw new Error("boom");
          }) as never,
        },
      },
    });
    let threw: unknown;
    try {
      await client.createMessage(BASE_REQUEST);
    } catch (err) {
      threw = err;
    }
    expect(threw).not.toBeInstanceOf(RetryableDirectorError);
  });
});
