import { ProviderError } from "../core/errors.js";
import type {
  ChatMessage,
  CommonChatChunk,
  CommonChatRequest,
  CommonChatResponse,
} from "../core/types.js";
import type {
  ProviderAdapter,
  ProviderRequestContext,
} from "../core/provider.js";

type FetchLike = typeof globalThis.fetch;

export interface ZaiAdapterOptions {
  apiKey: string;
  baseUrl?: string | undefined;
  fetchImpl?: FetchLike | undefined;
}

const DEFAULT_BASE_URL = "https://api.z.ai/api/paas/v4";

export class ZaiAdapter implements ProviderAdapter {
  readonly id = "zai" as const;

  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;

  constructor(options: ZaiAdapterOptions) {
    this.apiKey = options.apiKey;
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
  }

  async chat(
    request: CommonChatRequest,
    context?: ProviderRequestContext,
  ): Promise<CommonChatResponse> {
    const response = await this.sendChat(request, false, context);
    const payload = await readJsonOrText(response);

    if (!response.ok) {
      throw createUpstreamError(response, payload);
    }

    const normalized = normalizeChatPayload(payload);
    if (!isChatCompletionPayload(normalized)) {
      throw new ProviderError({
        provider: this.id,
        message: "Z.AI returned an invalid chat completion response",
        statusCode: 502,
        upstreamStatus: response.status,
        details: payload,
      });
    }

    return {
      ...normalized,
      provider: this.id,
    } as CommonChatResponse;
  }

  async *stream(
    request: CommonChatRequest,
    context?: ProviderRequestContext,
  ): AsyncIterable<CommonChatChunk> {
    const response = await this.sendChat(request, true, context);

    if (!response.ok) {
      const payload = await readJsonOrText(response);
      throw createUpstreamError(response, payload);
    }

    if (!response.body) {
      throw new ProviderError({
        provider: this.id,
        message: "Z.AI returned an empty streaming response",
        statusCode: 502,
        upstreamStatus: response.status,
      });
    }

    for await (const data of readSseData(response.body)) {
      if (data === "[DONE]") {
        return;
      }

      let payload: unknown;
      try {
        payload = JSON.parse(data) as unknown;
      } catch (cause) {
        throw new ProviderError({
          provider: this.id,
          message: "Z.AI returned invalid JSON in its SSE stream",
          statusCode: 502,
          upstreamStatus: response.status,
          details: data,
          cause,
        });
      }

      if (isRecord(payload) && "error" in payload) {
        throw new ProviderError({
          provider: this.id,
          message: extractUpstreamMessage(payload) ?? "Z.AI streaming request failed",
          statusCode: 502,
          upstreamStatus: response.status,
          details: payload,
        });
      }

      const normalized = normalizeChatPayload(payload);
      if (!isChatCompletionPayload(normalized)) {
        throw new ProviderError({
          provider: this.id,
          message: "Z.AI returned an invalid chat completion SSE chunk",
          statusCode: 502,
          upstreamStatus: response.status,
          details: payload,
        });
      }

      yield {
        ...normalized,
        provider: this.id,
      } as CommonChatChunk;
    }
  }

  private async sendChat(
    request: CommonChatRequest,
    stream: boolean,
    context?: ProviderRequestContext,
  ): Promise<Response> {
    const init: RequestInit = {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
        "Accept-Language": "en-US,en",
      },
      body: JSON.stringify(toZaiRequest(request, stream)),
    };

    if (context?.signal) {
      init.signal = context.signal;
    }

    try {
      return await this.fetchImpl(`${this.baseUrl}/chat/completions`, init);
    } catch (cause) {
      throw new ProviderError({
        provider: this.id,
        message: "Failed to reach Z.AI",
        statusCode: 502,
        cause,
      });
    }
  }
}

