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

describe("Free AI Pool provider routing", () => {
  it("uses X-Free-AI-Pool-Provider while preserving OpenRouter's native provider object", async () => {
    const fetchMock = vi.fn(
      async (
        _input: Parameters<typeof fetch>[0],
        _init?: Parameters<typeof fetch>[1],
      ) =>
        new Response(
          JSON.stringify({
            id: "gen-provider-routing",
            object: "chat.completion",
            created: 1_777_000_020,
            model: "resolved/free-model",
            choices: [
              {
                index: 0,
                message: { role: "assistant", content: "ok" },
                finish_reason: "stop",
              },
            ],
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
      headers: {
        "x-free-ai-pool-provider": "openrouter",
      },
      payload: {
        model: "openrouter/free",
        messages: [{ role: "user", content: "ping" }],
        provider: {
          allow_fallbacks: false,
        },
      },
    });

    expect(response.statusCode).toBe(200);
    const [, init] = fetchMock.mock.calls[0] ?? [];
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    expect(body.provider).toEqual({ allow_fallbacks: false });
  });

  it("keeps the legacy string body provider working", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          id: "gen-legacy-routing",
          object: "chat.completion",
          created: 1_777_000_021,
          model: "resolved/free-model",
          choices: [
            {
              index: 0,
              message: { role: "assistant", content: "ok" },
              finish_reason: "stop",
            },
          ],
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
    const [, init] = fetchMock.mock.calls[0] ?? [];
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    expect(body.provider).toBeUndefined();
  });

  it("rejects conflicting provider header and legacy body routing", async () => {
    app = buildApp(loadConfig({ LOG_LEVEL: "silent" }));

    const response = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: {
        "x-free-ai-pool-provider": "gemini",
      },
      payload: {
        provider: "openrouter",
        model: "openrouter/free",
        messages: [{ role: "user", content: "ping" }],
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error: { code: "provider_conflict" },
    });
  });
});
