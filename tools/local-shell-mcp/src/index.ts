#!/usr/bin/env node

import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";

import { makeAuthConfig } from "./auth.js";
import { ensureRuntimeDirectories, makeRuntimeConfig } from "./config.js";
import { createHttpMcpServer, makeHttpConfig } from "./http.js";
import { createMcpServerInstance } from "./server.js";

const config = makeRuntimeConfig();
await ensureRuntimeDirectories(config);

const transport = (process.env.LOCAL_SHELL_MCP_TRANSPORT ?? "stdio").trim().toLowerCase();

if (transport === "stdio") {
  const stdio = new StdioServerTransport();

  try {
    await createMcpServerInstance(config).connect(stdio);
  } catch (error) {
    // stdout belongs exclusively to the MCP stdio transport.
    console.error("local-shell-mcp failed to start:", error);
    process.exitCode = 1;
  }
} else if (transport === "http") {
  const httpConfig = makeHttpConfig();
  const authConfig = makeAuthConfig();
  const server = createHttpMcpServer(config, httpConfig, authConfig);

  server.listen(httpConfig.port, httpConfig.host, () => {
    console.error(
      `local-shell-mcp listening on http://${httpConfig.host}:${httpConfig.port}${authConfig.path}`,
    );
    console.error(`allowed Host header values: ${httpConfig.allowedHosts.join(", ")}`);
  });

  server.on("error", (error) => {
    console.error("local-shell-mcp listener error:", error);
    process.exitCode = 1;
  });
} else {
  console.error(`Unsupported LOCAL_SHELL_MCP_TRANSPORT: ${transport} (expected "stdio" or "http")`);
  process.exitCode = 1;
}
