/**
 * Provider-neutral request/response shape. `director.ts`'s agentic loop only
 * ever sees these types -- every provider adapter (Anthropic, OpenAI-compat,
 * fake) translates to/from its own wire format at the edge, so the loop
 * itself never branches on which provider is in use.
 */

export interface ToolDef {
  name: string;
  description: string;
  inputSchema: object;
}

export interface ToolCall {
  id: string;
  name: string;
  input: unknown;
}

export interface DirectorRequest {
  system: string;
  messages: DirectorMessage[];
  tools: ToolDef[];
  maxTokens: number;
}

export type DirectorMessage =
  | { role: "user"; content: string }
  | { role: "assistant"; toolCalls: ToolCall[]; text?: string; providerBlocks?: unknown[] }
  | { role: "tool_results"; results: { id: string; content: string; isError: boolean }[] };

export interface DirectorResponse {
  toolCalls: ToolCall[];
  text: string;
  stopReason: "end_turn" | "tool_use" | "max_tokens" | "other";
  usage?: { inputTokens: number; outputTokens: number };
  /**
   * Provider-specific content the loop must carry but never interpret --
   * currently Anthropic's extended-thinking blocks, which hold a signature
   * required for multi-turn continuity and must be replayed verbatim, first,
   * ahead of text/tool_use blocks, in the next request's assistant turn.
   * Adapters that have nothing like this leave it undefined.
   */
  providerBlocks?: unknown[];
}

export interface DirectorClient {
  createMessage(req: DirectorRequest): Promise<DirectorResponse>;
}

/**
 * Thrown by a `DirectorClient` implementation for a transient condition
 * (rate limit, connection reset, 5xx) that is worth retrying with backoff.
 * Anything else propagates immediately -- the director loop only retries
 * errors of this type.
 */
export class RetryableDirectorError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "RetryableDirectorError";
  }
}
