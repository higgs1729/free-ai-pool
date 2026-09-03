import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const port = 18788;
const base = `http://127.0.0.1:${port}`;
const runtimeDir = await mkdtemp(path.join(os.tmpdir(), "sol-supervisor-smoke-"));

const child = spawn(process.execPath, ["dist/index.js"], {
  env: {
    ...process.env,
    SOL_SUPERVISOR_PORT: String(port),
    SOL_SUPERVISOR_RUNTIME_DIR: runtimeDir,
  },
  stdio: ["ignore", "pipe", "pipe"],
});

let stderr = "";
child.stderr.on("data", (chunk) => {
  stderr += chunk.toString();
});

async function waitForHealth() {
  const deadline = Date.now() + 8_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${base}/healthz`);
      if (response.ok) return;
    } catch {
      // Server may still be starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`server did not become healthy; stderr=${stderr}`);
}

try {
  await waitForHealth();

  const eventResponse = await fetch(`${base}/event`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ type: "smoke", summary: "smoke event", payload: { ok: true } }),
  });
  if (eventResponse.status !== 201) {
    throw new Error(`event endpoint failed: ${eventResponse.status} ${await eventResponse.text()}`);
  }

  const listResponse = await fetch(`${base}/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  });
  const listText = await listResponse.text();
  if (!listResponse.ok || !listText.includes("await_event") || !listText.includes("exec") || !listText.includes("ping")) {
    throw new Error(`MCP tools/list failed: ${listResponse.status} ${listText}`);
  }

  console.log("sol-supervisor-mcp smoke passed");
} finally {
  child.kill("SIGTERM");
  await new Promise((resolve) => {
    const timer = setTimeout(resolve, 2_000);
    child.once("close", () => {
      clearTimeout(timer);
      resolve();
    });
  });
  await rm(runtimeDir, { recursive: true, force: true });
}
