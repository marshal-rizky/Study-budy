import { describe, expect, it } from "vitest";
import { AnthropicClient } from "./anthropic";
import { OpenAICompatClient } from "./openai-compat";
import { FakeClient } from "./fake";
import { createClientFromEnv } from "./from-env";

describe("createClientFromEnv", () => {
  it("returns a FakeClient for TEACHER_PROVIDER=fake, no key required", () => {
    const client = createClientFromEnv({ TEACHER_PROVIDER: "fake" });
    expect(client).toBeInstanceOf(FakeClient);
  });

  it("returns an AnthropicClient, falling back to ANTHROPIC_API_KEY when TEACHER_API_KEY is unset", () => {
    const client = createClientFromEnv({
      TEACHER_PROVIDER: "anthropic",
      TEACHER_MODEL: "claude-fable-5",
      ANTHROPIC_API_KEY: "sk-ant-fallback-secret",
    });
    expect(client).toBeInstanceOf(AnthropicClient);
  });

  it("returns an AnthropicClient using TEACHER_API_KEY when given directly", () => {
    const client = createClientFromEnv({
      TEACHER_PROVIDER: "anthropic",
      TEACHER_MODEL: "claude-fable-5",
      TEACHER_API_KEY: "sk-ant-explicit-secret",
    });
    expect(client).toBeInstanceOf(AnthropicClient);
  });

  it("throws naming ANTHROPIC_API_KEY when no key is available at all", () => {
    expect(() =>
      createClientFromEnv({ TEACHER_PROVIDER: "anthropic", TEACHER_MODEL: "claude-fable-5" })
    ).toThrow(/ANTHROPIC_API_KEY/);
  });

  it("throws naming TEACHER_MODEL, and never leaks a key value present in the env, when the model is missing", () => {
    const secret = "sk-ant-should-never-appear-in-any-error-string";
    let message = "";
    try {
      createClientFromEnv({ TEACHER_PROVIDER: "anthropic", ANTHROPIC_API_KEY: secret });
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toMatch(/TEACHER_MODEL/);
    expect(message).not.toContain(secret);
  });

  it("returns an OpenAICompatClient for a known provider shorthand base URL, using its fallback key", () => {
    const client = createClientFromEnv({
      TEACHER_PROVIDER: "openai-compat",
      TEACHER_MODEL: "llama-3.3-70b-versatile",
      TEACHER_BASE_URL: "groq",
      GROQ_API_KEY: "gsk-fallback-secret",
    });
    expect(client).toBeInstanceOf(OpenAICompatClient);
  });

  it("returns an OpenAICompatClient for a literal base URL with an explicit TEACHER_API_KEY", () => {
    const client = createClientFromEnv({
      TEACHER_PROVIDER: "openai-compat",
      TEACHER_MODEL: "some-model",
      TEACHER_BASE_URL: "https://example.com/v1",
      TEACHER_API_KEY: "explicit-secret",
    });
    expect(client).toBeInstanceOf(OpenAICompatClient);
  });

  it("throws naming TEACHER_API_KEY for a literal base URL with no fallback and no key, without leaking any key", () => {
    let message = "";
    try {
      createClientFromEnv({
        TEACHER_PROVIDER: "openai-compat",
        TEACHER_MODEL: "some-model",
        TEACHER_BASE_URL: "https://example.com/v1",
        GROQ_API_KEY: "unrelated-secret-should-not-leak",
      });
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toMatch(/TEACHER_API_KEY/);
    expect(message).not.toContain("unrelated-secret-should-not-leak");
  });

  it("throws naming GROQ_API_KEY when using the groq shorthand with no key anywhere", () => {
    expect(() =>
      createClientFromEnv({
        TEACHER_PROVIDER: "openai-compat",
        TEACHER_MODEL: "llama-3.3-70b-versatile",
        TEACHER_BASE_URL: "groq",
      })
    ).toThrow(/GROQ_API_KEY/);
  });

  it("throws naming TEACHER_BASE_URL when using openai-compat without one", () => {
    expect(() =>
      createClientFromEnv({
        TEACHER_PROVIDER: "openai-compat",
        TEACHER_MODEL: "some-model",
        GROQ_API_KEY: "irrelevant",
      })
    ).toThrow(/TEACHER_BASE_URL/);
  });

  it("throws naming TEACHER_PROVIDER when it is unset", () => {
    expect(() => createClientFromEnv({})).toThrow(/TEACHER_PROVIDER/);
  });

  it("throws naming the unknown value when TEACHER_PROVIDER is not recognized", () => {
    expect(() => createClientFromEnv({ TEACHER_PROVIDER: "not-a-real-provider" })).toThrow(
      /not-a-real-provider/
    );
  });
});
