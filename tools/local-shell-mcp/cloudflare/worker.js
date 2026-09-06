/**
 * Edge authorization for local-shell-mcp (layer A).
 *
 * Generic MCP clients may not send the `CF-Access-Client-Id` / `-Secret` headers
 * a Cloudflare Access service-token policy expects. This Worker instead checks
 * the standard Authorization bearer token plus the secret path, and refuses
 * everything else before it ever enters the tunnel.
 *
 * The origin repeats both checks (layer C). That duplication is the point: a
 * Worker misconfiguration must not by itself expose `exec`.
 *
 * Secrets (set with `wrangler secret put <NAME>`):
 *
 *   MCP_PATH      the secret path, e.g. /mcp/<random>   (= LOCAL_SHELL_MCP_HTTP_PATH)
 *   MCP_TOKEN     the bearer token                       (= LOCAL_SHELL_MCP_HTTP_TOKEN)
 *   ORIGIN_BASE   tunnel origin, e.g. https://shell.example.com (no trailing slash)
 */

/** Compares two strings in constant time, tolerating unequal lengths. */
async function constantTimeEquals(actual, expected) {
  const encoder = new TextEncoder();
  const [left, right] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(actual)),
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
  ]);

  return crypto.subtle.timingSafeEqual(new Uint8Array(left), new Uint8Array(right));
}

function bearerToken(authorizationHeader) {
  if (!authorizationHeader) {
    return undefined;
  }

  const match = /^Bearer[ ]+(\S+)$/i.exec(authorizationHeader.trim());
  return match ? match[1] : undefined;
}

function jsonResponse(status, error) {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function notFound() {
  return jsonResponse(404, "not found");
}

/**
 * Resolves the origin URL for a path.
 *
 * Returns undefined when ORIGIN_BASE is not an absolute http(s) URL — a stray
 * space or an empty paste would otherwise produce a relative URL and throw
 * inside the request handler, which Cloudflare surfaces as a bare 1101.
 */
function resolveOriginUrl(originBase, pathname) {
  let base;
  try {
    base = new URL(String(originBase).trim());
  } catch {
    return undefined;
  }

  if (base.protocol !== "https:" && base.protocol !== "http:") {
    return undefined;
  }

  return new URL(pathname, base).toString();
}

export default {
  async fetch(request, env) {
    if (!env.MCP_PATH || !env.MCP_TOKEN || !env.ORIGIN_BASE) {
      console.error("local-shell-mcp edge is missing MCP_PATH, MCP_TOKEN or ORIGIN_BASE");
      return notFound();
    }

    // Same ordering as the origin's authorize(): token first, then path, so a
    // token-less scan cannot distinguish the real path from any other.
    const token = bearerToken(request.headers.get("authorization"));
    if (token === undefined || !(await constantTimeEquals(token, env.MCP_TOKEN))) {
      console.error("edge denied: missing or wrong bearer token");
      return notFound();
    }

    const { pathname } = new URL(request.url);
    if (!(await constantTimeEquals(pathname, env.MCP_PATH))) {
      console.error("edge denied: path does not match MCP_PATH");
      return notFound();
    }

    const originUrl = resolveOriginUrl(env.ORIGIN_BASE, pathname);
    if (originUrl === undefined) {
      // Shape only, never the value: ORIGIN_BASE names the tunnel.
      const raw = String(env.ORIGIN_BASE);
      console.error(
        `edge misconfigured: ORIGIN_BASE is not an absolute http(s) URL ` +
          `(length=${raw.length}, startsWithHttps=${raw.trim().startsWith("https://")}, ` +
          `firstChar=${JSON.stringify(raw.slice(0, 1))})`,
      );
      return jsonResponse(502, "origin not configured");
    }

    // `new Request(url, request)` preserves method, headers and body, and the
    // streamed response (SSE) is returned untouched.
    try {
      return await fetch(new Request(originUrl, request));
    } catch (error) {
      console.error(`edge could not reach the origin: ${error}`);
      return jsonResponse(502, "origin unreachable");
    }
  },
};
