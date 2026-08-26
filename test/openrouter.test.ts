import { describe, expect, it, vi } from "vitest";
import { ProviderError } from "../src/core/errors.js";
import { OpenRouterAdapter } from "../src/providers/openrouter.js";

describe("OpenRouterAdapter", () => {
  it("forwards the OpenRouter-native request shape and strips pool routing metadata", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          id: "gen-1",
          object: "chat.completion",
          created: 1_777_000_000,
          model: "some/free-model",
          choices: [
            {
              index: 0,
              message: { role: "assistant", content: "hello" },
              finish_reason: "stop",
            },
          ],
          usage: {
            prompt_tokens: 4,
            completion_tokens: 2,
            total_tokens: 6,
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    const adapter = new OpenRouterAdapter({
      apiKey: "test-key",
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    const response = await adapter.chat({
      provider: "openrouter",
      model: "openrouter/free",
      messages: [{ role: "user", content: "hello" }],
      max_tokens: 128,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "answer",
          schema: {
            type: "object",
            properties: { answer: { type: "string" } },
            required: ["answer"],
          },
        },
      },
      reasoning: { effort: "high", exclude: false },
    });

    expect(fetchMock).toHaveBeenCalledOnce();

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(init?.method).toBe("POST");
    expect(init?.headers).toMatchObject({
      Authorization: "Bearer test-key",
      "Content-Type": "application/json",
    });

    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    expect(body.provider).toBeUndefined();
    expect(body.model).toBe("openrouter/free");
    expect(body.max_tokens).toBe(128);
    expect(body.stream).toBe(false);
    expect(body.response_format).toEqual({
      type: "json_schema",
      json_schema: {
        name: "answer",
        schema: {
          type: "object",
          properties: { answer: { type: "string" } },
          required: ["answer"],
        },
      },
    });
    expect(body.reasoning).toEqual({ effort: "high", exclude: false });

    expect(response.provider).toBe("openrouter");
    expect(response.model).toBe("some/free-model");
    expect(response.usage?.total_tokens).toBe(6);
  });

  it("normalizes OpenRouter errors while preserving the upstream status", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          error: {
            message: "Rate limit exceeded",
            code: 429,
          },
        }),
        { status: 429, headers: { "content-type": "application/json" } },
      ),
    );

    const adapter = new OpenRouterAdapter({
      apiKey: "test-key",
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    const error = await adapter
      .chat({
        provider: "openrouter",
        model: "openrouter/free",
        messages: [{ role: "user", content: "hello" }],
      })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ProviderError);
    expect(error).toMatchObject({
      provider: "openrouter",
      message: "Rate limit exceeded",
      statusCode: 429,
      upstreamStatus: 429,
    });
  });
});
