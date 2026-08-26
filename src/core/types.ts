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
  imageUrl: {
    url: string;
    detail?: "auto" | "low" | "high";
  };
}

export type MessageContent = string | Array<TextContentPart | ImageUrlContentPart> | null;

export interface ToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

export interface ChatMessage {
  role: ChatRole;
  content: MessageContent;
  name?: string;
  toolCallId?: string;
  toolCalls?: ToolCall[];
}

export interface ToolDefinition {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters: Record<string, unknown>;
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
      jsonSchema: {
        name: string;
        description?: string;
        schema: Record<string, unknown>;
        strict?: boolean;
      };
    };

export interface ReasoningOptions {
  effort?: "minimal" | "low" | "medium" | "high";
  maxTokens?: number;
}

export interface CommonChatRequest {
  provider: ProviderId;
  model: string;
  messages: ChatMessage[];
  stream?: boolean;
  temperature?: number;
  maxTokens?: number;
  tools?: ToolDefinition[];
  toolChoice?: ToolChoice;
  responseFormat?: ResponseFormat;
  reasoning?: ReasoningOptions;
}

export type FinishReason = "stop" | "length" | "tool_calls" | "content_filter" | null;

export interface ChatChoice {
  index: number;
  message: ChatMessage;
  finishReason: FinishReason;
}

export interface Usage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface CommonChatResponse {
  id: string;
  provider: ProviderId;
  model: string;
  created: number;
  choices: ChatChoice[];
  usage?: Usage;
}

export interface CommonChatChunk {
  id: string;
  provider: ProviderId;
  model: string;
  created: number;
  choices: Array<{
    index: number;
    delta: Partial<ChatMessage>;
    finishReason: FinishReason;
  }>;
  usage?: Usage;
}
