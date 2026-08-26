import type {
  CommonChatChunk,
  CommonChatRequest,
  CommonChatResponse,
  ProviderId,
} from "./types.js";

export interface ProviderRequestContext {
  signal?: AbortSignal;
}

export interface ProviderAdapter {
  readonly id: ProviderId;

  chat(
    request: CommonChatRequest,
    context?: ProviderRequestContext,
  ): Promise<CommonChatResponse>;

  stream?(
    request: CommonChatRequest,
    context?: ProviderRequestContext,
  ): AsyncIterable<CommonChatChunk>;
}
