import { describe, expect, it, vi } from "vitest";
import { KiloAdapter } from "../src/providers/kilo.js";

describe("KiloAdapter", () => {
  it("supports anonymous free chat and strips unsupported reasoning fields", async () => {
    const fetchMock = vi.fn(
      async (
        _input: Parameters<typeof fetch>[0],
        _init?: Parameters<typeof fetch>[1],
      ) =>
        new Response(
          JSON.stringify({
            id: "kilo-chat-1",
            object: "chat.completion",
            created: 1_777_000_030,
            model: "kilo-auto/free",
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

    const adapter = new KiloAdapter({
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    const response = await adapter.chat({
      model: "kilo-auto/free",
      messages: [
        { role: "developer", content: "be brief" },
        {
          role: "assistant",
          content: "previous",
          reasoning: "hidden trace",
          reasoning_details: [{ type: "reasoning.text", text: "hidden" }],
        },
        { role: "user", content: "hello" },
      ],
      provider: { allow_fallbacks: false },
      reasoning: { effort: "high" },
      include_reasoning: true,
      response_format: { type: "json_object" },
    });

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("https://api.kilo.ai/api/gateway/chat/completions");
    expect(init?.headers).not.toMatchObject({ Authorization: expect.any(String) });

    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    expect(body.provider).toBeUndefined();
    expect(body.reasoning).toBeUndefined();
    expect(body.include_reasoning).toBeUndefined();
    expect(body.response_format).toEqual({ type: "json_object" });
    expect(body.messages).toEqual([
      { role: "system", content: "be brief" },
      { role: "assistant", content: "previous" },
      { role: "user", content: "hello" },
    ]);
    expect(response.provider).toBe("kilo");
  });

  it("adds bearer auth when a Kilo API key is configured", async () => {
    const fetchMock = vi.fn(
      async (
        _input: Parameters<typeof fetch>[0],
        _init?: Parameters<typeof fetch>[1],
      ) =>
        new Response(
          JSON.stringify({
            id: "kilo-chat-2",
            object: "chat.completion",
            created: 1_777_000_031,
            model: "kilo-auto/free",
            choices: [],
          }),
          { status: 200 },
        ),
    );

    const adapter = new KiloAdapter({
      apiKey: "kilo-key",
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    await adapter.chat({
      model: "kilo-auto/free",
      messages: [{ role: "user", content: "hello" }],
    });

    const [, init] = fetchMock.mock.calls[0] ?? [];
    expect(init?.headers).toMatchObject({ Authorization: "Bearer kilo-key" });
  });

  it("streams Kilo SSE and lists models", async () => {
    let call = 0;
    const fetchMock = vi.fn(async () => {
      call += 1;
      if (call === 1) {
        const upstreamSse = [
          `data: ${JSON.stringify({
            id: "kilo-stream-1",
            object: "chat.completion.chunk",
            created: 1_777_000_032,
            model: "kilo-auto/free",
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
          data: [{ id: "stepfun/step-3.7-flash:free", object: "model" }],
        }),
        { status: 200 },
      );
    });

    const adapter = new KiloAdapter({
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    const chunks = [];
    for await (const chunk of adapter.stream({
      model: "kilo-auto/free",
      messages: [{ role: "user", content: "hello" }],
    })) {
      chunks.push(chunk);
    }
    const models = await adapter.listModels();

    expect(chunks[0]).toMatchObject({ provider: "kilo" });
    expect(models.data[0]).toMatchObject({
      id: "stepfun/step-3.7-flash:free",
      provider: "kilo",
    });
  });
});
