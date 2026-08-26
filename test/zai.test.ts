import { describe, expect, it, vi } from "vitest";
import { ZaiAdapter } from "../src/providers/zai.js";

describe("ZaiAdapter", () => {
  it("maps OpenRouter reasoning and JSON schema requests to Z.AI", async () => {
    const fetchMock = vi.fn(
      async (
        _input: Parameters<typeof fetch>[0],
        _init?: Parameters<typeof fetch>[1],
      ) =>
        new Response(
          JSON.stringify({
            id: "zai-chat-1",
            object: "chat.completion",
            created: 1_787_000_001,
            model: "glm-5.2",
            choices: [
              {
                index: 0,
                message: {
                  role: "assistant",
                  content: "{\"answer\":\"hello\"}",
                  reasoning_content: "brief reasoning",
                },
                finish_reason: "stop",
              },
            ],
            usage: {
              prompt_tokens: 10,
              completion_tokens: 5,
              total_tokens: 15,
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    );

    const adapter = new ZaiAdapter({
      apiKey: "zai-key",
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    const response = await adapter.chat({
      model: "glm-5.2",
      messages: [{ role: "user", content: "hello" }],
      provider: { allow_fallbacks: false },
      reasoning: { effort: "xhigh", enabled: true },
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
    expect(url).toBe("https://api.z.ai/api/paas/v4/chat/completions");
    expect(init?.headers).toMatchObject({
      Authorization: "Bearer zai-key",
      "Content-Type": "application/json",
    });

    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    expect(body.provider).toBeUndefined();
    expect(body.reasoning).toBeUndefined();
    expect(body.thinking).toEqual({ type: "enabled" });
    expect(body.reasoning_effort).toBe("xhigh");
    expect(body.response_format).toEqual({ type: "json_object" });
    expect(body.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: "system",
          content: expect.stringContaining("JSON Schema"),
        }),
      ]),
    );

    expect(response.provider).toBe("zai");
    expect(response.choices[0]?.message.reasoning).toBe("brief reasoning");
  });

  it("normalizes Z.AI SSE reasoning and tool arguments", async () => {
    const upstreamSse = [
      `data: ${JSON.stringify({
        id: "zai-stream-1",
        object: "chat.completion.chunk",
        created: 1_787_000_002,
        model: "glm-5.2",
        choices: [
          {
            index: 0,
            delta: {
              role: "assistant",
              reasoning_content: "thinking",
              tool_calls: [
                {
                  id: "call_1",
                  type: "function",
                  function: { name: "test", arguments: { value: 1 } },
                },
              ],
            },
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

    const adapter = new ZaiAdapter({
      apiKey: "zai-key",
      baseUrl: "https://api.z.ai/api/coding/paas/v4",
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    const chunks = [];
    for await (const chunk of adapter.stream({
      model: "glm-5.2",
      messages: [{ role: "user", content: "hello" }],
      reasoning: { effort: "max" },
    })) {
      chunks.push(chunk);
    }

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.z.ai/api/coding/paas/v4/chat/completions",
      expect.objectContaining({ method: "POST" }),
    );
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toMatchObject({
      provider: "zai",
      choices: [
        {
          delta: {
            reasoning: "thinking",
            tool_calls: [
              {
                function: {
                  arguments: '{"value":1}',
                },
              },
            ],
          },
        },
      ],
    });
  });
});
