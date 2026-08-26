import { ProviderError } from "../core/errors.js";
import type {
  CommonChatChunk,
  CommonChatRequest,
  CommonChatResponse,
  CommonModelListResponse,
} from "../core/types.js";
import type {
  ProviderAdapter,
  ProviderRequestContext,
} from "../core/provider.js";

type FetchLike = typeof globalThis.fetch;

export interface GeminiAdapterOptions {
  apiKey: string;
  baseUrl?: string | undefined;
  fetchImpl?: FetchLike | undefined;
}

const DEFAULT_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai";

export class GeminiAdapter implements ProviderAdapter {
  readonly id = "gemini" as const;

  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;

  constructor(options: GeminiAdapterOptions) {
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

    if (!isChatCompletionPayload(payload)) {
      throw new ProviderError({
        provider: this.id,
        message: "Gemini returned an invalid chat completion response",
        statusCode: 502,
        upstreamStatus: response.status,
        details: payload,
      });
    }

    return {
      ...payload,
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
        message: "Gemini returned an empty streaming response",
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
          message: "Gemini returned invalid JSON in its SSE stream",
          statusCode: 502,
          upstreamStatus: response.status,
          details: data,
          cause,
        });
      }

      if (isRecord(payload) && "error" in payload) {
        throw new ProviderError({
          provider: this.id,
          message: extractUpstreamMessage(payload) ?? "Gemini streaming request failed",
          statusCode: 502,
          upstreamStatus: response.status,
          details: payload,
        });
      }

      if (!isChatCompletionPayload(payload)) {
        throw new ProviderError({
          provider: this.id,
          message: "Gemini returned an invalid chat completion SSE chunk",
          statusCode: 502,
          upstreamStatus: response.status,
          details: payload,
        });
      }

      yield {
        ...payload,
        provider: this.id,
      } as CommonChatChunk;
    }
  }

  async listModels(
    _query = {},
    context?: ProviderRequestContext,
  ): Promise<CommonModelListResponse> {
    const init: RequestInit = {
      method: "GET",
      headers: this.buildHeaders(),
    };

    if (context?.signal) {
      init.signal = context.signal;
    }

    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}/models`, init);
    } catch (cause) {
      throw new ProviderError({
        provider: this.id,
        message: "Failed to reach Gemini",
        statusCode: 502,
        cause,
      });
    }

    const payload = await readJsonOrText(response);

    if (!response.ok) {
      throw createUpstreamError(response, payload);
    }

    if (!isModelListPayload(payload)) {
      throw new ProviderError({
        provider: this.id,
        message: "Gemini returned an invalid models response",
        statusCode: 502,
        upstreamStatus: response.status,
        details: payload,
      });
    }

    return {
      data: payload.data.map((model) => ({
        ...model,
        provider: this.id,
      })),
    };
  }

  private async sendChat(
    request: CommonChatRequest,
    stream: boolean,
    context?: ProviderRequestContext,
  ): Promise<Response> {
    const geminiRequest = toGeminiRequest(request, stream);
    const init: RequestInit = {
      method: "POST",
      headers: this.buildHeaders(),
      body: JSON.stringify(geminiRequest),
    };

    if (context?.signal) {
      init.signal = context.signal;
    }

    try {
      return await this.fetchImpl(`${this.baseUrl}/chat/completions`, init);
    } catch (cause) {
      throw new ProviderError({
        provider: this.id,
        message: "Failed to reach Gemini",
        statusCode: 502,
        cause,
      });
    }
  }

  private buildHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.apiKey}`,
      "Content-Type": "application/json",
    };
  }
}

function toGeminiRequest(
  request: CommonChatRequest,
  stream: boolean,
): Record<string, unknown> {
  const {
    stream: _stream,
    provider: _openRouterProviderRouting,
    reasoning,
    include_reasoning: _includeReasoning,
    ...compatible
  } = request;

  const body: Record<string, unknown> = {
    ...compatible,
    stream,
  };

  if (reasoning?.effort) {
    body.reasoning_effort = mapReasoningEffort(reasoning.effort);
  }

  return body;
}

function mapReasoningEffort(
  effort: NonNullable<CommonChatRequest["reasoning"]>["effort"],
): "high" | "medium" | "low" | "minimal" | "none" | undefined {
  if (effort === undefined) {
    return undefined;
  }

  if (effort === "max" || effort === "xhigh") {
    return "high";
  }

  return effort;
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
      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const data = parseSseLine(line);
        if (data !== undefined) {
          yield data;
        }
      }
    }

    buffer += decoder.decode();
    const finalData = parseSseLine(buffer);
    if (finalData !== undefined) {
      yield finalData;
    }
  } finally {
    reader.releaseLock();
  }
}

function parseSseLine(line: string): string | undefined {
  if (!line.startsWith("data:")) {
    return undefined;
  }

  return line.slice(5).trimStart();
}

function createUpstreamError(response: Response, payload: unknown): ProviderError {
  return new ProviderError({
    provider: "gemini",
    message: extractUpstreamMessage(payload) ?? `Gemini returned HTTP ${response.status}`,
    statusCode: response.status,
    upstreamStatus: response.status,
    details: payload,
  });
}

function extractUpstreamMessage(payload: unknown): string | undefined {
  if (!isRecord(payload)) {
    return undefined;
  }

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

function isModelListPayload(
  payload: unknown,
): payload is { data: Array<Record<string, unknown> & { id: string }> } {
  return (
    isRecord(payload) &&
    Array.isArray(payload.data) &&
    payload.data.every((model) => isRecord(model) && typeof model.id === "string")
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
