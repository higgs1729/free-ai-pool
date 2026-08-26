import { z } from "zod";

const optionalNonEmptyString = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().min(1).optional(),
);

const optionalUrl = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().url().optional(),
);

const defaultedNonEmptyString = (defaultValue: string) =>
  z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.string().min(1).default(defaultValue),
  );

const AppConfigSchema = z.object({
  HOST: z.string().default("127.0.0.1"),
  PORT: z.coerce.number().int().min(1).max(65_535).default(8787),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),

  OPENROUTER_API_KEY: optionalNonEmptyString,
  OPENROUTER_BASE_URL: z.string().url().default("https://openrouter.ai/api/v1"),
  OPENROUTER_HTTP_REFERER: optionalUrl,
  OPENROUTER_X_TITLE: defaultedNonEmptyString("free-ai-pool"),

  GEMINI_API_KEY: optionalNonEmptyString,
  GROQ_API_KEY: optionalNonEmptyString,
  ZAI_API_KEY: optionalNonEmptyString,
  KILO_API_KEY: optionalNonEmptyString,
  VERCEL_AI_GATEWAY_API_KEY: optionalNonEmptyString,
});

export type AppConfig = z.infer<typeof AppConfigSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return AppConfigSchema.parse(env);
}