function toZaiRequest(
  request: CommonChatRequest,
  stream: boolean,
): Record<string, unknown> {
  const {
    stream: _stream,
    provider: _openRouterProviderRouting,
    reasoning,
    include_reasoning: _includeReasoning,
    response_format,
    ...compatible
  } = request;

  const body: Record<string, unknown> = {
    ...compatible,
    stream,
  };

  if (response_format?.type === "json_schema") {
    body.response_format = { type: "json_object" };
    body.messages = prependJsonSchemaInstruction(
      request.messages,
      response_format.json_schema.schema,
    );
  } else if (response_format) {
    body.response_format = response_format;
  }

  if (reasoning?.enabled === false) {
    body.thinking = { type: "disabled" };
  } else if (reasoning?.enabled === true || reasoning?.effort !== undefined) {
    body.thinking = { type: "enabled" };
  }

  if (reasoning?.effort !== undefined) {
    body.reasoning_effort = reasoning.effort;
  }

  return body;
}

function prependJsonSchemaInstruction(
  messages: ChatMessage[],
  schema: Record<string, unknown>,
): ChatMessage[] {
  const instruction: ChatMessage = {
    role: "system",
    content: `Return valid JSON matching this JSON Schema exactly:\n${JSON.stringify(schema)}`,
  };
  return [instruction, ...messages];
}

function normalizeChatPayload(payload: unknown): unknown {
  if (!isRecord(payload) || !Array.isArray(payload.choices)) {
    return payload;
  }

  return {
    ...payload,
    choices: payload.choices.map((choice) => normalizeChoice(choice)),
  };
}

function normalizeChoice(choice: unknown): unknown {
  if (!isRecord(choice)) {
    return choice;
  }

  const normalized: Record<string, unknown> = { ...choice };

  if (isRecord(choice.message)) {
    normalized.message = normalizeMessage(choice.message);
  }
  if (isRecord(choice.delta)) {
    normalized.delta = normalizeMessage(choice.delta);
  }

  return normalized;
}

function normalizeMessage(message: Record<string, unknown>): Record<string, unknown> {
  const normalized: Record<string, unknown> = { ...message };

  if (typeof message.reasoning_content === "string" && normalized.reasoning === undefined) {
    normalized.reasoning = message.reasoning_content;
  }

  if (Array.isArray(message.tool_calls)) {
    normalized.tool_calls = message.tool_calls.map((toolCall) => normalizeToolCall(toolCall));
  }

  return normalized;
}

function normalizeToolCall(toolCall: unknown): unknown {
  if (!isRecord(toolCall) || !isRecord(toolCall.function)) {
    return toolCall;
  }

  const fn = { ...toolCall.function };
  if (fn.arguments !== undefined && typeof fn.arguments !== "string") {
    fn.arguments = JSON.stringify(fn.arguments);
  }

  return {
    ...toolCall,
    function: fn,
  };
}

async function readJsonOrText(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

async function* readSseData(
  body: ReadableStream<Uint8Array>,
): AsyncIterable<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (line.startsWith("data:")) {
          yield line.slice(5).trimStart();
        }
      }
    }

    buffer += decoder.decode();
    if (buffer.startsWith("data:")) {
      yield buffer.slice(5).trimStart();
    }
  } finally {
    reader.releaseLock();
  }
}

function createUpstreamError(response: Response, payload: unknown): ProviderError {
  return new ProviderError({
    provider: "zai",
    message: extractUpstreamMessage(payload) ?? `Z.AI returned HTTP ${response.status}`,
    statusCode: response.status,
    upstreamStatus: response.status,
    details: payload,
  });
}

function extractUpstreamMessage(payload: unknown): string | undefined {
  if (!isRecord(payload)) return undefined;

  const error = payload.error;
  if (isRecord(error) && typeof error.message === "string") {
    return error.message;
  }
  if (typeof payload.message === "string") {
    return payload.message;
  }
  return undefined;
}

function isChatCompletionPayload(payload: unknown): payload is Record<string, unknown> {
  return (
    isRecord(payload) &&
    typeof payload.id === "string" &&
    typeof payload.model === "string" &&
    typeof payload.created === "number" &&
    Array.isArray(payload.choices)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
