import { describe, expect, it } from "vitest";

import { authorize, bearerToken, makeAuthConfig, secretEquals, type AuthConfig } from "../src/auth.js";
import { hostnameOf, isAllowedHost, makeHttpConfig } from "../src/http.js";

const PATH_SECRET = `/mcp/${"a".repeat(32)}`;
const TOKEN_SECRET = "t".repeat(48);

const config: AuthConfig = { path: PATH_SECRET, token: TOKEN_SECRET };

describe("makeAuthConfig", () => {
  it("rejects missing secrets", () => {
    expect(() => makeAuthConfig({})).toThrow(/LOCAL_SHELL_MCP_HTTP_PATH/);
  });

  it("rejects short secrets", () => {
    expect(() =>
      makeAuthConfig({
        LOCAL_SHELL_MCP_HTTP_PATH: "/mcp",
        LOCAL_SHELL_MCP_HTTP_TOKEN: TOKEN_SECRET,
      }),
    ).toThrow(/at least/);
  });

  it("rejects a path that is not absolute", () => {
    expect(() =>
      makeAuthConfig({
        LOCAL_SHELL_MCP_HTTP_PATH: "mcp/".padEnd(40, "b"),
        LOCAL_SHELL_MCP_HTTP_TOKEN: TOKEN_SECRET,
      }),
    ).toThrow(/must start with/);
  });

  it("normalises a trailing slash", () => {
    const parsed = makeAuthConfig({
      LOCAL_SHELL_MCP_HTTP_PATH: `${PATH_SECRET}/`,
      LOCAL_SHELL_MCP_HTTP_TOKEN: TOKEN_SECRET,
    });

    expect(parsed.path).toBe(PATH_SECRET);
  });
});

describe("secretEquals", () => {
  it("accepts an exact match and rejects near misses", () => {
    expect(secretEquals(TOKEN_SECRET, TOKEN_SECRET)).toBe(true);
    expect(secretEquals(`${TOKEN_SECRET}x`, TOKEN_SECRET)).toBe(false);
    expect(secretEquals(TOKEN_SECRET.toUpperCase(), TOKEN_SECRET)).toBe(false);
    expect(secretEquals("", TOKEN_SECRET)).toBe(false);
  });
});

describe("bearerToken", () => {
  it("extracts the token regardless of header casing and spacing", () => {
    expect(bearerToken(`Bearer ${TOKEN_SECRET}`)).toBe(TOKEN_SECRET);
    expect(bearerToken(`bearer  ${TOKEN_SECRET}`)).toBe(TOKEN_SECRET);
    expect(bearerToken(undefined)).toBeUndefined();
    expect(bearerToken(TOKEN_SECRET)).toBeUndefined();
    expect(bearerToken("Basic abc")).toBeUndefined();
  });
});

describe("Host header handling", () => {
  it("strips ports and matches the configured allowlist", () => {
    const http = makeHttpConfig({ LOCAL_SHELL_MCP_HTTP_ALLOWED_HOSTS: "Shell.Example.Com" });

    expect(hostnameOf("127.0.0.1:8792")).toBe("127.0.0.1");
    expect(hostnameOf("[::1]:8792")).toBe("[::1]");
    expect(isAllowedHost("shell.example.com", http)).toBe(true);
    expect(isAllowedHost("127.0.0.1:8792", http)).toBe(true);
    expect(isAllowedHost("evil.example.net", http)).toBe(false);
    expect(isAllowedHost(undefined, http)).toBe(false);
  });
});

// Remove `.skip` once `authorize()` in src/auth.ts is implemented. The cases
// below are the intended contract, not a fixed answer: adjust the expected
// status codes if the chosen policy answers differently (e.g. 404 instead of
// 405 for an unexpected method).
describe("authorize", () => {
  const good = {
    method: "POST",
    path: PATH_SECRET,
    authorizationHeader: `Bearer ${TOKEN_SECRET}`,
    remoteAddress: "127.0.0.1",
  };

  it("allows a correct path with a correct token", () => {
    expect(authorize(good, config)).toEqual({ allowed: true });
  });

  it("denies a wrong path even with a correct token", () => {
    const decision = authorize({ ...good, path: "/mcp/wrong" }, config);
    expect(decision.allowed).toBe(false);
  });

  it("denies a correct path with a wrong token", () => {
    const decision = authorize({ ...good, authorizationHeader: "Bearer nope" }, config);
    expect(decision.allowed).toBe(false);
  });

  it("denies a correct path with no Authorization header", () => {
    const decision = authorize({ ...good, authorizationHeader: undefined }, config);
    expect(decision.allowed).toBe(false);
  });

  it("does not treat a path prefix as a match", () => {
    const decision = authorize({ ...good, path: `${PATH_SECRET}extra` }, config);
    expect(decision.allowed).toBe(false);
  });

  it("gives every credential failure the same client-visible answer", () => {
    const failures = [
      authorize({ ...good, path: "/mcp/wrong" }, config),
      authorize({ ...good, authorizationHeader: "Bearer nope" }, config),
      authorize({ ...good, authorizationHeader: undefined }, config),
      authorize({ ...good, remoteAddress: "203.0.113.7" }, config),
    ];

    for (const failure of failures) {
      expect(failure).toMatchObject({ allowed: false, status: 404, reason: "not found" });
    }
  });

  it("tells the operator which capability failed, without echoing secrets", () => {
    const reasons = [
      authorize({ ...good, remoteAddress: "203.0.113.7" }, config),
      authorize({ ...good, authorizationHeader: undefined }, config),
      authorize({ ...good, authorizationHeader: "Bearer nope" }, config),
      authorize({ ...good, path: "/mcp/wrong" }, config),
    ].map((decision) => (decision.allowed ? "" : decision.logReason));

    expect(new Set(reasons).size).toBe(reasons.length);
    for (const reason of reasons) {
      expect(reason).not.toContain(TOKEN_SECRET);
      expect(reason).not.toContain(PATH_SECRET);
    }
  });

  it("allows the streamable-HTTP session methods", () => {
    expect(authorize({ ...good, method: "GET" }, config).allowed).toBe(true);
    expect(authorize({ ...good, method: "DELETE" }, config).allowed).toBe(true);
  });
});
