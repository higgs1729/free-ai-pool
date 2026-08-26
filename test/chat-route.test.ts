import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { ProviderRegistry } from "../src/core/registry.js";
import { OpenRouterAdapter } from "../src/providers/openrouter.js";

let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe("POST /v1/chat/completions", () => {
  it("passes openrouter/free through the OpenRouter adapter", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          id: "gen-route-1",
          object: "chat.completion",
          created: 1_777_000_001,
          model: "resolved/free-model",
          choices: [
            {
              index: 0,
              message: { role: "assistant", content: "pong" },
              finish_reason: "stop",
            },
          ],
          usage: {
            prompt_tokens: 2,
            completion_tokens: 1,
            total_tokens: 3,
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    const registry = new ProviderRegistry();
    registry.register(
      new OpenRouterAdapter({
        apiKey: "test-key",
        fetchImpl: fetchMock as unknown as typeof fetch,
      }),
    );

    app = buildApp(loadConfig({ LOG_LEVEL: "silent" }), registry);

    const response = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      payload: {
        provider: "openrouter",
        model: "openrouter/free",
        messages: [{ role: "user", content: "ping" }],
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      id: "gen-route-1",
      provider: "openrouter",
      model: "resolved/free-model",
      choices: [
        {
          message: { role: "assistant", content: "pong" },
          finish_reason: "stop",
        },
      ],
    });
  });

  it("reports OpenRouter as unconfigured when its key is absent", async () => {
    app = buildApp(loadConfig({ LOG_LEVEL: "silent" }));

    const response = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      payload: {
        provider: "openrouter",
        model: "openrouter/free",
        messages: [{ role: "user", content: "ping" }],
      },
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({
      error: {
        code: "provider_not_configured",
      },
    });
  });

  it("rejects streaming until the SSE slice is implemented", async () => {
    app = buildApp(loadConfig({ LOG_LEVEL: "silent" }));

    const response = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      payload: {
        provider: "openrouter",
        model: "openrouter/free",
        messages: [{ role: "user", content: "ping" }],
        stream: true,
      },
    });

    expect(response.statusCode).toBe(501);
    expect(response.json()).toMatchObject({
      error: {
        code: "streaming_not_implemented",
      },
    });
  });
});
