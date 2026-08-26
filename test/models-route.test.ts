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

describe("GET /v1/models", () => {
  it("defaults to OpenRouter and preserves its model metadata", async () => {
    const fetchMock = vi.fn(
      async (
        _input: Parameters<typeof fetch>[0],
        _init?: Parameters<typeof fetch>[1],
      ) =>
        new Response(
          JSON.stringify({
            data: [
              {
                id: "example/model:free",
                canonical_slug: "example/model",
                name: "Example Model Free",
                created: 1_777_000_003,
                context_length: 131072,
                pricing: { prompt: "0", completion: "0" },
                architecture: {
                  input_modalities: ["text"],
                  output_modalities: ["text"],
                },
                supported_parameters: ["tools", "response_format"],
                expiration_date: null,
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
      method: "GET",
      url: "/v1/models?supported_parameters=tools&sort=intelligence-high-to-low",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      data: [
        {
          id: "example/model:free",
          canonical_slug: "example/model",
          name: "Example Model Free",
          created: 1_777_000_003,
          context_length: 131072,
          pricing: { prompt: "0", completion: "0" },
          architecture: {
            input_modalities: ["text"],
            output_modalities: ["text"],
          },
          supported_parameters: ["tools", "response_format"],
          expiration_date: null,
          provider: "openrouter",
        },
      ],
    });

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe(
      "https://openrouter.ai/api/v1/models?supported_parameters=tools&sort=intelligence-high-to-low",
    );
    expect(init?.method).toBe("GET");
  });

  it("uses provider only as Free AI Pool routing metadata", async () => {
    const fetchMock = vi.fn(
      async (
        _input: Parameters<typeof fetch>[0],
        _init?: Parameters<typeof fetch>[1],
      ) => new Response(JSON.stringify({ data: [] }), { status: 200 }),
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
      method: "GET",
      url: "/v1/models?provider=openrouter&output_modalities=text",
    });

    expect(response.statusCode).toBe(200);
    const [url] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("https://openrouter.ai/api/v1/models?output_modalities=text");
  });

  it("rejects unknown providers", async () => {
    app = buildApp(loadConfig({ LOG_LEVEL: "silent" }));

    const response = await app.inject({
      method: "GET",
      url: "/v1/models?provider=unknown",
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error: { code: "invalid_provider" },
    });
  });
});
