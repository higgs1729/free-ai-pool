# local-shell-mcp

Local MCP server that gives an AI agent direct PowerShell/Bash execution on the host machine.

This package currently lives under `free-ai-pool/tools/local-shell-mcp` only because Git operations are temporarily inconvenient. It is intentionally self-contained and is planned to be extracted later into its own repository named `local-shell-mcp`.

## Security model

`local-shell-mcp` deliberately does **not** pretend that `cwd` or command filtering is a sandbox.

The real security boundary is the Windows user running this MCP server plus NTFS ACLs:

- run the server as the existing dedicated **standard (non-Administrator) user** `hermes`;
- `C:\dev` and `C:\agents` are explicitly writable development roots;
- `C:\ai-agent-data` is writable scratch/cache/home data for agent-launched processes;
- the agent otherwise receives the normal permissions of its standard Windows account;
- important human-owned data should be protected with NTFS ACLs;
- highly sensitive data such as SSH keys, cloud credentials, browser profiles, password stores and private keys should ideally be unreadable by the agent account, not merely read-only.

Do not rely on `cwd` as a filesystem boundary. A command launched in `C:\dev` can still address another absolute path if the OS account has permission.

## MCP tool

The server exposes one intentionally powerful tool:

```ts
exec({
  shell: "powershell" | "bash",
  command: string,
  cwd: string,
  timeoutMs?: number
})
```

`cwd` must be absolute.

PowerShell is spawned directly as:

```text
powershell.exe -NoLogo -NoProfile -NonInteractive -Command <command>
```

Bash is spawned directly as:

```text
bash --noprofile --norc -lc <command>
```

No extra `cmd.exe`/shell layer is inserted by the MCP server. The supplied command is, by design, interpreted by the selected shell.

## Runtime limits

Defaults:

- default timeout: 120 seconds;
- maximum requested timeout: 10 minutes;
- captured stdout: 2 MiB;
- captured stderr: 2 MiB;
- stdin: closed/non-interactive;
- timeout termination targets the child process tree.

Output beyond the configured capture limit is discarded while byte counts and truncation flags are returned.

## Environment handling

By default the child process does **not** inherit every environment variable from the MCP server. This avoids accidentally handing API keys/tokens in the parent environment to arbitrary commands.

A small OS/runtime allowlist is inherited automatically. `TEMP`, `TMP`, `HOME`, and the npm cache are redirected under the configured data directory.

Configuration variables:

```text
LOCAL_SHELL_MCP_DATA_DIR=C:\ai-agent-data
LOCAL_SHELL_MCP_DEFAULT_TIMEOUT_MS=120000
LOCAL_SHELL_MCP_MAX_TIMEOUT_MS=600000
LOCAL_SHELL_MCP_MAX_OUTPUT_BYTES=2097152
LOCAL_SHELL_MCP_POWERSHELL=powershell.exe
LOCAL_SHELL_MCP_BASH=bash
LOCAL_SHELL_MCP_PASSTHROUGH_ENV=NAME1,NAME2
LOCAL_SHELL_MCP_INHERIT_ENV=false
```

Use `LOCAL_SHELL_MCP_PASSTHROUGH_ENV` for specific variables that commands genuinely need. Setting `LOCAL_SHELL_MCP_INHERIT_ENV=true` opts into full parent-environment inheritance and should be treated as a deliberate reduction in secret isolation.

## Windows setup

1. Use the existing dedicated standard Windows user `hermes` (or pass another verified standard-user name explicitly).
2. From an elevated PowerShell, run:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\setup-windows-agent.ps1 -AgentUser hermes
```

The setup script creates `C:\ai-agent-data` and grants `hermes` Modify rights to `C:\dev`, `C:\agents`, and the data directory. The existing `hermes` account is a standard, non-Administrator user; the script does not change that and does not weaken Windows system-directory ACLs.

Review the ACLs of important personal/credential directories separately and remove the agent account's access where appropriate.

## Install and build

Run these commands from a shell running as the dedicated `hermes` user:

```powershell
npm install
npm run typecheck
npm test
npm run build
```

Run over MCP stdio:

```powershell
node .\dist\index.js
```

A generic MCP client configuration after build looks like:

```json
{
  "command": "node",
  "args": [
    "C:\\dev\\free-ai-pool\\tools\\local-shell-mcp\\dist\\index.js"
  ],
  "env": {
    "LOCAL_SHELL_MCP_DATA_DIR": "C:\\ai-agent-data"
  }
}
```

The MCP host process itself must be launched under the intended dedicated Windows account for the OS/ACL boundary to have meaning.

## Connecting ChatGPT (Secure MCP Tunnel)

This is the supported path, and it needs no public listener at all.

A ChatGPT custom connector can authenticate only with OAuth or not at all — its
authentication menu offers `OAuth`, `none`, and `both`, with no API-key option — so it cannot send the bearer token this server expects. OpenAI's Secure MCP
Tunnel solves that differently: `tunnel-client` runs on this machine, makes an
outbound-only connection to an OpenAI-hosted endpoint, long-polls for queued
JSON-RPC requests, and forwards them to a local MCP server. Nothing listens on a
public address, and authentication is handled by the tunnel's own control plane.

The tunnel can drive a **stdio** MCP server, so it uses this package exactly as
built — no HTTP transport, no reverse proxy, and no shared secrets of our own.

Prerequisites, all from `https://platform.openai.com/settings/organization`:

