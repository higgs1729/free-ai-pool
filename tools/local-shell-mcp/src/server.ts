import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

import type { RuntimeConfig } from "./config.js";
import { runCommand } from "./exec.js";

/**
 * Builds a fully configured MCP server instance.
 *
 * The stdio transport creates one of these for the process lifetime; the HTTP
 * transport creates one per request, so this must stay free of shared mutable
 * state.
 */
export function createMcpServerInstance(config: RuntimeConfig): McpServer {
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

  return server;
}
