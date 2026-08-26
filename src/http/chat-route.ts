import type { FastifyInstance } from "fastify";
import { ProviderError } from "../core/errors.js";
import type { ProviderRegistry } from "../core/registry.js";
import type { CommonChatRequest } from "../core/types.js";
import { ChatCompletionRequestSchema } from "./chat-schema.js";

const IMPLEMENTED_PROVIDERS = new Set(["openrouter"]);

export function registerChatCompletionRoute(
  app: FastifyInstance,
  registry: ProviderRegistry,
): void {
  app.post("/v1/chat/completions", async (request, reply) => {
    const parsed = ChatCompletionRequestSchema.safeParse(request.body);

    if (!parsed.success) {
      return reply.code(400).send({
        error: {
          message: "Invalid chat completion request",
          type: "invalid_request_error",
          code: "invalid_request",
          details: parsed.error.flatten(),
        },
      });
    }

    const chatRequest = parsed.data as CommonChatRequest;

    if (chatRequest.stream === true) {
      return reply.code(501).send({
        error: {
          message: "Streaming is not implemented yet",
          type: "not_implemented_error",
          code: "streaming_not_implemented",
        },
      });
    }

    const adapter = registry.get(chatRequest.provider);
    if (!adapter) {
      const implemented = IMPLEMENTED_PROVIDERS.has(chatRequest.provider);
      return reply.code(implemented ? 503 : 501).send({
        error: {
          message: implemented
            ? `Provider '${chatRequest.provider}' is not configured`
            : `Provider '${chatRequest.provider}' is not implemented yet`,
          type: implemented ? "provider_configuration_error" : "not_implemented_error",
          code: implemented ? "provider_not_configured" : "provider_not_implemented",
        },
      });
    }

    const abortController = new AbortController();
    const abort = (): void => abortController.abort();
    request.raw.once("aborted", abort);

    try {
      const response = await adapter.chat(chatRequest, {
        signal: abortController.signal,
      });
      return reply.code(200).send(response);
    } catch (error) {
      if (error instanceof ProviderError) {
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

      request.log.error({ err: error }, "Unhandled chat completion error");
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
