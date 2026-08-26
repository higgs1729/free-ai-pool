import type { FastifyInstance, FastifyReply } from "fastify";
import { ProviderError } from "../core/errors.js";
import type { ProviderRegistry } from "../core/registry.js";
import type { ModelListQuery, ProviderId } from "../core/types.js";

const PROVIDER_IDS = new Set<ProviderId>([
  "openrouter",
  "gemini",
  "groq",
  "zai",
  "kilo",
  "vercel",
]);
const IMPLEMENTED_PROVIDERS = new Set<ProviderId>(["openrouter", "gemini"]);

export function registerModelsRoute(
  app: FastifyInstance,
  registry: ProviderRegistry,
): void {
  app.get("/v1/models", async (request, reply) => {
    const parsed = parseModelQuery(request.query);
    if (!parsed.ok) {
      return reply.code(400).send({
        error: {
          message: parsed.message,
          type: "invalid_request_error",
          code: "invalid_provider",
        },
      });
    }

    const adapter = registry.get(parsed.provider);
    if (!adapter) {
      const implemented = IMPLEMENTED_PROVIDERS.has(parsed.provider);
      return reply.code(implemented ? 503 : 501).send({
        error: {
          message: implemented
            ? `Provider '${parsed.provider}' is not configured`
            : `Provider '${parsed.provider}' is not implemented yet`,
          type: implemented ? "provider_configuration_error" : "not_implemented_error",
          code: implemented ? "provider_not_configured" : "provider_not_implemented",
        },
      });
    }

    if (!adapter.listModels) {
      return reply.code(501).send({
        error: {
          message: `Provider '${parsed.provider}' does not support model listing yet`,
          type: "not_implemented_error",
          code: "models_not_implemented",
        },
      });
    }

    const abortController = new AbortController();
    const abort = (): void => abortController.abort();
    request.raw.once("aborted", abort);

    try {
      const response = await adapter.listModels(parsed.query, {
        signal: abortController.signal,
      });
      return reply.code(200).send(response);
    } catch (error) {
      if (error instanceof ProviderError) {
        return sendProviderError(reply, error);
      }

      request.log.error({ err: error }, "Unhandled models error");
      return reply.code(500).send({
        error: {
          message: "Internal server error",
          type: "internal_error",
          code: "internal_error",
        },
      });
    } finally {
      request.raw.off("aborted", abort);
    }
  });
}

function parseModelQuery(query: unknown):
  | { ok: true; provider: ProviderId; query: ModelListQuery }
  | { ok: false; message: string } {
  if (!isRecord(query)) {
    return { ok: true, provider: "openrouter", query: {} };
  }

  const rawProvider = query.provider;
  const provider = rawProvider === undefined ? "openrouter" : rawProvider;

  if (typeof provider !== "string" || !PROVIDER_IDS.has(provider as ProviderId)) {
    return {
      ok: false,
      message: `Unknown provider '${String(provider)}'`,
    };
  }

  const upstreamQuery: ModelListQuery = {};
  for (const [key, value] of Object.entries(query)) {
    if (key === "provider" || value === undefined) {
      continue;
    }

    if (typeof value === "string") {
      upstreamQuery[key] = value;
      continue;
    }

    if (Array.isArray(value) && value.every((item) => typeof item === "string")) {
      upstreamQuery[key] = value.join(",");
      continue;
    }

    upstreamQuery[key] = String(value);
  }

  return {
    ok: true,
    provider: provider as ProviderId,
    query: upstreamQuery,
  };
}

function sendProviderError(
  reply: FastifyReply,
  error: ProviderError,
): FastifyReply {
  return reply.code(error.statusCode).send({
    error: {
      message: error.message,
      type: "provider_error",
      code: "upstream_provider_error",
      provider: error.provider,
      upstream_status: error.upstreamStatus,
      details: error.details,
    },
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
