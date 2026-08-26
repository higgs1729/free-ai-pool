import { ProviderError } from "../core/errors.js";
import type {
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
    if (request.provider !== this.id) {
      throw new ProviderError({
        provider: this.id,
        message: `OpenRouter adapter cannot handle provider '${request.provider}'`,
        statusCode: 500,
      });
    }

    const { provider: _provider, stream: _stream, ...openRouterRequest } = request;

    const init: RequestInit = {
      method: "POST",
      headers: this.buildHeaders(),
      body: JSON.stringify({
        ...openRouterRequest,
        stream: false,
      }),
    };

    if (context?.signal) {
      init.signal = context.signal;
    }

    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}/chat/completions`, init);
    } catch (cause) {
      throw new ProviderError({
        provider: this.id,
        message: "Failed to reach OpenRouter",
        statusCode: 502,
        cause,
      });
    }

    const payload = await readJsonOrText(response);

    if (!response.ok) {
      throw new ProviderError({
        provider: this.id,
        message: extractUpstreamMessage(payload) ?? `OpenRouter returned HTTP ${response.status}`,
        statusCode: response.status,
        upstreamStatus: response.status,
        details: payload,
      });
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