- a provisioned `tunnel_id` (Tunnels management);
- a runtime API key whose principal has Tunnels **Read** + **Use**;
- the `tunnel-client` binary (download button on the Tunnels page).

```powershell
tunnel-client init --sample sample_mcp_stdio_local --profile local-shell --tunnel-id tunnel_... --mcp-command "node C:/dev/free-ai-pool/tools/local-shell-mcp/dist/index.js"
```

```powershell
tunnel-client doctor --profile local-shell --explain
```

```powershell
tunnel-client run --profile local-shell
```

Create the connector in ChatGPT only while `tunnel-client run` is healthy, and
keep it running: the daemon serves connector discovery and every subsequent tool
call. In the connector dialog choose **tunnel** rather than a server URL.

The trade-off worth stating plainly: the transport is operated by OpenAI rather
than by you. The public-HTTP path below keeps the whole route under your own
control, at the cost of an internet-facing entrance in front of `exec`.

### Start the Secure MCP Tunnel automatically at logon

For normal interactive use, `scripts/start-mcp-tunnel.ps1` loads the tunnel id
and API key from `C:\ai-agent-data\local-shell-mcp.tunnel.env`, then starts
`tunnel-client` and the stdio MCP child process.

To register a per-user logon task:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install-autostart.ps1
```

The task uses `RunLevel Limited` and the currently logged-in Windows account. It
deliberately does not run as SYSTEM. This means `exec` receives that account's
filesystem permissions. If the task is installed while logged in as a different
account from the intended dedicated agent account, the documented `hermes` ACL
boundary does **not** apply; install/run it under the account whose permissions
are intended to be the boundary.

The task writes its transcript to
`C:\ai-agent-data\logs\tunnel-client.log`. Verify at least one real logon before
relying on autostart (`Get-ScheduledTaskInfo -TaskName local-shell-mcp-tunnel`).

## Public HTTP exposure (optional)

**Not needed for ChatGPT** — use the Secure MCP Tunnel above. This section is for
MCP clients that can send an `Authorization: Bearer` header, and for the case
where the whole route must stay under your own control.

The server speaks HTTP when asked to:

```text
LOCAL_SHELL_MCP_TRANSPORT=http
```

The design is deliberately two-layer:

- **A — the Worker is the public edge.** The listener binds `127.0.0.1` only and
  is never configurable to anything else. Publishing happens through Cloudflare
  Tunnel; the Worker validates the bearer token and secret path before proxying.
- **C — an unguessable path plus a bearer token.** Defence in depth behind A, so
  that a misconfigured or bypassed tunnel does not immediately expose `exec`.

Neither layer is trusted to be the only one. `exec` is arbitrary code execution
as the user running the server; treat a leaked URL or token as a full host
compromise.

### HTTP configuration

```text
LOCAL_SHELL_MCP_TRANSPORT=http
LOCAL_SHELL_MCP_HTTP_PORT=8792
LOCAL_SHELL_MCP_HTTP_PATH=/mcp/<random>
LOCAL_SHELL_MCP_HTTP_TOKEN=<random>
LOCAL_SHELL_MCP_HTTP_ALLOWED_HOSTS=shell.example.com
```

Both secrets are required and must be at least 32 characters. Two scripts handle
them so the values never have to be typed by hand:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\new-http-secrets.ps1
```

