import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

describe("loadConfig", () => {
  it("treats blank optional env values as unset", () => {
    const config = loadConfig({
      LOG_LEVEL: "silent",
      OPENROUTER_API_KEY: "test-key",
      OPENROUTER_HTTP_REFERER: "",
      OPENROUTER_X_TITLE: "",
      GEMINI_API_KEY: "",
      GROQ_API_KEY: "",
      ZAI_API_KEY: "",
      KILO_API_KEY: "",
      VERCEL_AI_GATEWAY_API_KEY: "",
    });

    expect(config.OPENROUTER_API_KEY).toBe("test-key");
    expect(config.OPENROUTER_HTTP_REFERER).toBeUndefined();
    expect(config.OPENROUTER_X_TITLE).toBe("free-ai-pool");
    expect(config.GEMINI_API_KEY).toBeUndefined();
    expect(config.GROQ_API_KEY).toBeUndefined();
    expect(config.ZAI_API_KEY).toBeUndefined();
    expect(config.KILO_API_KEY).toBeUndefined();
    expect(config.VERCEL_AI_GATEWAY_API_KEY).toBeUndefined();
  });
});
