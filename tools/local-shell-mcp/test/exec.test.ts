import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { ensureRuntimeDirectories, makeRuntimeConfig } from "../src/config.js";
import { buildSpawnSpec, runCommand } from "../src/exec.js";

const cleanupPaths: string[] = [];

async function testConfig() {
  const dataDir = await mkdtemp(path.join(tmpdir(), "local-shell-mcp-test-"));
  cleanupPaths.push(dataDir);
  const config = makeRuntimeConfig({
    ...process.env,
    LOCAL_SHELL_MCP_DATA_DIR: dataDir,
    LOCAL_SHELL_MCP_DEFAULT_TIMEOUT_MS: "2000",
    LOCAL_SHELL_MCP_MAX_TIMEOUT_MS: "5000",
  });
  await ensureRuntimeDirectories(config);
  return config;
}

afterEach(async () => {
  await Promise.all(cleanupPaths.splice(0).map((entry) => rm(entry, { recursive: true, force: true })));
});

describe("buildSpawnSpec", () => {
  it("does not insert an additional command shell", async () => {
    const config = await testConfig();
    const spec = buildSpawnSpec("powershell", "Write-Output ok", config);

    expect(spec.executable).toBe(config.powershellExecutable);
    expect(spec.args.at(-1)).toBe("Write-Output ok");
  });
});

describe("runCommand", () => {
  it("rejects relative cwd values", async () => {
    const config = await testConfig();

    await expect(
      runCommand({ shell: "bash", command: "echo ok", cwd: "." }, config),
    ).rejects.toThrow(/absolute path/);
  });

  it("rejects timeouts above the configured maximum", async () => {
    const config = await testConfig();

    await expect(
      runCommand(
        {
          shell: "bash",
          command: "echo ok",
          cwd: path.resolve(tmpdir()),
          timeoutMs: config.maxTimeoutMs + 1,
        },
        config,
      ),
    ).rejects.toThrow(/configured maximum/);
  });

  it("executes a command and captures output", async () => {
    const config = await testConfig();
    const shell = process.platform === "win32" ? "powershell" : "bash";
    const command = process.platform === "win32" ? "Write-Output ok" : "printf 'ok\\n'";

    const result = await runCommand(
      { shell, command, cwd: path.resolve(tmpdir()) },
      config,
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe("ok");
    expect(result.timedOut).toBe(false);
  });

  it("terminates a command after timeout", async () => {
    const config = await testConfig();
    const shell = process.platform === "win32" ? "powershell" : "bash";
    const command = process.platform === "win32" ? "Start-Sleep -Seconds 5" : "sleep 5";

    const result = await runCommand(
      {
        shell,
        command,
        cwd: path.resolve(tmpdir()),
        timeoutMs: 100,
      },
      config,
    );

    expect(result.timedOut).toBe(true);
  });
});
