import type { CommonChatRequest } from "../core/types.js";
import {
  OpenAiCompatibleGatewayAdapter,
  type OpenAiCompatibleGatewayAdapterOptions,
} from "./openai-compatible-gateway.js";

type FetchLike = typeof globalThis.fetch;

export interface KiloAdapterOptions {
  apiKey?: string | undefined;
  baseUrl?: string | undefined;
  fetchImpl?: FetchLike | undefined;
}

const DEFAULT_BASE_URL = "https://api.kilo.ai/api/gateway";

/**
 * Kilo Gateway adapter.
 *
 * Kilo accepts anonymous requests for free models, so apiKey is intentionally
 * optional. Its documented Chat Completions schema does not currently expose
 * OpenRouter's reasoning/include_reasoning fields, so those are not forwarded.
 */
export class KiloAdapter extends OpenAiCompatibleGatewayAdapter {
  constructor(options: KiloAdapterOptions = {}) {
    const gatewayOptions: OpenAiCompatibleGatewayAdapterOptions = {
      id: "kilo",
      displayName: "Kilo Gateway",
      baseUrl: options.baseUrl ?? DEFAULT_BASE_URL,
      transformRequest: toKiloRequest,
    };

    if (options.apiKey !== undefined) {
      gatewayOptions.apiKey = options.apiKey;
    }
    if (options.fetchImpl !== undefined) {
      gatewayOptions.fetchImpl = options.fetchImpl;
    }

    super(gatewayOptions);
  }
}

function toKiloRequest(
  request: CommonChatRequest,
  stream: boolean,
): Record<string, unknown> {
  const {
    stream: _stream,
    provider: _openRouterProviderRouting,
    reasoning: _reasoning,
    include_reasoning: _includeReasoning,
    ...compatible
  } = request;

  return {
    ...compatible,
    stream,
    messages: request.messages.map((message) => {
      const {
        reasoning: _messageReasoning,
        reasoning_details: _reasoningDetails,
        ...plainMessage
      } = message;

      if (plainMessage.role === "developer") {
        return { ...plainMessage, role: "system" };
      }

      return plainMessage;
    }),
  };
}
