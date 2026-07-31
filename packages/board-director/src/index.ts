export type {
  ToolDef,
  ToolCall,
  DirectorRequest,
  DirectorMessage,
  DirectorResponse,
  DirectorClient,
} from "./client";
export { RetryableDirectorError } from "./client";

export { TOOLS, TOOL_TO_STEP_KIND } from "./tools";

export type { SolveOptions, DirectorUsage, SolveResult, SolveStopReason } from "./director";
export { solveProblem, solveProblemDetailed } from "./director";

export { AnthropicClient } from "./clients/anthropic";
export type { AnthropicClientOptions, AnthropicMessagesLike } from "./clients/anthropic";

export { OpenAICompatClient } from "./clients/openai-compat";
export type { OpenAICompatClientOptions } from "./clients/openai-compat";

export { FakeClient } from "./clients/fake";

export { createClientFromEnv, KNOWN_BASE_URLS } from "./clients/from-env";
export type { EnvLike } from "./clients/from-env";
