import { ProviderError } from "../core/errors.js";
import type {
  CommonChatChunk,
  CommonChatRequest,
  CommonChatResponse,
} from "../core/types.js";
import type {
  ProviderAdapter,
  ProviderRequestContext,
} from "../core/provider.js";

type FetchLike = typeof globalThis.fetch;

export interface OpenRouterAdapterOptions {
  apiKey: string;
  baseUrl?: string | undefined;
  httpReferer?: string | undefined;
  title?: string | undefined;
  fetchImpl?: FetchLike | undefined;
}

const DEFAULT_BASE_URL = "https://openrouter.ai/api/v1";

export class OpenRouterAdapter implements ProviderAdapter {
  readonly id = "openrouter" as const;

  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly httpReferer: string | undefined;
  private readonly title: string | undefined;
  private readonly fetchImpl: FetchLike;

  constructor(options: OpenRouterAdapterOptions) {
    this.apiKey = options.apiKey;
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
    this.httpReferer = options.httpReferer;
    this.title = options.title;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
  }

  async chat(
    request: CommonChatRequest,
    context?: ProviderRequestContext,
  ): Promise<CommonChatResponse> {
    this.assertProvider(request);

    const response = await this.send(request, false, context);
    const payload = await readJsonOrText(response);

    if (!response.ok) {
      throw createUpstreamError(response, payload);
    }

    if (!isChatCompletionPayload(payload)) {
      throw new ProviderError({
        provider: this.id,
        message: "OpenRouter returned an invalid chat completion response",
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
    this.assertProvider(request);

    const response = await this.send(request, true, context);

    if (!response.ok) {
      const payload = await readJsonOrText(response);
      throw createUpstreamError(response, payload);
    }

    if (!response.body) {
      throw new ProviderError({
        provider: this.id,
        message: "OpenRouter returned an empty streaming response",
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
          message: "OpenRouter returned invalid JSON in its SSE stream",
          statusCode: 502,
          upstreamStatus: response.status,
          details: data,
          cause,
        });
      }

      if (isRecord(payload) && "error" in payload) {
        throw new ProviderError({
          provider: this.id,
          message: extractUpstreamMessage(payload) ?? "OpenRouter streaming request failed",
          statusCode: 502,
          upstreamStatus: response.status,
          details: payload,
        });
      }

      if (!isChatCompletionPayload(payload)) {
        throw new ProviderError({
          provider: this.id,
          message: "OpenRouter returned an invalid chat completion SSE chunk",
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

  private assertProvider(request: CommonChatRequest): void {
    if (request.provider !== this.id) {
      throw new ProviderError({
        provider: this.id,
        message: `OpenRouter adapter cannot handle provider '${request.provider}'`,
        statusCode: 500,
      });
    }
  }

  private async send(
    request: CommonChatRequest,
    stream: boolean,
    context?: ProviderRequestContext,
  ): Promise<Response> {
    const { provider: _provider, stream: _stream, ...openRouterRequest } = request;

    const init: RequestInit = {
      method: "POST",
      headers: this.buildHeaders(),
      body: JSON.stringify({
        ...openRouterRequest,
        stream,
      }),
    };

    if (context?.signal) {
      init.signal = context.signal;
    }

    try {
      return await this.fetchImpl(`${this.baseUrl}/chat/completions`, init);
    } catch (cause) {
      throw new ProviderError({
        provider: this.id,
        message: "Failed to reach OpenRouter",
        statusCode: 502,
        cause,
      });
    }
  }

  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      "Content-Type": "application/json",
    };

    if (this.httpReferer) {
      headers["HTTP-Referer"] = this.httpReferer;
    }

    if (this.title) {
      headers["X-Title"] = this.title;
    }

    return headers;
  }
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
    provider: "openrouter",
    message: extractUpstreamMessage(payload) ?? `OpenRouter returned HTTP ${response.status}`,
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
