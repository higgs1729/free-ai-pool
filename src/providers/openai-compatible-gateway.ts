import { ProviderError } from "../core/errors.js";
import type {
  CommonChatChunk,
  CommonChatRequest,
  CommonChatResponse,
  CommonModelListResponse,
  ModelListQuery,
  ProviderId,
} from "../core/types.js";
import type {
  ProviderAdapter,
  ProviderRequestContext,
} from "../core/provider.js";

type FetchLike = typeof globalThis.fetch;

type RequestTransform = (
  request: CommonChatRequest,
  stream: boolean,
) => Record<string, unknown>;

export interface OpenAiCompatibleGatewayAdapterOptions {
  id: ProviderId;
  displayName: string;
  baseUrl: string;
  apiKey?: string | undefined;
  fetchImpl?: FetchLike | undefined;
  transformRequest?: RequestTransform | undefined;
  extraHeaders?: Record<string, string> | undefined;
}

/**
 * Small shared transport for gateways that expose the OpenAI Chat Completions
 * and Models endpoints without requiring provider-specific response shaping.
 * Provider-specific request differences stay in transformRequest.
 */
export class OpenAiCompatibleGatewayAdapter implements ProviderAdapter {
  readonly id: ProviderId;

  private readonly displayName: string;
  private readonly baseUrl: string;
  private readonly apiKey: string | undefined;
  private readonly fetchImpl: FetchLike;
  private readonly transformRequest: RequestTransform;
  private readonly extraHeaders: Record<string, string>;

  constructor(options: OpenAiCompatibleGatewayAdapterOptions) {
    this.id = options.id;
    this.displayName = options.displayName;
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.apiKey = options.apiKey;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    this.transformRequest = options.transformRequest ?? defaultTransformRequest;
    this.extraHeaders = options.extraHeaders ?? {};
  }

  async chat(
    request: CommonChatRequest,
    context?: ProviderRequestContext,
  ): Promise<CommonChatResponse> {
    const response = await this.sendChat(request, false, context);
    const payload = await readJsonOrText(response);

    if (!response.ok) {
      throw this.createUpstreamError(response, payload);
    }

    if (!isChatCompletionPayload(payload)) {
      throw new ProviderError({
        provider: this.id,
        message: `${this.displayName} returned an invalid chat completion response`,
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
      throw this.createUpstreamError(response, payload);
    }

    if (!response.body) {
      throw new ProviderError({
        provider: this.id,
        message: `${this.displayName} returned an empty streaming response`,
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
          message: `${this.displayName} returned invalid JSON in its SSE stream`,
          statusCode: 502,
          upstreamStatus: response.status,
          details: data,
          cause,
        });
      }

      if (isRecord(payload) && "error" in payload) {
        throw new ProviderError({
          provider: this.id,
          message:
            extractUpstreamMessage(payload) ??
            `${this.displayName} streaming request failed`,
          statusCode: 502,
          upstreamStatus: response.status,
          details: payload,
        });
      }

      if (!isChatCompletionPayload(payload)) {
        throw new ProviderError({
          provider: this.id,
          message: `${this.displayName} returned an invalid chat completion SSE chunk`,
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
    query: ModelListQuery = {},
    context?: ProviderRequestContext,
  ): Promise<CommonModelListResponse> {
    const search = new URLSearchParams(query);
    const url = `${this.baseUrl}/models${search.size > 0 ? `?${search.toString()}` : ""}`;
    const init: RequestInit = {
      method: "GET",
      headers: this.buildHeaders(false),
    };

    if (context?.signal) {
      init.signal = context.signal;
    }

    let response: Response;
    try {
      response = await this.fetchImpl(url, init);
    } catch (cause) {
      throw new ProviderError({
        provider: this.id,
        message: `Failed to reach ${this.displayName}`,
        statusCode: 502,
        cause,
      });
    }

    const payload = await readJsonOrText(response);
    if (!response.ok) {
      throw this.createUpstreamError(response, payload);
    }

    if (!isModelListPayload(payload)) {
      throw new ProviderError({
        provider: this.id,
        message: `${this.displayName} returned an invalid models response`,
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
    const init: RequestInit = {
      method: "POST",
      headers: this.buildHeaders(true),
      body: JSON.stringify(this.transformRequest(request, stream)),
    };

    if (context?.signal) {
      init.signal = context.signal;
    }

    try {
      return await this.fetchImpl(`${this.baseUrl}/chat/completions`, init);
    } catch (cause) {
      throw new ProviderError({
        provider: this.id,
        message: `Failed to reach ${this.displayName}`,
        statusCode: 502,
        cause,
      });
    }
  }

  private buildHeaders(includeContentType: boolean): Record<string, string> {
    const headers: Record<string, string> = { ...this.extraHeaders };

    if (includeContentType) {
      headers["Content-Type"] = "application/json";
    }

    if (this.apiKey) {
      headers.Authorization = `Bearer ${this.apiKey}`;
    }

    return headers;
  }

  private createUpstreamError(response: Response, payload: unknown): ProviderError {
    return new ProviderError({
      provider: this.id,
      message:
        extractUpstreamMessage(payload) ??
        `${this.displayName} returned HTTP ${response.status}`,
      statusCode: response.status,
      upstreamStatus: response.status,
      details: payload,
    });
  }
}

function defaultTransformRequest(
  request: CommonChatRequest,
  stream: boolean,
): Record<string, unknown> {
  const { stream: _stream, provider: _openRouterProviderRouting, ...compatible } =
    request;
  return { ...compatible, stream };
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
