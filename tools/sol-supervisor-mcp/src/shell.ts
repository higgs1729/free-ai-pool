import { spawn } from "node:child_process";
import { stat } from "node:fs/promises";
import path from "node:path";

export type SupportedShell = "powershell" | "bash";

export interface ExecInput {
  shell: SupportedShell;
  command: string;
  cwd: string;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = Number(process.env.SOL_SUPERVISOR_EXEC_TIMEOUT_MS ?? 30_000);
const MAX_TIMEOUT_MS = Number(process.env.SOL_SUPERVISOR_EXEC_MAX_TIMEOUT_MS ?? 50_000);
const MAX_OUTPUT_BYTES = Number(process.env.SOL_SUPERVISOR_MAX_OUTPUT_BYTES ?? 1_000_000);

function collector(maxBytes: number) {
  const chunks: Buffer[] = [];
  let stored = 0;
  let total = 0;
  let truncated = false;

  return {
    push(chunk: Buffer | string) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      total += buffer.byteLength;
      const remaining = maxBytes - stored;
      if (remaining <= 0) {
        truncated = true;
        return;
      }
      if (buffer.byteLength <= remaining) {
        chunks.push(buffer);
        stored += buffer.byteLength;
      } else {
        chunks.push(buffer.subarray(0, remaining));
        stored += remaining;
        truncated = true;
      }
    },
    finish() {
      return { text: Buffer.concat(chunks).toString("utf8"), bytes: total, truncated };
    },
  };
}

function killTree(pid: number): void {
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
}

async function validatedCwd(cwd: string): Promise<string> {
  if (!path.isAbsolute(cwd)) throw new Error(`cwd must be absolute: ${cwd}`);
  const resolved = path.resolve(cwd);
  const info = await stat(resolved);
  if (!info.isDirectory()) throw new Error(`cwd is not a directory: ${resolved}`);
  return resolved;
}

export async function runCommand(input: ExecInput) {
  const cwd = await validatedCwd(input.cwd);
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > MAX_TIMEOUT_MS) {
    throw new Error(`timeoutMs must be an integer between 1 and ${MAX_TIMEOUT_MS}`);
  }

  const spec = input.shell === "powershell"
    ? { executable: process.env.SOL_SUPERVISOR_POWERSHELL ?? "powershell.exe", args: ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", input.command] }
    : { executable: process.env.SOL_SUPERVISOR_BASH ?? "bash", args: ["--noprofile", "--norc", "-lc", input.command] };

  const stdout = collector(MAX_OUTPUT_BYTES);
  const stderr = collector(MAX_OUTPUT_BYTES);
  const startedAt = Date.now();
  let timedOut = false;

  const child = spawn(spec.executable, spec.args, {
    cwd,
    env: process.env,
    windowsHide: true,
    shell: false,
    detached: process.platform !== "win32",
    stdio: ["ignore", "pipe", "pipe"],
  });

  child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
  child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));

  const timer = setTimeout(() => {
    timedOut = true;
    if (child.pid !== undefined) killTree(child.pid);
  }, timeoutMs);
  timer.unref();

  try {
    const { exitCode, signal } = await new Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (exitCode, signal) => resolve({ exitCode, signal }));
    });
    const out = stdout.finish();
    const err = stderr.finish();
    return {
      shell: input.shell,
      cwd,
      command: input.command,
      exitCode,
      signal,
      timedOut,
      durationMs: Date.now() - startedAt,
      stdout: out.text,
      stderr: err.text,
      stdoutBytes: out.bytes,
      stderrBytes: err.bytes,
      stdoutTruncated: out.truncated,
      stderrTruncated: err.truncated,
    };
  } finally {
    clearTimeout(timer);
  }
}
