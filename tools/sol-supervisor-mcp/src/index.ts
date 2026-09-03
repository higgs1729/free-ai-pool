#!/usr/bin/env node

import http from "node:http";

import { toNodeHandler } from "@modelcontextprotocol/node";
import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

import { emitEvent, ensureState, getState, waitForEvent } from "./state.js";
import { runCommand } from "./shell.js";

const host = process.env.SOL_SUPERVISOR_HOST ?? "127.0.0.1";
const port = Number(process.env.SOL_SUPERVISOR_PORT ?? 8788);
const maxWaitSeconds = Number(process.env.SOL_SUPERVISOR_MAX_WAIT_SECONDS ?? 45);
const eventToken = process.env.SOL_SUPERVISOR_EVENT_TOKEN;

if (!Number.isSafeInteger(port) || port <= 0 || port > 65535) throw new Error("SOL_SUPERVISOR_PORT is invalid");
if (!Number.isSafeInteger(maxWaitSeconds) || maxWaitSeconds < 1 || maxWaitSeconds > 55) {
  throw new Error("SOL_SUPERVISOR_MAX_WAIT_SECONDS must be between 1 and 55");
}

await ensureState();

function textResult(value: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
  };
}

function makeMcpServer(): McpServer {
  const server = new McpServer({ name: "sol-supervisor-mcp", version: "0.1.0" });

  server.registerTool(
    "ping",
    {
      title: "Ping Sol supervisor bridge",
      description: "Verify that the ChatGPT Sol supervisor can reach the local supervisor MCP bridge.",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async () => textResult({ ok: true, now: new Date().toISOString(), state: await getState() }),
  );

  server.registerTool(
    "await_event",
    {
      title: "Wait briefly for supervisor work",
      description:
        "Long-poll the local supervisor event queue. Keep calls below the ChatGPT MCP timeout. " +
        "If kind=heartbeat, call await_event again immediately unless the user asked you to stop. " +
        "If kind=event, handle the event autonomously, then resume await_event with the returned cursor.",
      inputSchema: z.object({
        cursor: z.number().int().nonnegative().default(0),
        timeoutSeconds: z.number().int().min(1).max(maxWaitSeconds).default(Math.min(40, maxWaitSeconds)),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ cursor, timeoutSeconds }) => textResult(await waitForEvent(cursor, timeoutSeconds * 1_000)),
  );

  server.registerTool(
    "emit_event",
    {
      title: "Emit supervisor event",
      description: "Append an event to the local supervisor queue. Mainly useful for PoC/self-tests and agent-to-agent handoff.",
      inputSchema: z.object({
        type: z.string().min(1).max(100),
        summary: z.string().min(1).max(4_000),
        payload: z.unknown().optional(),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ type, summary, payload }) => textResult(await emitEvent(type, summary, payload ?? null)),
  );

  server.registerTool(
    "exec",
    {
      title: "Execute command on the local PC",
      description:
        "Execute arbitrary PowerShell or Bash using the MCP server process's OS permissions. " +
        "There is intentionally no application sandbox in this PoC; the host OS account and filesystem ACLs are the boundary. " +
        "For work longer than the per-call timeout, start a background process and return quickly.",
      inputSchema: z.object({
        shell: z.enum(["powershell", "bash"]),
        command: z.string().min(1).max(100_000),
        cwd: z.string().min(1),
        timeoutMs: z.number().int().positive().optional(),
      }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    },
    async ({ shell, command, cwd, timeoutMs }) => {
      const result = await runCommand({ shell, command, cwd, ...(timeoutMs === undefined ? {} : { timeoutMs }) });
      return textResult(result);
    },
  );

  return server;
}

const mcpHandler = createMcpHandler(makeMcpServer);
const nodeMcpHandler = toNodeHandler(mcpHandler, {
  onerror(error) {
    console.error("MCP adapter error:", error);
  },
});

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(text),
  });
  res.end(text);
}

async function readJson(req: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.byteLength;
    if (bytes > 1_000_000) throw new Error("request body too large");
    chunks.push(buffer);
  }
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

const httpServer = http.createServer((req, res) => {
  void (async () => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? `${host}:${port}`}`);

    if (req.method === "GET" && url.pathname === "/healthz") {
      sendJson(res, 200, { ok: true, service: "sol-supervisor-mcp", now: new Date().toISOString() });
      return;
    }

    if (req.method === "POST" && url.pathname === "/event") {
      if (eventToken && req.headers.authorization !== `Bearer ${eventToken}`) {
        sendJson(res, 401, { error: "unauthorized" });
        return;
      }
      const body = (await readJson(req)) as { type?: unknown; summary?: unknown; payload?: unknown };
      if (typeof body.type !== "string" || !body.type || typeof body.summary !== "string" || !body.summary) {
        sendJson(res, 400, { error: "type and summary are required strings" });
        return;
      }
      const event = await emitEvent(body.type, body.summary, body.payload ?? null);
      sendJson(res, 201, event);
      return;
    }

    if (url.pathname === "/mcp") {
      nodeMcpHandler(req, res);
      return;
    }

    sendJson(res, 404, { error: "not found", endpoints: ["/mcp", "/event", "/healthz"] });
  })().catch((error) => {
    console.error("HTTP request failed:", error);
    if (!res.headersSent) sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) });
    else res.end();
  });
});

httpServer.listen(port, host, () => {
  console.error(`sol-supervisor-mcp listening on http://${host}:${port}/mcp`);
});

async function shutdown(signal: string): Promise<void> {
  console.error(`received ${signal}; shutting down`);
  await mcpHandler.close().catch(() => undefined);
  await new Promise<void>((resolve) => httpServer.close(() => resolve()));
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void shutdown(signal).finally(() => process.exit(0));
  });
}
