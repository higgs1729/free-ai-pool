import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

import { toNodeHandler } from "@modelcontextprotocol/node";
import { createMcpHandler } from "@modelcontextprotocol/server";

import { authorize, type AuthConfig, type AuthDecision } from "./auth.js";
import { parsePositiveInt, type RuntimeConfig } from "./config.js";
import { createMcpServerInstance } from "./server.js";

/** Listener placement. The bind address is loopback-only and not configurable. */
export interface HttpConfig {
  /** Loopback bind address. The public edge is the tunnel, never this socket. */
  host: "127.0.0.1";
  port: number;
  /**
   * Hostnames accepted in the `Host` header, lower case.
   *
   * Loopback names are always accepted. The public tunnel hostname must be
   * listed explicitly, which is what keeps a DNS-rebinding attacker's own
   * hostname from reaching the handler.
   */
  allowedHosts: string[];
}

const LOOPBACK_HOSTS = ["localhost", "127.0.0.1", "[::1]", "::1"];

export function makeHttpConfig(env: NodeJS.ProcessEnv = process.env): HttpConfig {
  const configured = (env.LOCAL_SHELL_MCP_HTTP_ALLOWED_HOSTS ?? "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);

  return {
    host: "127.0.0.1",
    port: parsePositiveInt(env.LOCAL_SHELL_MCP_HTTP_PORT, 8792),
    allowedHosts: [...new Set([...LOOPBACK_HOSTS, ...configured])],
  };
}

/** Strips the port and lower-cases a `Host` header value. */
export function hostnameOf(hostHeader: string | undefined): string | undefined {
  if (hostHeader === undefined) {
    return undefined;
  }

  const value = hostHeader.trim().toLowerCase();
  if (value.length === 0) {
    return undefined;
  }

  if (value.startsWith("[")) {
    const end = value.indexOf("]");
    return end === -1 ? value : value.slice(0, end + 1);
  }

  const colon = value.lastIndexOf(":");
  return colon === -1 ? value : value.slice(0, colon);
}

export function isAllowedHost(hostHeader: string | undefined, config: HttpConfig): boolean {
  const hostname = hostnameOf(hostHeader);
  return hostname !== undefined && config.allowedHosts.includes(hostname);
}

function respond(res: ServerResponse, status: number, message: string): void {
  const body = JSON.stringify({ error: message });
  res.writeHead(status, {
    "content-type": "application/json",
    "content-length": String(Buffer.byteLength(body)),
  });
  res.end(body);
}

/**
 * Creates the loopback HTTP listener serving the MCP endpoint.
 *
 * Request handling order is deliberate: `Host` validation, then
 * {@link authorize}, then the MCP handler. Nothing reaches the handler — and
 * therefore nothing reaches `exec` — before the authorization decision.
 */
export function createHttpMcpServer(
  runtime: RuntimeConfig,
  http: HttpConfig,
  auth: AuthConfig,
): Server {
  const handler = createMcpHandler(() => createMcpServerInstance(runtime), {
    onerror: (error) => console.error("local-shell-mcp handler error:", error),
  });
  const nodeHandler = toNodeHandler(handler, {
    onerror: (error) => console.error("local-shell-mcp transport error:", error),
  });

  return createServer((req: IncomingMessage, res: ServerResponse) => {
    void (async () => {
      try {
        if (!isAllowedHost(req.headers.host, http)) {
          respond(res, 421, "Misdirected request.");
          return;
        }

        const path = new URL(req.url ?? "/", "http://127.0.0.1").pathname;
        const decision: AuthDecision = authorize(
          {
            method: (req.method ?? "").toUpperCase(),
            path,
            authorizationHeader: req.headers.authorization,
            remoteAddress: req.socket.remoteAddress,
          },
          auth,
        );

        if (!decision.allowed) {
          // The client is told `reason` (uniform); the operator is told
          // `logReason` (specific). Keeping the split here is what makes a
          // misconfigured connector diagnosable without leaking which
          // capability was missing.
          console.error(
            `local-shell-mcp denied ${req.method ?? "?"} ${path} from ${req.socket.remoteAddress ?? "?"}: ${decision.logReason}`,
          );
          respond(res, decision.status, decision.reason);
          return;
        }

        // `IncomingMessage` types `method`/`url` as `string | undefined`, which
        // the adapter's `method?: string` shape rejects under
        // exactOptionalPropertyTypes. The runtime shapes are identical.
        await nodeHandler(req as Parameters<typeof nodeHandler>[0], res);
      } catch (error) {
        console.error("local-shell-mcp request failed:", error);
        if (!res.headersSent) {
          respond(res, 500, "Internal error.");
        } else {
          res.end();
        }
      }
    })();
  });
}
