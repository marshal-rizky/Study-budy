import { describe, expect, it, vi } from "vitest";
import { BoardStepSchema } from "@teacher/protocol";
import type { DirectorRequest } from "../client";
import { RetryableDirectorError } from "../client";
import { OpenAICompatClient } from "./openai-compat";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const BASE_REQUEST: DirectorRequest = {
  system: "you are a teacher",
  messages: [{ role: "user", content: "solve 2x=4" }],
  tools: [{ name: "write_math", description: "d", inputSchema: { type: "object" } }],
  maxTokens: 1000,
};

describe("OpenAICompatClient", () => {
  it("parses an OpenAI-shaped tool call response", async () => {
    const fetchImpl = vi.fn(async (_url: unknown, _init: unknown) =>
      jsonResponse({
        choices: [
          {
            finish_reason: "tool_calls",
            message: {
              role: "assistant",
              content: null,
              tool_calls: [
                {
                  id: "call_1",
                  type: "function",
                  function: { name: "write_math", arguments: '{"tex":"x=2","narration":"solved"}' },
                },
              ],
            },
          },
        ],
        usage: { prompt_tokens: 12, completion_tokens: 34 },
      })
    );

    const client = new OpenAICompatClient({
      apiKey: "test-key",
      model: "llama-3.3-70b-versatile",
      baseUrl: "https://api.groq.com/openai/v1",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const response = await client.createMessage(BASE_REQUEST);

    expect(response.stopReason).toBe("tool_use");
    expect(response.toolCalls).toEqual([{ id: "call_1", name: "write_math", input: { tex: "x=2", narration: "solved" } }]);
    expect(response.usage).toEqual({ inputTokens: 12, outputTokens: 34 });

    // Never sends the key anywhere but the Authorization header.
    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer test-key");
    expect(String(init.body)).not.toContain("test-key");
  });

  it("does not crash on malformed function.arguments JSON -- it becomes a self-correcting invalid input", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        choices: [
          {
            finish_reason: "tool_calls",
            message: {
              role: "assistant",
              content: null,
              tool_calls: [
                {
                  id: "call_2",
                  type: "function",
                  function: { name: "write_math", arguments: "{not valid json" },
                },
              ],
            },
          },
        ],
      })
    );

    const client = new OpenAICompatClient({
      apiKey: "test-key",
      model: "some-small-model",
      baseUrl: "http://localhost:11434/v1",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const response = await client.createMessage(BASE_REQUEST);

    expect(response.toolCalls).toHaveLength(1);
    expect(response.toolCalls[0].name).toBe("write_math");

    // The self-correction path: reconstructing the board step from this input must fail
    // protocol validation (rather than the client throwing outright).
    const candidate = { kind: "math", ...(response.toolCalls[0].input as object) };
    const parsed = BoardStepSchema.safeParse(candidate);
    expect(parsed.success).toBe(false);
  });

  it("maps stop/length finish_reason to end_turn/max_tokens", async () => {
    const stopFetch = vi.fn(async () =>
      jsonResponse({ choices: [{ finish_reason: "stop", message: { role: "assistant", content: "hi" } }] })
    );
    const client = new OpenAICompatClient({
      apiKey: "k",
      model: "m",
      baseUrl: "https://example.com/v1",
      fetchImpl: stopFetch as unknown as typeof fetch,
    });
    const r1 = await client.createMessage(BASE_REQUEST);
    expect(r1.stopReason).toBe("end_turn");
    expect(r1.text).toBe("hi");

    const lengthFetch = vi.fn(async () =>
      jsonResponse({ choices: [{ finish_reason: "length", message: { role: "assistant", content: "" } }] })
    );
    const client2 = new OpenAICompatClient({
      apiKey: "k",
      model: "m",
      baseUrl: "https://example.com/v1",
      fetchImpl: lengthFetch as unknown as typeof fetch,
    });
    const r2 = await client2.createMessage(BASE_REQUEST);
    expect(r2.stopReason).toBe("max_tokens");
  });

  it("wraps a network-level fetch failure as RetryableDirectorError", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("network error");
    });
    const client = new OpenAICompatClient({
      apiKey: "k",
      model: "m",
      baseUrl: "https://example.com/v1",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await expect(client.createMessage(BASE_REQUEST)).rejects.toBeInstanceOf(RetryableDirectorError);
  });

  it("wraps a 429 response as RetryableDirectorError and a 400 response as a plain error", async () => {
    const rateLimited = vi.fn(async () => jsonResponse({ error: "rate limited" }, 429));
    const client = new OpenAICompatClient({
      apiKey: "k",
      model: "m",
      baseUrl: "https://example.com/v1",
      fetchImpl: rateLimited as unknown as typeof fetch,
    });
    await expect(client.createMessage(BASE_REQUEST)).rejects.toBeInstanceOf(RetryableDirectorError);

    const badRequest = vi.fn(async () => jsonResponse({ error: "bad request" }, 400));
    const client2 = new OpenAICompatClient({
      apiKey: "k",
      model: "m",
      baseUrl: "https://example.com/v1",
      fetchImpl: badRequest as unknown as typeof fetch,
    });
    let threw: unknown;
    try {
      await client2.createMessage(BASE_REQUEST);
    } catch (err) {
      threw = err;
    }
    expect(threw).not.toBeInstanceOf(RetryableDirectorError);
    expect(threw).toBeInstanceOf(Error);
  });
});
