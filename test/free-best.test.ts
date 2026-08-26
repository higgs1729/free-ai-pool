import { describe, expect, it, vi } from "vitest";
import { OpenRouterAdapter } from "../src/providers/openrouter.js";

describe("OpenRouter free-best", () => {
  it("selects the highest-ranked eligible strictly-free model and caches the choice", async () => {
    const fetchMock = vi.fn(
      async (
        input: Parameters<typeof fetch>[0],
        init?: Parameters<typeof fetch>[1],
      ) => {
        const url = String(input);
        if (url.includes("/models")) {
          return new Response(
            JSON.stringify({
              data: [
                {
                  id: "paid/top-model",
                  pricing: { prompt: "0.001", completion: "0.002" },
                  context_length: 200000,
                  supported_parameters: ["tools", "structured_outputs"],
                  architecture: { output_modalities: ["text"] },
                },
                {
                  id: "free/missing-tools:free",
                  pricing: { prompt: "0", completion: "0" },
                  context_length: 200000,
                  supported_parameters: ["structured_outputs"],
                  architecture: { output_modalities: ["text"] },
                },
                {
                  id: "free/best-match:free",
                  pricing: { prompt: "0", completion: "0" },
                  context_length: 200000,
                  supported_parameters: ["tools", "structured_outputs"],
                  architecture: { input_modalities: ["text"], output_modalities: ["text"] },
                  expiration_date: null,
                },
                {
                  id: "free/lower-match:free",
                  pricing: { prompt: "0", completion: "0" },
                  context_length: 200000,
                  supported_parameters: ["tools", "structured_outputs"],
                  architecture: { output_modalities: ["text"] },
                },
              ],
            }),
            { status: 200 },
          );
        }

        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return new Response(
          JSON.stringify({
            id: `chat-${fetchMock.mock.calls.length}`,
            object: "chat.completion",
            created: 1_777_000_050,
            model: body.model,
            choices: [
              {
                index: 0,
                message: { role: "assistant", content: "ok" },
                finish_reason: "stop",
              },
            ],
          }),
          { status: 200 },
        );
      },
    );

    const adapter = new OpenRouterAdapter({
      apiKey: "openrouter-key",
      fetchImpl: fetchMock as unknown as typeof fetch,
      freeBestCacheTtlMs: 60_000,
    });

    const request = {
      model: "free-best",
      messages: [{ role: "user" as const, content: "return structured data" }],
      tools: [
        {
          type: "function" as const,
          function: {
            name: "lookup",
            parameters: { type: "object" },
          },
        },
      ],
      response_format: {
        type: "json_schema" as const,
        json_schema: {
          name: "answer",
          schema: { type: "object" },
          strict: true,
        },
      },
    };

    const first = await adapter.chat(request);
    const second = await adapter.chat(request);

    expect(first.model).toBe("free/best-match:free");
    expect(second.model).toBe("free/best-match:free");

    const modelCalls = fetchMock.mock.calls.filter(([input]) =>
      String(input).includes("/models"),
    );
    expect(modelCalls).toHaveLength(1);

    const [modelUrl] = modelCalls[0] ?? [];
    const parsedModelUrl = new URL(String(modelUrl));
    expect(parsedModelUrl.searchParams.get("sort")).toBe("intelligence-high-to-low");
    expect(parsedModelUrl.searchParams.get("max_price")).toBe("0");
    expect(parsedModelUrl.searchParams.get("supported_parameters")).toBe(
      "structured_outputs,tools",
    );

    const chatBodies = fetchMock.mock.calls
      .filter(([input]) => String(input).includes("/chat/completions"))
      .map(([, init]) => JSON.parse(String(init?.body)) as Record<string, unknown>);
    expect(chatBodies).toHaveLength(2);
    expect(chatBodies.every((body) => body.model === "free/best-match:free")).toBe(true);
  });

  it("filters expired and non-vision models for image requests", async () => {
    const fetchMock = vi.fn(
      async (
        input: Parameters<typeof fetch>[0],
        init?: Parameters<typeof fetch>[1],
      ) => {
        if (String(input).includes("/models")) {
          return new Response(
            JSON.stringify({
              data: [
                {
                  id: "free/expired-vision:free",
                  pricing: { prompt: "0", completion: "0" },
                  context_length: 100000,
                  architecture: {
                    input_modalities: ["text", "image"],
                    output_modalities: ["text"],
                  },
                  expiration_date: "2020-01-01T00:00:00Z",
                },
                {
                  id: "free/text-only:free",
                  pricing: { prompt: "0", completion: "0" },
                  context_length: 100000,
                  architecture: {
                    input_modalities: ["text"],
                    output_modalities: ["text"],
                  },
                },
                {
                  id: "free/vision-match:free",
                  pricing: { prompt: "0", completion: "0" },
                  context_length: 100000,
                  architecture: {
                    input_modalities: ["text", "image"],
                    output_modalities: ["text"],
                  },
                },
              ],
            }),
            { status: 200 },
          );
        }

        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return new Response(
          JSON.stringify({
            id: "vision-chat",
            object: "chat.completion",
            created: 1_777_000_051,
            model: body.model,
            choices: [],
          }),
          { status: 200 },
        );
      },
    );

    const adapter = new OpenRouterAdapter({
      apiKey: "openrouter-key",
      fetchImpl: fetchMock as unknown as typeof fetch,
      freeBestCacheTtlMs: 0,
    });

    const response = await adapter.chat({
      model: "free-best",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "describe" },
            { type: "image_url", image_url: { url: "https://example.com/image.png" } },
          ],
        },
      ],
    });

    expect(response.model).toBe("free/vision-match:free");
    const [modelUrl] = fetchMock.mock.calls[0] ?? [];
    expect(new URL(String(modelUrl)).searchParams.get("input_modalities")).toBe("image");
  });
});
