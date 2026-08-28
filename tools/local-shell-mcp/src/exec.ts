import { spawn } from "node:child_process";
import { stat } from "node:fs/promises";
import path from "node:path";

import { buildChildEnv, type RuntimeConfig } from "./config.js";

export type SupportedShell = "powershell" | "bash";

export interface ExecInput {
  shell: SupportedShell;
  command: string;
  cwd: string;
  timeoutMs?: number;
}

export interface ExecResult {
  shell: SupportedShell;
  cwd: string;
  command: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
  durationMs: number;
  stdout: string;
  stderr: string;
  stdoutBytes: number;
  stderrBytes: number;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
}

export interface SpawnSpec {
  executable: string;
  args: string[];
}

export function buildSpawnSpec(shell: SupportedShell, command: string, config: RuntimeConfig): SpawnSpec {
  if (shell === "powershell") {
    return {
      executable: config.powershellExecutable,
      args: ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", command],
    };
  }

  return {
    executable: config.bashExecutable,
    args: ["--noprofile", "--norc", "-lc", command],
  };
}

function createOutputCollector(maxBytes: number): {
  push: (chunk: Buffer | string) => void;
  finish: () => { text: string; bytes: number; truncated: boolean };
} {
  const chunks: Buffer[] = [];
  let storedBytes = 0;
  let totalBytes = 0;
  let truncated = false;

  return {
    push(chunk) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      totalBytes += buffer.byteLength;

      const remaining = maxBytes - storedBytes;
      if (remaining <= 0) {
        truncated = true;
        return;
      }

      if (buffer.byteLength <= remaining) {
        chunks.push(buffer);
        storedBytes += buffer.byteLength;
        return;
      }

      chunks.push(buffer.subarray(0, remaining));
      storedBytes += remaining;
      truncated = true;
    },
    finish() {
      return {
        text: Buffer.concat(chunks).toString("utf8"),
        bytes: totalBytes,
        truncated,
      };
    },
  };
}

function killProcessTree(pid: number): void {
  if (process.platform === "win32") {
    const killer = spawn("taskkill.exe", ["/PID", String(pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true,
      shell: false,
    });
    killer.unref();
    return;
  }

  try {
    process.kill(-pid, "SIGTERM");
  } catch {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      return;
    }
  }

  const forceKill = setTimeout(() => {
    try {
      process.kill(-pid, "SIGKILL");
    } catch {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        // Process already exited.
      }
    }
  }, 1_500);
  forceKill.unref();
}

async function validateCwd(cwd: string): Promise<string> {
  if (!path.isAbsolute(cwd)) {
    throw new Error(`cwd must be an absolute path: ${cwd}`);
  }

  const resolved = path.resolve(cwd);
  const info = await stat(resolved);
  if (!info.isDirectory()) {
    throw new Error(`cwd is not a directory: ${resolved}`);
  }

  return resolved;
}

export async function runCommand(input: ExecInput, config: RuntimeConfig): Promise<ExecResult> {
  if (input.command.trim().length === 0) {
    throw new Error("command must not be empty");
  }

  const cwd = await validateCwd(input.cwd);
  const timeoutMs = input.timeoutMs ?? config.defaultTimeoutMs;

  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new Error("timeoutMs must be a positive integer");
  }
  if (timeoutMs > config.maxTimeoutMs) {
    throw new Error(`timeoutMs exceeds configured maximum of ${config.maxTimeoutMs}ms`);
  }

  const spec = buildSpawnSpec(input.shell, input.command, config);
  const stdout = createOutputCollector(config.maxOutputBytes);
  const stderr = createOutputCollector(config.maxOutputBytes);
  const startedAt = Date.now();
  let timedOut = false;

  const child = spawn(spec.executable, spec.args, {
    cwd,
    env: buildChildEnv(config),
    windowsHide: true,
    shell: false,
    detached: process.platform !== "win32",
    stdio: ["ignore", "pipe", "pipe"],
  });

  child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
  child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));

  const timer = setTimeout(() => {
    timedOut = true;
    if (child.pid !== undefined) {
      killProcessTree(child.pid);
    }
  }, timeoutMs);
  timer.unref();

  try {
    const { exitCode, signal } = await new Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }>(
      (resolve, reject) => {
        child.once("error", reject);
        child.once("close", (exitCode, signal) => resolve({ exitCode, signal }));
      },
    );

    const stdoutResult = stdout.finish();
    const stderrResult = stderr.finish();

    return {
      shell: input.shell,
      cwd,
      command: input.command,
      exitCode,
      signal,
      timedOut,
      durationMs: Date.now() - startedAt,
      stdout: stdoutResult.text,
      stderr: stderrResult.text,
      stdoutBytes: stdoutResult.bytes,
      stderrBytes: stderrResult.bytes,
      stdoutTruncated: stdoutResult.truncated,
      stderrTruncated: stderrResult.truncated,
    };
  } finally {
    clearTimeout(timer);
  }
}
