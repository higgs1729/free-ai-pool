import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";

let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe("health endpoint", () => {
  it("returns service health", async () => {
    app = buildApp({
      HOST: "127.0.0.1",
      PORT: 8787,
      LOG_LEVEL: "silent",
    });

    const response = await app.inject({
      method: "GET",
      url: "/health",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      status: "ok",
      service: "free-ai-pool",
    });
  });
});
