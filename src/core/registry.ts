import type { AppConfig } from "../config.js";
import { GeminiAdapter } from "../providers/gemini.js";
import { GroqAdapter } from "../providers/groq.js";
import { OpenRouterAdapter } from "../providers/openrouter.js";
import { ZaiAdapter } from "../providers/zai.js";
import type { ProviderAdapter } from "./provider.js";
import type { ProviderId } from "./types.js";

export class ProviderRegistry {
  private readonly adapters = new Map<ProviderId, ProviderAdapter>();

  register(adapter: ProviderAdapter): void {
    this.adapters.set(adapter.id, adapter);
  }

  get(provider: ProviderId): ProviderAdapter | undefined {
    return this.adapters.get(provider);
  }
}

export function createProviderRegistry(config: AppConfig): ProviderRegistry {
  const registry = new ProviderRegistry();

  if (config.OPENROUTER_API_KEY) {
    registry.register(
      new OpenRouterAdapter({
        apiKey: config.OPENROUTER_API_KEY,
        baseUrl: config.OPENROUTER_BASE_URL,
        httpReferer: config.OPENROUTER_HTTP_REFERER,
        title: config.OPENROUTER_X_TITLE,
      }),
    );
  }

  if (config.GEMINI_API_KEY) {
    registry.register(
      new GeminiAdapter({
        apiKey: config.GEMINI_API_KEY,
        baseUrl: config.GEMINI_BASE_URL,
      }),
    );
  }

  if (config.ZAI_API_KEY) {
    registry.register(
      new ZaiAdapter({
        apiKey: config.ZAI_API_KEY,
        baseUrl: config.ZAI_BASE_URL,
      }),
    );
  }

  if (config.GROQ_API_KEY) {
    registry.register(
      new GroqAdapter({
        apiKey: config.GROQ_API_KEY,
        baseUrl: config.GROQ_BASE_URL,
      }),
    );
  }

  return registry;
}
