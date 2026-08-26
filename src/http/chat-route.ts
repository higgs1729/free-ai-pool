import type { FastifyInstance, FastifyReply } from "fastify";
import { ProviderError } from "../core/errors.js";
import type { ProviderAdapter } from "../core/provider.js";
import type { ProviderRegistry } from "../core/registry.js";
import type {
  CommonChatChunk,
  CommonChatRequest,
  ProviderId,
} from "../core/types.js";
import { ChatCompletionRequestSchema } from "./chat-schema.js";

const PROVIDER_IDS = new Set<ProviderId>([
  "openrouter",
  "gemini",
  "groq",
  "zai",
  "kilo",
  "vercel",
]);
const IMPLEMENTED_PROVIDERS = new Set<ProviderId>(PROVIDER_IDS);
const POOL_PROVIDER_HEADER = "x-free-ai-pool-provider";

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

    const routing = resolvePoolProvider(
      request.headers[POOL_PROVIDER_HEADER],
      parsed.data.provider,
    );
    if (!routing.ok) {
      return reply.code(400).send({
        error: {
          message: routing.message,
          type: "invalid_request_error",
          code: routing.code,
        },
      });
    }

    const { provider: bodyProvider, ...withoutProvider } = parsed.data;
    const chatRequest = (typeof bodyProvider === "string"
      ? withoutProvider
      : parsed.data) as CommonChatRequest;
    const adapter = registry.get(routing.provider);

    if (!adapter) {
      const implemented = IMPLEMENTED_PROVIDERS.has(routing.provider);
      return reply.code(implemented ? 503 : 501).send({
        error: {
          message: implemented
            ? `Provider '${routing.provider}' is not configured`
            : `Provider '${routing.provider}' is not implemented yet`,
          type: implemented ? "provider_configuration_error" : "not_implemented_error",
          code: implemented ? "provider_not_configured" : "provider_not_implemented",
        },
      });
    }

    const abortController = new AbortController();
    const abort = (): void => abortController.abort();
    request.raw.once("aborted", abort);

    try {
      if (chatRequest.stream === true) {
        return await streamChatCompletion(
          reply,
          adapter,
          chatRequest,
          abortController.signal,
        );
      }

      const response = await adapter.chat(chatRequest, {
        signal: abortController.signal,
      });
      return reply.code(200).send(response);
    } catch (error) {
      if (error instanceof ProviderError) {
        if (reply.raw.headersSent) {
          writeStreamingError(reply, error);
          return reply;
        }

        return sendProviderError(reply, error);
      }

      request.log.error({ err: error }, "Unhandled chat completion error");

      if (reply.raw.headersSent) {
        writeSseData(reply, {
          error: {
            message: "Internal server error",
            type: "internal_error",
            code: "internal_error",
          },
        });
        writeSseDone(reply);
        reply.raw.end();
        return reply;
      }

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

function resolvePoolProvider(
  headerValue: string | string[] | undefined,
  bodyProvider: ProviderId | Record<string, unknown> | undefined,
):
  | { ok: true; provider: ProviderId }
  | { ok: false; message: string; code: string } {
  if (Array.isArray(headerValue)) {
    return {
      ok: false,
      message: "X-Free-AI-Pool-Provider must contain a single provider id",
      code: "invalid_provider",
    };
  }

  let headerProvider: ProviderId | undefined;
  if (headerValue !== undefined) {
    if (!PROVIDER_IDS.has(headerValue as ProviderId)) {
      return {
        ok: false,
        message: `Unknown provider '${headerValue}'`,
        code: "invalid_provider",
      };
    }
    headerProvider = headerValue as ProviderId;
  }

  const legacyBodyProvider =
    typeof bodyProvider === "string" ? bodyProvider : undefined;

  if (
    headerProvider !== undefined &&
    legacyBodyProvider !== undefined &&
    headerProvider !== legacyBodyProvider
  ) {
    return {
      ok: false,
      message: "Provider header and legacy body provider disagree",
      code: "provider_conflict",
    };
  }

  const provider = headerProvider ?? legacyBodyProvider;
  if (!provider) {
    return {
      ok: false,
      message:
        "Select an upstream with X-Free-AI-Pool-Provider (legacy string body provider is also accepted)",
      code: "provider_required",
    };
  }

  return { ok: true, provider };
}

async function streamChatCompletion(
  reply: FastifyReply,
  adapter: ProviderAdapter,
  request: CommonChatRequest,
  signal: AbortSignal,
): Promise<FastifyReply> {
  if (!adapter.stream) {
    return reply.code(501).send({
      error: {
        message: `Provider '${adapter.id}' does not support streaming yet`,
        type: "not_implemented_error",
        code: "streaming_not_implemented",
      },
    });
  }

  const iterator = adapter
    .stream(request, { signal })
    [Symbol.asyncIterator]();

  // Pull the first item before committing HTTP 200 so upstream HTTP errors can
  // still be returned with their original status code.
  const first = await iterator.next();

  reply.hijack();
  reply.raw.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
  });

  if (!first.done) {
    writeSseData(reply, first.value);
  }

  while (true) {
    const next = await iterator.next();
    if (next.done) {
      break;
    }
    writeSseData(reply, next.value);
  }

  writeSseDone(reply);
  reply.raw.end();
  return reply;
}

function sendProviderError(
  reply: FastifyReply,
  error: ProviderError,
): FastifyReply {
  return reply.code(error.statusCode).send({
    error: providerErrorBody(error),
  });
}

function writeStreamingError(reply: FastifyReply, error: ProviderError): void {
  writeSseData(reply, { error: providerErrorBody(error) });
  writeSseDone(reply);
  reply.raw.end();
}

function providerErrorBody(error: ProviderError): Record<string, unknown> {
  return {
    message: error.message,
    type: "provider_error",
    code: "upstream_provider_error",
    provider: error.provider,
    upstream_status: error.upstreamStatus,
    details: error.details,
  };
}

function writeSseData(
  reply: FastifyReply,
  data: CommonChatChunk | Record<string, unknown>,
): void {
  reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
}

function writeSseDone(reply: FastifyReply): void {
  reply.raw.write("data: [DONE]\n\n");
}
