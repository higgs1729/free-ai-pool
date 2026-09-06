import { timingSafeEqual } from "node:crypto";

/**
 * Shared secrets protecting the HTTP transport.
 *
 * Both parts are pure "capability C" material: an unguessable path and an
 * unguessable bearer token. They are meaningful only because the listener is
 * bound to loopback and published through an authenticated tunnel (A).
 */
export interface AuthConfig {
  /** Absolute URL path the MCP endpoint is served on, e.g. `/mcp/<random>`. */
  path: string;
  /** Secret expected in `Authorization: Bearer <token>`. */
  token: string;
}

/** The parts of an inbound HTTP request the authorization decision may use. */
export interface InboundRequest {
  /** HTTP method, upper case, e.g. `POST`. */
  method: string;
  /** URL pathname with query string already stripped. */
  path: string;
  /** Raw `Authorization` header value, if the client sent one. */
  authorizationHeader: string | undefined;
  /** Peer address as seen by the local listener (the tunnel, in practice). */
  remoteAddress: string | undefined;
}

export type AuthDecision =
  | { allowed: true }
  | {
      allowed: false;
      status: 401 | 403 | 404 | 405;
      /**
       * Sent to the client. Deliberately uniform across failure kinds so the
       * response reveals nothing about which capability was missing.
       */
      reason: string;
      /**
       * Written to the server's stderr only. Says which capability actually
       * failed, so a misconfigured connector can be diagnosed without weakening
       * what the client learns. Must never contain secret material.
       */
      logReason: string;
    };

/** Methods the MCP streamable-HTTP endpoint can legitimately receive. */
export const ALLOWED_METHODS = ["POST", "GET", "DELETE"] as const;

const MIN_SECRET_LENGTH = 32;

function requireSecret(name: string, value: string | undefined): string {
  const secret = value?.trim() ?? "";

  if (secret.length === 0) {
    throw new Error(`${name} must be set when the HTTP transport is enabled`);
  }
  if (secret.length < MIN_SECRET_LENGTH) {
    throw new Error(`${name} must be at least ${MIN_SECRET_LENGTH} characters`);
  }

  return secret;
}

export function makeAuthConfig(env: NodeJS.ProcessEnv = process.env): AuthConfig {
  const rawPath = requireSecret("LOCAL_SHELL_MCP_HTTP_PATH", env.LOCAL_SHELL_MCP_HTTP_PATH);

  if (!rawPath.startsWith("/")) {
    throw new Error("LOCAL_SHELL_MCP_HTTP_PATH must start with '/'");
  }

  return {
    path: rawPath.endsWith("/") && rawPath.length > 1 ? rawPath.slice(0, -1) : rawPath,
    token: requireSecret("LOCAL_SHELL_MCP_HTTP_TOKEN", env.LOCAL_SHELL_MCP_HTTP_TOKEN),
  };
}

/**
 * Length-checked constant-time comparison.
 *
 * The length check itself is not constant time; secret *lengths* are treated as
 * non-sensitive here, secret *contents* are not.
 */
export function secretEquals(actual: string, expected: string): boolean {
  const left = Buffer.from(actual, "utf8");
  const right = Buffer.from(expected, "utf8");

  if (left.byteLength !== right.byteLength) {
    return false;
  }

  return timingSafeEqual(left, right);
}

/** Extracts the token from an `Authorization: Bearer <token>` header. */
export function bearerToken(authorizationHeader: string | undefined): string | undefined {
  if (authorizationHeader === undefined) {
    return undefined;
  }

  const match = /^Bearer[ ]+(?<token>\S+)$/i.exec(authorizationHeader.trim());
  return match?.groups?.token;
}

/**
 * Decides whether an inbound request may reach the MCP handler.
 *
 * The policy checks three capabilities in order — loopback peer, bearer token,
 * secret path — and answers every failure with an identical `404`. Because the
 * token is checked before the path, a probe of the real path without a valid
 * token is indistinguishable from a probe of any other path, so the path stays
 * unguessable even under a token-less scan. Method semantics are revealed only
 * to a caller that has already demonstrated all three.
 *
 * The loopback check is belt-and-braces: the listener already binds `127.0.0.1`
 * only. It does mean the tunnel process must run on this host, which is how
 * `cloudflared` normally runs.
 */
export function authorize(request: InboundRequest, config: AuthConfig): AuthDecision {
  const remoteAddress = request.remoteAddress ?? "";

  const isLoopback =
    remoteAddress === "::1" ||
    /^127(?:\.\d{1,3}){3}$/.test(remoteAddress) ||
    /^::ffff:127(?:\.\d{1,3}){3}$/i.test(remoteAddress);

  // The HTTP transport is intentionally reachable only through a local
  // loopback peer (normally the authenticated tunnel). Hide the endpoint
  // entirely from non-loopback clients.
  if (!isLoopback) {
    return {
      allowed: false,
      status: 404,
      reason: "not found",
      logReason: `non-loopback peer ${remoteAddress === "" ? "<unknown>" : remoteAddress}`,
    };
  }

  // Authenticate before checking the secret path. This makes a request to the
  // real path without a valid token indistinguishable from a request to an
  // arbitrary path.
  const token = bearerToken(request.authorizationHeader);

  if (token === undefined) {
    return {
      allowed: false,
      status: 404,
      reason: "not found",
      logReason: "missing or malformed Authorization: Bearer header",
    };
  }

  if (!secretEquals(token, config.token)) {
    return {
      allowed: false,
      status: 404,
      reason: "not found",
      logReason: "bearer token does not match LOCAL_SHELL_MCP_HTTP_TOKEN",
    };
  }

  // Even an authenticated caller learns nothing useful from probing arbitrary
  // paths beyond the ordinary fact that they do not exist.
  if (!secretEquals(request.path, config.path)) {
    return {
      allowed: false,
      status: 404,
      reason: "not found",
      logReason: "request path does not match LOCAL_SHELL_MCP_HTTP_PATH",
    };
  }

  // Only after the caller has demonstrated all three capabilities
  // (loopback peer, bearer token, secret path) do we expose normal HTTP method
  // semantics.
  if (!(ALLOWED_METHODS as readonly string[]).includes(request.method)) {
    return {
      allowed: false,
      status: 405,
      reason: `method ${request.method} is not allowed`,
      logReason: `method ${request.method} is not allowed`,
    };
  }

  return { allowed: true };
}