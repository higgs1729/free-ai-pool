import { describe, expect, it, vi } from "vitest";
import { VercelAdapter } from "../src/providers/vercel.js";

describe("VercelAdapter", () => {
  it("preserves Vercel-compatible reasoning/providerOptions while removing OpenRouter provider routing", async () => {
    const fetchMock = vi.fn(
      async (
        _input: Parameters<typeof fetch>[0],
        _init?: Parameters<typeof fetch>[1],
      ) =>
        new Response(
          JSON.stringify({
            id: "vercel-chat-1",
            object: "chat.completion",
            created: 1_777_000_040,
            model: "openai/gpt-5.6-sol",
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

    const adapter = new VercelAdapter({
      apiKey: "vercel-key",
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    const response = await adapter.chat({
      model: "openai/gpt-5.6-sol",
      messages: [{ role: "user", content: "hello" }],
      provider: { allow_fallbacks: false },
      reasoning: { effort: "high" },
      providerOptions: {
        gateway: { order: ["openai"] },
      },
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "answer",
          strict: true,
          schema: {
            type: "object",
            properties: { answer: { type: "string" } },
            required: ["answer"],
            additionalProperties: false,
          },
        },
      },
    });

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("https://ai-gateway.vercel.sh/v1/chat/completions");
    expect(init?.headers).toMatchObject({
      Authorization: "Bearer vercel-key",
      "Content-Type": "application/json",
    });

    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    expect(body.provider).toBeUndefined();
    expect(body.reasoning).toEqual({ effort: "high" });
    expect(body.providerOptions).toEqual({ gateway: { order: ["openai"] } });
    expect(body.response_format).toMatchObject({ type: "json_schema" });
    expect(response.provider).toBe("vercel");
  });

  it("streams Vercel SSE chunks and lists models", async () => {
    let call = 0;
    const fetchMock = vi.fn(async () => {
      call += 1;
      if (call === 1) {
        const upstreamSse = [
          `data: ${JSON.stringify({
            id: "vercel-stream-1",
            object: "chat.completion.chunk",
            created: 1_777_000_041,
            model: "openai/gpt-5.6-sol",
            choices: [
              {
                index: 0,
                delta: { role: "assistant", content: "hi" },
                finish_reason: null,
              },
            ],
          })}`,
          "",
          "data: [DONE]",
          "",
        ].join("\n");
        return new Response(upstreamSse, { status: 200 });
      }

      return new Response(
        JSON.stringify({
          object: "list",
          data: [{ id: "openai/gpt-5.6-sol", object: "model", owned_by: "openai" }],
        }),
        { status: 200 },
      );
    });

    const adapter = new VercelAdapter({
      apiKey: "vercel-key",
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    const chunks = [];
    for await (const chunk of adapter.stream({
      model: "openai/gpt-5.6-sol",
      messages: [{ role: "user", content: "hello" }],
    })) {
      chunks.push(chunk);
    }
    const models = await adapter.listModels();

    expect(chunks[0]).toMatchObject({ provider: "vercel" });
    expect(models.data[0]).toMatchObject({
      id: "openai/gpt-5.6-sol",
      provider: "vercel",
      owned_by: "openai",
    });
  });
});
