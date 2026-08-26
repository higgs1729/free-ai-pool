import { describe, expect, it, vi } from "vitest";
import { GroqAdapter } from "../src/providers/groq.js";

describe("GroqAdapter", () => {
  it("maps OpenRouter reasoning and preserves Groq-compatible structured output", async () => {
    const fetchMock = vi.fn(
      async (
        _input: Parameters<typeof fetch>[0],
        _init?: Parameters<typeof fetch>[1],
      ) =>
        new Response(
          JSON.stringify({
            id: "groq-chat-1",
            object: "chat.completion",
            created: 1_777_000_020,
            model: "openai/gpt-oss-120b",
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

    const adapter = new GroqAdapter({
      apiKey: "groq-key",
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    const response = await adapter.chat({
      model: "openai/gpt-oss-120b",
      messages: [{ role: "user", content: "hello", name: "caller" }],
      provider: { allow_fallbacks: false },
      reasoning: { effort: "xhigh" },
      include_reasoning: true,
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
    expect(url).toBe("https://api.groq.com/openai/v1/chat/completions");
    expect(init?.headers).toMatchObject({
      Authorization: "Bearer groq-key",
      "Content-Type": "application/json",
    });

    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    expect(body.provider).toBeUndefined();
    expect(body.reasoning).toBeUndefined();
    expect(body.reasoning_effort).toBe("high");
    expect(body.include_reasoning).toBe(true);
    expect(body.stream).toBe(false);
    expect(body.messages).toEqual([{ role: "user", content: "hello" }]);
    expect(body.response_format).toEqual({
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
    });
    expect(response.provider).toBe("groq");
  });

  it("maps Qwen reasoning to Groq default/none modes", async () => {
    const bodies: Array<Record<string, unknown>> = [];
    const fetchMock = vi.fn(
      async (
        _input: Parameters<typeof fetch>[0],
        init?: Parameters<typeof fetch>[1],
      ) => {
        bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        return new Response(
          JSON.stringify({
            id: "groq-qwen-1",
            object: "chat.completion",
            created: 1_777_000_021,
            model: "qwen/qwen3.6-27b",
            choices: [
              {
                index: 0,
                message: { role: "assistant", content: "ok" },
                finish_reason: "stop",
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      },
    );

    const adapter = new GroqAdapter({
      apiKey: "groq-key",
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    await adapter.chat({
      model: "qwen/qwen3.6-27b",
      messages: [{ role: "user", content: "reason" }],
      reasoning: { effort: "high" },
    });
    await adapter.chat({
      model: "qwen/qwen3.6-27b",
      messages: [{ role: "user", content: "do not reason" }],
      reasoning: { enabled: false },
    });

    expect(bodies[0]?.reasoning_effort).toBe("default");
    expect(bodies[1]?.reasoning_effort).toBe("none");
  });

  it("streams Groq OpenAI-compatible SSE chunks", async () => {
    const upstreamSse = [
      `data: ${JSON.stringify({
        id: "groq-stream-1",
        object: "chat.completion.chunk",
        created: 1_777_000_022,
        model: "openai/gpt-oss-120b",
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

    const adapter = new GroqAdapter({
      apiKey: "groq-key",
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    const chunks = [];
    for await (const chunk of adapter.stream({
      model: "openai/gpt-oss-120b",
      messages: [{ role: "user", content: "hello" }],
    })) {
      chunks.push(chunk);
    }

    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toMatchObject({
      provider: "groq",
      model: "openai/gpt-oss-120b",
      choices: [{ delta: { content: "hi" } }],
    });
  });

  it("lists Groq models through the OpenAI-compatible endpoint", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          object: "list",
          data: [
            {
              id: "openai/gpt-oss-120b",
              object: "model",
              created: 1_777_000_023,
              owned_by: "OpenAI",
              active: true,
              context_window: 131072,
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    const adapter = new GroqAdapter({
      apiKey: "groq-key",
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    const result = await adapter.listModels();

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.groq.com/openai/v1/models",
      expect.objectContaining({ method: "GET" }),
    );
    expect(result.data[0]).toMatchObject({
      id: "openai/gpt-oss-120b",
      provider: "groq",
      owned_by: "OpenAI",
      active: true,
      context_window: 131072,
    });
  });
});
