import type { CommonChatRequest } from "../core/types.js";
import {
  OpenAiCompatibleGatewayAdapter,
  type OpenAiCompatibleGatewayAdapterOptions,
} from "./openai-compatible-gateway.js";

type FetchLike = typeof globalThis.fetch;

export interface VercelAdapterOptions {
  apiKey: string;
  baseUrl?: string | undefined;
  fetchImpl?: FetchLike | undefined;
}

const DEFAULT_BASE_URL = "https://ai-gateway.vercel.sh/v1";

/**
 * Vercel AI Gateway adapter.
 *
 * Vercel's Chat Completions compatibility layer understands the same
 * `reasoning` object used by the Free AI Pool baseline and also accepts
 * providerOptions for gateway/provider-specific routing. Only OpenRouter's
 * native top-level `provider` object is removed.
 */
export class VercelAdapter extends OpenAiCompatibleGatewayAdapter {
  constructor(options: VercelAdapterOptions) {
    const gatewayOptions: OpenAiCompatibleGatewayAdapterOptions = {
      id: "vercel",
      displayName: "Vercel AI Gateway",
      baseUrl: options.baseUrl ?? DEFAULT_BASE_URL,
      apiKey: options.apiKey,
      transformRequest: toVercelRequest,
    };

    if (options.fetchImpl !== undefined) {
      gatewayOptions.fetchImpl = options.fetchImpl;
    }

    super(gatewayOptions);
  }
}

function toVercelRequest(
  request: CommonChatRequest,
  stream: boolean,
): Record<string, unknown> {
  const { stream: _stream, provider: _openRouterProviderRouting, ...compatible } =
    request;

  return {
    ...compatible,
    stream,
  };
}
