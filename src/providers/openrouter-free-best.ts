import type {
  CommonChatRequest,
  CommonModel,
  ModelListQuery,
} from "../core/types.js";

/** Build an OpenRouter Models API query for the capabilities this request needs. */
export function buildFreeBestQuery(request: CommonChatRequest): ModelListQuery {
  const requiredParameters = collectRequiredParameters(request);
  const query: ModelListQuery = {
    sort: "intelligence-high-to-low",
    output_modalities: "text",
    max_price: "0",
    context: String(estimateRequiredContext(request)),
  };

  if (requiredParameters.length > 0) {
    query.supported_parameters = requiredParameters.join(",");
  }

  if (hasImageInput(request)) {
    query.input_modalities = "image";
  }

  return query;
}

/**
 * Select the first eligible model from an intelligence-sorted OpenRouter list.
 * The caller is responsible for requesting sort=intelligence-high-to-low.
 */
export function selectFreeBestModel(
  models: CommonModel[],
  request: CommonChatRequest,
  now = Date.now(),
): CommonModel | undefined {
  const requiredParameters = collectRequiredParameters(request);
  const needsImage = hasImageInput(request);
  const requiredContext = estimateRequiredContext(request);

  return models.find((model) => {
    if (model.id === "openrouter/free" || model.id === "free-best") {
      return false;
    }

    if (!isStrictlyFree(model)) {
      return false;
    }

    if (isExpired(model, now)) {
      return false;
    }

    if (
      typeof model.context_length === "number" &&
      model.context_length < requiredContext
    ) {
      return false;
    }

    if (!supportsTextOutput(model)) {
      return false;
    }

    if (needsImage && !supportsImageInput(model)) {
      return false;
    }

    const supported = new Set(model.supported_parameters ?? []);
    if (!requiredParameters.every((parameter) => supported.has(parameter))) {
      return false;
    }

    return true;
  });
}

export function freeBestCacheKey(request: CommonChatRequest): string {
  return JSON.stringify(buildFreeBestQuery(request));
}

function collectRequiredParameters(request: CommonChatRequest): string[] {
  const required = new Set<string>();

  if (request.temperature !== undefined) required.add("temperature");
  if (request.top_p !== undefined) required.add("top_p");
  if (request.max_tokens !== undefined) required.add("max_tokens");
  if (request.stop !== undefined) required.add("stop");
  if (request.seed !== undefined) required.add("seed");
  if (request.frequency_penalty !== undefined) required.add("frequency_penalty");
  if (request.presence_penalty !== undefined) required.add("presence_penalty");
  if (request.tools !== undefined && request.tools.length > 0) required.add("tools");
  if (request.tool_choice !== undefined) required.add("tool_choice");
  if (request.parallel_tool_calls !== undefined) required.add("parallel_tool_calls");

  if (request.response_format?.type === "json_schema") {
    required.add("structured_outputs");
  } else if (request.response_format?.type === "json_object") {
    required.add("response_format");
  }

  // include_reasoning only controls whether an already-generated reasoning trace
  // is returned. Requiring a separate capability flag would incorrectly remove
  // models whose metadata advertises the actual `reasoning` parameter instead.
  if (request.reasoning !== undefined) required.add("reasoning");

  return [...required].sort();
}

function hasImageInput(request: CommonChatRequest): boolean {
  return request.messages.some(
    (message) =>
      Array.isArray(message.content) &&
      message.content.some((part) => part.type === "image_url"),
  );
}

function estimateRequiredContext(request: CommonChatRequest): number {
  // This is intentionally conservative and tokenizer-independent. The exact
  // tokenizer varies by candidate model; using ~3 chars/token avoids selecting
  // a context window that is obviously too small without coupling to a tokenizer.
  const serializedChars = JSON.stringify(request.messages).length;
  const estimatedInputTokens = Math.ceil(serializedChars / 3);
  return Math.max(1, estimatedInputTokens + (request.max_tokens ?? 0));
}

function isStrictlyFree(model: CommonModel): boolean {
  if (!model.id.endsWith(":free") || !isRecord(model.pricing)) {
    return false;
  }

  return isZeroPrice(model.pricing.prompt) && isZeroPrice(model.pricing.completion);
}

function isZeroPrice(value: unknown): boolean {
  if (typeof value === "number") {
    return value === 0;
  }
  if (typeof value === "string" && value.trim() !== "") {
    return Number(value) === 0;
  }
  return false;
}

function isExpired(model: CommonModel, now: number): boolean {
  if (!model.expiration_date) {
    return false;
  }

  const timestamp = Date.parse(model.expiration_date);
  return Number.isFinite(timestamp) && timestamp <= now;
}

function supportsTextOutput(model: CommonModel): boolean {
  const architecture = model.architecture;
  if (!isRecord(architecture) || !Array.isArray(architecture.output_modalities)) {
    return true;
  }

  return architecture.output_modalities.includes("text");
}

function supportsImageInput(model: CommonModel): boolean {
  const architecture = model.architecture;
  return (
    isRecord(architecture) &&
    Array.isArray(architecture.input_modalities) &&
    architecture.input_modalities.includes("image")
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
