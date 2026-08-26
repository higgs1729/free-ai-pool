export type ProviderId =
  | "openrouter"
  | "gemini"
  | "groq"
  | "zai"
  | "kilo"
  | "vercel";

export type ChatRole = "system" | "developer" | "user" | "assistant" | "tool";

export interface TextContentPart {
  type: "text";
  text: string;
}

export interface ImageUrlContentPart {
  type: "image_url";
  image_url: {
    url: string;
    detail?: "auto" | "low" | "high";
  };
}

export type MessageContent =
  | string
  | Array<TextContentPart | ImageUrlContentPart>
  | null;

export interface ToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

export type ReasoningDetail = Record<string, unknown>;

export interface ChatMessage {
  role: ChatRole;
  content: MessageContent;
  name?: string;
  tool_call_id?: string;
  tool_calls?: ToolCall[];
  reasoning?: string | null;
  reasoning_details?: ReasoningDetail[];
}

export interface ToolDefinition {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
    strict?: boolean;
  };
}

export type ToolChoice =
  | "none"
  | "auto"
  | "required"
  | {
      type: "function";
      function: { name: string };
    };

export type ResponseFormat =
  | { type: "text" }
  | { type: "json_object" }
  | {
      type: "json_schema";
      json_schema: {
        name: string;
        description?: string;
        schema: Record<string, unknown>;
        strict?: boolean;
      };
    };

export interface ReasoningOptions {
  effort?: "max" | "xhigh" | "high" | "medium" | "low" | "minimal" | "none";
  max_tokens?: number;
  exclude?: boolean;
  enabled?: boolean;
}

/**
 * Common request shape for Free AI Pool.
 *
 * OpenRouter's /api/v1/chat/completions request is the baseline. `provider` is
 * the only Free AI Pool routing extension; adapters strip it before forwarding.
 * Provider-specific adapters may translate or drop unsupported fields.
 */
export interface CommonChatRequest {
  provider: ProviderId;
  model: string;
  messages: ChatMessage[];
  stream?: boolean;
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
  stop?: string | string[];
  seed?: number;
  frequency_penalty?: number;
  presence_penalty?: number;
  tools?: ToolDefinition[];
  tool_choice?: ToolChoice;
  parallel_tool_calls?: boolean;
  response_format?: ResponseFormat;
  reasoning?: ReasoningOptions;
  include_reasoning?: boolean;
  [key: string]: unknown;
}

export type FinishReason =
  | "stop"
  | "length"
  | "tool_calls"
  | "content_filter"
  | "error"
  | (string & {})
  | null;

export interface ChatChoice {
  index: number;
  message: ChatMessage;
  finish_reason: FinishReason;
}

export interface Usage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  prompt_tokens_details?: Record<string, unknown>;
  completion_tokens_details?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface CommonChatResponse {
  id: string;
  object?: string;
  provider: ProviderId;
  model: string;
  created: number;
  choices: ChatChoice[];
  usage?: Usage;
  [key: string]: unknown;
}

export interface CommonChatChunk {
  id: string;
  object?: string;
  provider: ProviderId;
  model: string;
  created: number;
  choices: Array<{
    index: number;
    delta: Partial<ChatMessage>;
    finish_reason: FinishReason;
  }>;
  usage?: Usage;
  [key: string]: unknown;
}

/** OpenRouter /api/v1/models is the baseline model metadata shape. */
export interface CommonModel {
  provider: ProviderId;
  id: string;
  canonical_slug?: string;
  name?: string;
  created?: number;
  description?: string;
  context_length?: number;
  architecture?: Record<string, unknown>;
  pricing?: Record<string, unknown>;
  top_provider?: Record<string, unknown>;
  per_request_limits?: unknown;
  supported_parameters?: string[];
  default_parameters?: Record<string, unknown> | null;
  expiration_date?: string | null;
  [key: string]: unknown;
}

export interface CommonModelListResponse {
  data: CommonModel[];
}

export type ModelListQuery = Record<string, string>;
