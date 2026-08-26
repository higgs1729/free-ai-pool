import Fastify, { type FastifyInstance } from "fastify";
import type { AppConfig } from "./config.js";
import { loadConfig } from "./config.js";
import {
  createProviderRegistry,
  type ProviderRegistry,
} from "./core/registry.js";
import { registerChatCompletionRoute } from "./http/chat-route.js";
import { registerModelsRoute } from "./http/models-route.js";

export function buildApp(
  config: AppConfig = loadConfig(),
  registry: ProviderRegistry = createProviderRegistry(config),
): FastifyInstance {
  const app = Fastify({
    logger: config.LOG_LEVEL === "silent" ? false : { level: config.LOG_LEVEL },
  });

  app.get("/health", async () => ({
    status: "ok",
    service: "free-ai-pool",
  }));

  registerChatCompletionRoute(app, registry);
  registerModelsRoute(app, registry);

  return app;
}
