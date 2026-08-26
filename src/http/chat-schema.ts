import { z } from "zod";

const ProviderIdSchema = z.enum([
  "openrouter",
  "gemini",
  "groq",
  "zai",
  "kilo",
  "vercel",
]);

const ToolCallSchema = z
  .object({
    id: z.string(),
    type: z.literal("function"),
    function: z.object({
      name: z.string(),
      arguments: z.string(),
    }),
  })
  .passthrough();

const ContentPartSchema = z.union([
  z
    .object({
      type: z.literal("text"),
      text: z.string(),
    })
    .passthrough(),
  z
    .object({
      type: z.literal("image_url"),
      image_url: z
        .object({
          url: z.string(),
          detail: z.enum(["auto", "low", "high"]).optional(),
        })
        .passthrough(),
    })
    .passthrough(),
]);

const MessageSchema = z
  .object({
    role: z.enum(["system", "developer", "user", "assistant", "tool"]),
    content: z.union([z.string(), z.array(ContentPartSchema), z.null()]),
    name: z.string().optional(),
    tool_call_id: z.string().optional(),
    tool_calls: z.array(ToolCallSchema).optional(),
    reasoning: z.string().nullable().optional(),
    reasoning_details: z.array(z.record(z.string(), z.unknown())).optional(),
  })
  .passthrough();

const ToolSchema = z
  .object({
    type: z.literal("function"),
    function: z
      .object({
        name: z.string().min(1),
        description: z.string().optional(),
        parameters: z.record(z.string(), z.unknown()).optional(),
        strict: z.boolean().optional(),
      })
      .passthrough(),
  })
  .passthrough();

const ToolChoiceSchema = z.union([
  z.enum(["none", "auto", "required"]),
  z.object({
    type: z.literal("function"),
    function: z.object({ name: z.string().min(1) }),
  }),
]);

const ResponseFormatSchema = z.union([
  z.object({ type: z.literal("text") }).passthrough(),
  z.object({ type: z.literal("json_object") }).passthrough(),
  z
    .object({
      type: z.literal("json_schema"),
      json_schema: z
        .object({
          name: z.string().min(1),
          description: z.string().optional(),
          schema: z.record(z.string(), z.unknown()),
          strict: z.boolean().optional(),
        })
        .passthrough(),
    })
    .passthrough(),
]);

const ReasoningSchema = z
  .object({
    effort: z
      .enum(["max", "xhigh", "high", "medium", "low", "minimal", "none"])
      .optional(),
    max_tokens: z.number().int().positive().optional(),
    exclude: z.boolean().optional(),
    enabled: z.boolean().optional(),
  })
  .passthrough();

export const ChatCompletionRequestSchema = z
  .object({
    provider: ProviderIdSchema,
    model: z.string().min(1),
    messages: z.array(MessageSchema).min(1),
    stream: z.boolean().optional(),
    temperature: z.number().min(0).max(2).optional(),
    top_p: z.number().min(0).max(1).optional(),
    max_tokens: z.number().int().positive().optional(),
    stop: z.union([z.string(), z.array(z.string()).max(4)]).optional(),
    seed: z.number().int().optional(),
    frequency_penalty: z.number().min(-2).max(2).optional(),
    presence_penalty: z.number().min(-2).max(2).optional(),
    tools: z.array(ToolSchema).optional(),
    tool_choice: ToolChoiceSchema.optional(),
    parallel_tool_calls: z.boolean().optional(),
    response_format: ResponseFormatSchema.optional(),
    reasoning: ReasoningSchema.optional(),
    include_reasoning: z.boolean().optional(),
  })
  .passthrough();
