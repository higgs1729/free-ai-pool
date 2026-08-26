import { z } from "zod";

const AppConfigSchema = z.object({
  HOST: z.string().default("127.0.0.1"),
  PORT: z.coerce.number().int().min(1).max(65_535).default(8787),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),

  OPENROUTER_API_KEY: z.string().min(1).optional(),
  OPENROUTER_BASE_URL: z.string().url().default("https://openrouter.ai/api/v1"),
  OPENROUTER_HTTP_REFERER: z.string().url().optional(),
  OPENROUTER_X_TITLE: z.string().min(1).default("free-ai-pool"),

  GEMINI_API_KEY: z.string().min(1).optional(),
  GROQ_API_KEY: z.string().min(1).optional(),
  ZAI_API_KEY: z.string().min(1).optional(),
  KILO_API_KEY: z.string().min(1).optional(),
  VERCEL_AI_GATEWAY_API_KEY: z.string().min(1).optional(),
});

export type AppConfig = z.infer<typeof AppConfigSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return AppConfigSchema.parse(env);
}