That writes `C:\ai-agent-data\local-shell-mcp.http.env` (outside the repository,
ACL'd to the current account) and prints the two values used to configure the
Cloudflare Worker and a bearer-capable client. Then start the server with:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\start-http.ps1
```

`start-http.ps1` loads that file, sets the transport and port, and runs
`dist/index.js` in the foreground. Its window is where denied requests are
explained.

`LOCAL_SHELL_MCP_HTTP_ALLOWED_HOSTS` is the public tunnel hostname. Loopback names
are always accepted; anything else must be listed, which is what stops DNS
rebinding from reaching the handler. A request with an unexpected `Host` is
answered `421` before authorization runs.

Request handling order is: `Host` validation, then `authorize()` in `src/auth.ts`,
then the MCP handler. Nothing reaches `exec` before the authorization decision.

### Layer A: tunnel plus an edge bearer check

The tunnel only publishes the port; it authenticates nobody. A Cloudflare Access
service-token policy is not assumed here because generic MCP clients may not send
its proprietary `CF-Access-Client-Id` / `-Secret` headers. Instead, layer A is a
Worker that checks the same bearer token and secret path that the origin checks:

```text
Bearer-capable MCP client  ->  Worker (checks token + path)  ->  tunnel  ->  127.0.0.1:8792  ->  authorize()
```

Files in `cloudflare/`:

- `worker.js` — the edge check and proxy;
- `wrangler.toml` — Worker configuration;
- `tunnel-config.example.yml` — cloudflared ingress.

The Worker and the origin run the same two checks in the same order. That
duplication is deliberate: neither layer alone is trusted to be the only thing
between the internet and `exec`.

#### Option 1 - no domain required

A quick tunnel plus a `workers.dev` route needs no DNS zone.

```powershell
winget install --id Cloudflare.cloudflared
```

Deploy the Worker once (from `cloudflare/`), supplying the two secrets from the
env file and, for now, any placeholder origin:

```powershell
npx wrangler secret put MCP_PATH
```

```powershell
npx wrangler secret put MCP_TOKEN
```

```powershell
npx wrangler deploy
```

The public endpoint URL is then `https://local-shell-mcp-edge.<subdomain>.workers.dev<MCP_PATH>`.

A quick tunnel's hostname changes on every restart, and copying it by hand is
where this setup goes wrong - cloudflared prints it inside a drawn box, so a
stray `|` or a missing scheme is easy to paste. `scripts/start-tunnel.ps1` starts
the tunnel, reads the hostname out of cloudflared's own log, and publishes it to
the Worker as `ORIGIN_BASE` without any copying:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\start-tunnel.ps1
```

It needs a Cloudflare API token scoped to **Workers Scripts: Edit** and nothing
else, stored as a single line in `C:\ai-agent-data\local-shell-mcp.cf.env`:

```text
CLOUDFLARE_API_TOKEN=<token>
```

If the tunnel drops, the script restarts it up to three times, but only when it
had been up for at least a minute - an instant exit is a failure loop, not a
dropped tunnel, and restarting into one would hide the problem. A tunnel that
survived an hour has its restart budget refilled.

#### Option 2 - named tunnel on your own domain

Stable, and the right shape once this is routine: a quick tunnel's hostname
changes on every restart, and each change means re-putting `ORIGIN_BASE` by hand.

Only the tunnel side needs to move. The Worker stays on `workers.dev`, so the URL
used by a bearer-capable client does not change.

Requires a domain already added to your Cloudflare account.

```powershell
cloudflared tunnel login
```

```powershell
cloudflared tunnel create local-shell-mcp
```

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\new-tunnel-config.ps1 -Hostname shell.example.com
```

That reads the tunnel UUID and credentials path from `cloudflared tunnel list` and
writes `%USERPROFILE%\.cloudflared\config.yml`. Then:

```powershell
cloudflared tunnel route dns local-shell-mcp shell.example.com
```

```powershell
cloudflared tunnel run local-shell-mcp
```

Point the Worker at the stable hostname once:

```powershell
'https://shell.example.com' | npx wrangler secret put ORIGIN_BASE
```

```powershell
npx wrangler deploy
```

To stop babysitting the tunnel window, install it as a Windows service from an
elevated PowerShell (it then starts with the machine):

```powershell
cloudflared service install
```

`shell.example.com` is publicly reachable and reaches the origin without passing
through the Worker, so it is guarded by layer C alone. That is the same guarantee
the Worker checks, so nothing is lost relative to the quick-tunnel setup; keep the
origin hostname out of client configuration and out of anywhere it would be indexed.

### Registering a bearer-capable client

Point the client at the Worker URL including the secret path:

```text
https://local-shell-mcp-edge.<subdomain>.workers.dev/mcp/<random>
```

and configure it to send `Authorization: Bearer <LOCAL_SHELL_MCP_HTTP_TOKEN>`.
Both the Worker and `authorize()` check that header; a client that cannot send it
will be refused with `404` at the edge.

ChatGPT is not such a client — see the Secure MCP Tunnel section above.

The `exec` tool declares `destructiveHint: true` and no `readOnlyHint`, so a
well-behaved client treats every call as a write action and asks for confirmation
before running it.

### Diagnosing a rejected connector

Client-visible responses are uniform by design (`404 not found` for any credential
failure), so read the origin's stderr instead: it names which capability failed — missing header, wrong token, wrong path, non-loopback peer. If nothing appears
there at all, the request never left the Worker; check `wrangler tail`.

## Extraction to its own repository

This directory has its own `package.json`, `tsconfig.json`, source, tests, scripts and documentation and does not import `free-ai-pool` internals. It can therefore later be moved directly into the root of a new `local-shell-mcp` repository. Git history can also be preserved later with subtree/filtering tools if desired.
