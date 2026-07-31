import { AnthropicClient } from "./anthropic";
import { OpenAICompatClient } from "./openai-compat";
import { FakeClient } from "./fake";
import type { DirectorClient, DirectorResponse } from "../client";

export type EnvLike = Record<string, string | undefined>;

/** Convenience base URLs for the free-tier OpenAI-compatible providers named in the plan. */
export const KNOWN_BASE_URLS: Record<string, string> = {
  groq: "https://api.groq.com/openai/v1",
  cerebras: "https://api.cerebras.ai/v1",
  openrouter: "https://openrouter.ai/api/v1",
  ollama: "http://localhost:11434/v1",
};

/** Provider-appropriate fallback key env var, used when TEACHER_API_KEY is unset. */
const PROVIDER_KEY_ENV: Record<string, string> = {
  groq: "GROQ_API_KEY",
  cerebras: "CEREBRAS_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
  ollama: "OLLAMA_API_KEY_1",
};

function requireEnv(env: EnvLike, name: string): string {
  const value = env[name];
  if (value === undefined || value.length === 0) {
    // NEVER interpolate a key value into an error message -- only the variable NAME.
    throw new Error(
      `board-director: missing required environment variable "${name}". Set it (see .env.example) ` +
        `before using this TEACHER_PROVIDER.`
    );
  }
  return value;
}

/** Resolves TEACHER_BASE_URL: either a known provider shorthand ("groq") or a literal URL. */
function resolveBaseUrl(raw: string): { baseUrl: string; knownProvider: string | null } {
  const trimmed = raw.trim();
  const lower = trimmed.toLowerCase();
  if (Object.hasOwn(KNOWN_BASE_URLS, lower)) {
    return { baseUrl: KNOWN_BASE_URLS[lower], knownProvider: lower };
  }
  for (const [name, url] of Object.entries(KNOWN_BASE_URLS)) {
    if (trimmed === url) return { baseUrl: url, knownProvider: name };
  }
  return { baseUrl: trimmed, knownProvider: null };
}

function resolveApiKey(env: EnvLike, fallbackEnvVar: string | null): string {
  const explicit = env.TEACHER_API_KEY;
  if (explicit !== undefined && explicit.length > 0) return explicit;
  if (fallbackEnvVar) return requireEnv(env, fallbackEnvVar);
  throw new Error(
    'board-director: missing required environment variable "TEACHER_API_KEY" (no provider-specific ' +
      "fallback key applies to this TEACHER_BASE_URL -- set TEACHER_API_KEY explicitly)."
  );
}

const DEFAULT_FAKE_RESPONSE: DirectorResponse = {
  toolCalls: [],
  text: "TEACHER_PROVIDER=fake and no scripted response was configured; ending the turn immediately.",
  stopReason: "end_turn",
};

/**
 * Builds a `DirectorClient` from environment variables (see `.env.example`).
 * One key per provider, by design (see the plan's rationale): this never
 * rotates across multiple keys for the same provider.
 *
 * Throws a clear, actionable error naming the missing variable when config
 * is incomplete. NEVER logs, echoes, or otherwise includes a key value in
 * any error message or thrown string.
 */
export function createClientFromEnv(env: EnvLike = process.env): DirectorClient {
  const provider = env.TEACHER_PROVIDER;
  if (!provider) {
    throw new Error(
      'board-director: missing required environment variable "TEACHER_PROVIDER" ' +
        "(expected anthropic | openai-compat | fake)."
    );
  }

  switch (provider) {
    case "fake":
      return new FakeClient([DEFAULT_FAKE_RESPONSE]);

    case "anthropic": {
      const model = requireEnv(env, "TEACHER_MODEL");
      const apiKey = resolveApiKey(env, "ANTHROPIC_API_KEY");
      return new AnthropicClient({ apiKey, model });
    }

    case "openai-compat": {
      const model = requireEnv(env, "TEACHER_MODEL");
      const rawBaseUrl = requireEnv(env, "TEACHER_BASE_URL");
      const { baseUrl, knownProvider } = resolveBaseUrl(rawBaseUrl);
      const fallbackEnvVar = knownProvider ? PROVIDER_KEY_ENV[knownProvider] : null;
      const apiKey = resolveApiKey(env, fallbackEnvVar);
      return new OpenAICompatClient({ apiKey, model, baseUrl });
    }

    default:
      throw new Error(
        `board-director: unknown TEACHER_PROVIDER "${provider}" (expected anthropic | openai-compat | fake).`
      );
  }
}
