import type { AppConfig } from "../config.js";
import { OpenRouterAdapter } from "../providers/openrouter.js";
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

  return registry;
}
