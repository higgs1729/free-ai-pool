#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/server";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { z } from "zod";

import { ensureRuntimeDirectories, makeRuntimeConfig } from "./config.js";
import { runCommand } from "./exec.js";

const config = makeRuntimeConfig();
await ensureRuntimeDirectories(config);

const server = new McpServer({
  name: "local-shell-mcp",
  version: "0.1.0",
});

server.registerTool(
  "exec",
  {
    title: "Execute local shell command",
    description:
      "Execute an arbitrary PowerShell or Bash command on the local machine using this MCP server process's OS permissions. " +
      "cwd must be an absolute path. cwd is only the process starting directory and is NOT a sandbox boundary. " +
      "The host OS user and filesystem ACLs are the security boundary.",
    inputSchema: z.object({
      shell: z.enum(["powershell", "bash"]),
      command: z.string().min(1).max(100_000),
      cwd: z.string().min(1),
      timeoutMs: z.number().int().positive().optional(),
    }),
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    },
  },
  async ({ shell, command, cwd, timeoutMs }) => {
    const result = await runCommand(
      {
        shell,
        command,
        cwd,
        ...(timeoutMs === undefined ? {} : { timeoutMs }),
      },
      config,
    );

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  },
);

const transport = new StdioServerTransport();

try {
  await server.connect(transport);
} catch (error) {
  // stdout belongs exclusively to the MCP stdio transport.
  console.error("local-shell-mcp failed to start:", error);
  process.exitCode = 1;
}
