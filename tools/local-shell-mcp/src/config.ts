import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

export interface RuntimeConfig {
  dataDir: string;
  tempDir: string;
  homeDir: string;
  npmCacheDir: string;
  logsDir: string;
  powershellExecutable: string;
  bashExecutable: string;
  defaultTimeoutMs: number;
  maxTimeoutMs: number;
  maxOutputBytes: number;
  inheritAllEnv: boolean;
  passthroughEnv: string[];
}

const SAFE_ENV_NAMES = [
  "PATH",
  "Path",
  "PATHEXT",
  "SystemRoot",
  "WINDIR",
  "COMSPEC",
  "OS",
  "USERNAME",
  "USERDOMAIN",
  "USERPROFILE",
  "HOMEDRIVE",
  "HOMEPATH",
  "APPDATA",
  "LOCALAPPDATA",
  "PROGRAMDATA",
  "ProgramFiles",
  "ProgramFiles(x86)",
  "ProgramW6432",
  "NUMBER_OF_PROCESSORS",
  "PROCESSOR_ARCHITECTURE",
  "PROCESSOR_IDENTIFIER",
  "LANG",
  "LC_ALL",
  "TERM",
  "WT_SESSION",
] as const;

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === "") {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`Expected a positive integer, got: ${value}`);
  }

  return parsed;
}

function parseBool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) {
    return fallback;
  }

  switch (value.trim().toLowerCase()) {
    case "1":
    case "true":
    case "yes":
    case "on":
      return true;
    case "0":
    case "false":
    case "no":
    case "off":
      return false;
    default:
      throw new Error(`Expected a boolean value, got: ${value}`);
  }
}

function parseCsv(value: string | undefined): string[] {
  if (!value) {
    return [];
  }

  return [...new Set(value.split(",").map((item) => item.trim()).filter(Boolean))];
}

export function makeRuntimeConfig(env: NodeJS.ProcessEnv = process.env): RuntimeConfig {
  const defaultDataDir = process.platform === "win32"
    ? "C:\\ai-agent-data"
    : path.join(homedir(), ".local-shell-mcp");

  const dataDir = path.resolve(env.LOCAL_SHELL_MCP_DATA_DIR ?? defaultDataDir);
  const defaultTimeoutMs = parsePositiveInt(env.LOCAL_SHELL_MCP_DEFAULT_TIMEOUT_MS, 120_000);
  const maxTimeoutMs = parsePositiveInt(env.LOCAL_SHELL_MCP_MAX_TIMEOUT_MS, 600_000);

  if (defaultTimeoutMs > maxTimeoutMs) {
    throw new Error("LOCAL_SHELL_MCP_DEFAULT_TIMEOUT_MS must be <= LOCAL_SHELL_MCP_MAX_TIMEOUT_MS");
  }

  return {
    dataDir,
    tempDir: path.join(dataDir, "tmp"),
    homeDir: path.join(dataDir, "home"),
    npmCacheDir: path.join(dataDir, "npm-cache"),
    logsDir: path.join(dataDir, "logs"),
    powershellExecutable:
      env.LOCAL_SHELL_MCP_POWERSHELL ?? (process.platform === "win32" ? "powershell.exe" : "pwsh"),
    bashExecutable: env.LOCAL_SHELL_MCP_BASH ?? "bash",
    defaultTimeoutMs,
    maxTimeoutMs,
    maxOutputBytes: parsePositiveInt(env.LOCAL_SHELL_MCP_MAX_OUTPUT_BYTES, 2 * 1024 * 1024),
    inheritAllEnv: parseBool(env.LOCAL_SHELL_MCP_INHERIT_ENV, false),
    passthroughEnv: parseCsv(env.LOCAL_SHELL_MCP_PASSTHROUGH_ENV),
  };
}

export async function ensureRuntimeDirectories(config: RuntimeConfig): Promise<void> {
  await Promise.all([
    mkdir(config.tempDir, { recursive: true }),
    mkdir(config.homeDir, { recursive: true }),
    mkdir(config.npmCacheDir, { recursive: true }),
    mkdir(config.logsDir, { recursive: true }),
  ]);
}

export function buildChildEnv(config: RuntimeConfig, source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const childEnv: NodeJS.ProcessEnv = config.inheritAllEnv ? { ...source } : {};

  if (!config.inheritAllEnv) {
    for (const name of SAFE_ENV_NAMES) {
      const value = source[name];
      if (value !== undefined) {
        childEnv[name] = value;
      }
    }
  }

  for (const name of config.passthroughEnv) {
    const value = source[name];
    if (value !== undefined) {
      childEnv[name] = value;
    }
  }

  childEnv.TEMP = config.tempDir;
  childEnv.TMP = config.tempDir;
  childEnv.HOME = config.homeDir;
  childEnv.npm_config_cache = config.npmCacheDir;

  return childEnv;
}
