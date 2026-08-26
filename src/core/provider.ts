import type {
  CommonChatChunk,
  CommonChatRequest,
  CommonChatResponse,
  CommonModelListResponse,
  ModelListQuery,
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

  listModels?(
    query?: ModelListQuery,
    context?: ProviderRequestContext,
  ): Promise<CommonModelListResponse>;
}
