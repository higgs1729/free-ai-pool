import { describe, expect, it, vi } from "vitest";
import { GeminiAdapter } from "../src/providers/gemini.js";

describe("GeminiAdapter", () => {
  it("translates the OpenRouter reasoning shape to Gemini OpenAI compatibility", async () => {
    const fetchMock = vi.fn(
      async (
        _input: Parameters<typeof fetch>[0],
        _init?: Parameters<typeof fetch>[1],
      ) =>
        new Response(
          JSON.stringify({
            id: "gemini-chat-1",
            object: "chat.completion",
            created: 1_777_000_010,
            model: "gemini-3.7-flash",
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

    const adapter = new GeminiAdapter({
      apiKey: "gemini-key",
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    const response = await adapter.chat({
      model: "gemini-3.7-flash",
      messages: [{ role: "user", content: "hello" }],
      provider: { allow_fallbacks: false },
      reasoning: { effort: "xhigh" },
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
    });

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe(
      "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
    );
    expect(init?.headers).toMatchObject({
      Authorization: "Bearer gemini-key",
      "Content-Type": "application/json",
    });

    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    expect(body.provider).toBeUndefined();
    expect(body.reasoning).toBeUndefined();
    expect(body.reasoning_effort).toBe("high");
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
    expect(response.provider).toBe("gemini");
  });

  it("streams Gemini OpenAI-compatible SSE chunks", async () => {
    const upstreamSse = [
      `data: ${JSON.stringify({
        id: "gemini-stream-1",
        object: "chat.completion.chunk",
        created: 1_777_000_011,
        model: "gemini-3.7-flash",
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

    const fetchMock = vi.fn(async () =>
      new Response(upstreamSse, {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      }),
    );

    const adapter = new GeminiAdapter({
      apiKey: "gemini-key",
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    const chunks = [];
    for await (const chunk of adapter.stream({
      model: "gemini-3.7-flash",
      messages: [{ role: "user", content: "hello" }],
    })) {
      chunks.push(chunk);
    }

    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toMatchObject({
      provider: "gemini",
      model: "gemini-3.7-flash",
      choices: [{ delta: { content: "hi" } }],
    });
  });

  it("lists Gemini models through the OpenAI-compatible endpoint", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          object: "list",
          data: [
            {
              id: "gemini-3.7-flash",
              object: "model",
              created: 1_777_000_012,
              owned_by: "google",
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    const adapter = new GeminiAdapter({
      apiKey: "gemini-key",
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    const result = await adapter.listModels();

    expect(fetchMock).toHaveBeenCalledWith(
      "https://generativelanguage.googleapis.com/v1beta/openai/models",
      expect.objectContaining({ method: "GET" }),
    );
    expect(result.data[0]).toMatchObject({
      id: "gemini-3.7-flash",
      provider: "gemini",
      owned_by: "google",
    });
  });
});
