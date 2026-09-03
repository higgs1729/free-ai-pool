# sol-supervisor-mcp

Minimal PoC bridge for turning a **normal ChatGPT GPT-5.6 Sol High conversation** into a local supervisor that can wait for work, react to local events, and execute commands on the PC.

This is intentionally not a full control plane. It tests only the critical path:

```text
Sol High normal chat
  -> ChatGPT Developer Mode custom MCP
  -> Secure MCP Tunnel / remote MCP connection
  -> this localhost HTTP MCP
  -> event queue + unrestricted local shell
```

## What is implemented

MCP endpoint: `http://127.0.0.1:8788/mcp`

Tools:

- `ping` - confirms the bridge is reachable and reports queue state.
- `await_event` - short long-poll, max 45 seconds by default. Heartbeats are deliberately shorter than typical ChatGPT MCP request timeouts.
- `emit_event` - puts work into the queue from MCP itself, useful for tests/handoffs.
- `exec` - arbitrary PowerShell/Bash using this server process's OS permissions. There is no app-level sandbox in this PoC.

Local helper endpoints:

- `GET /healthz`
- `POST /event` - inject an event from OpenClaw, another agent, script, or terminal.

Events persist at `.runtime/sol-supervisor/events.jsonl` by default. State does not depend on an MCP session surviving.

## Install and run

From the repository root on the target PC:

```powershell
cd tools/sol-supervisor-mcp
npm install
npm run typecheck
npm run build
npm start
```

Development mode:

```powershell
npm run dev
```

Expected startup message on stderr:

```text
sol-supervisor-mcp listening on http://127.0.0.1:8788/mcp
```

Health check:

```powershell
Invoke-RestMethod http://127.0.0.1:8788/healthz
```

## Inject a PoC event

From a second PowerShell window:

```powershell
$body = @{
  type = "poc"
  summary = "External event reached the Sol supervisor"
  payload = @{ source = "powershell" }
} | ConvertTo-Json

Invoke-RestMethod `
  -Uri http://127.0.0.1:8788/event `
  -Method Post `
  -ContentType "application/json" `
  -Body $body
```

Optional local event endpoint token:

```powershell
$env:SOL_SUPERVISOR_EVENT_TOKEN = "replace-me"
```

Then send `Authorization: Bearer replace-me` to `/event`.

## Connect ChatGPT

The intended path is ChatGPT **normal chat**, GPT-5.6 **Sol High**, Developer Mode, with this server registered as a custom MCP app. For a local/private server, prefer OpenAI Secure MCP Tunnel rather than binding this service to a public interface.

Point the ChatGPT MCP connection/tunnel at:

```text
http://127.0.0.1:8788/mcp
```

Keep this server bound to `127.0.0.1` unless you deliberately add network-layer protection.

After connecting the MCP app, use [`SUPERVISOR_PROMPT.md`](./SUPERVISOR_PROMPT.md).

## Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `SOL_SUPERVISOR_HOST` | `127.0.0.1` | HTTP bind address |
| `SOL_SUPERVISOR_PORT` | `8788` | HTTP port |
| `SOL_SUPERVISOR_RUNTIME_DIR` | `.runtime/sol-supervisor` | Persistent event queue directory |
| `SOL_SUPERVISOR_MAX_WAIT_SECONDS` | `45` | Maximum `await_event` blocking duration |
| `SOL_SUPERVISOR_EVENT_TOKEN` | unset | Optional bearer token for local `/event` injection |
| `SOL_SUPERVISOR_EXEC_TIMEOUT_MS` | `30000` | Default synchronous shell timeout |
| `SOL_SUPERVISOR_EXEC_MAX_TIMEOUT_MS` | `50000` | Maximum synchronous shell timeout |
| `SOL_SUPERVISOR_MAX_OUTPUT_BYTES` | `1000000` | Capture limit per stdout/stderr stream |
| `SOL_SUPERVISOR_POWERSHELL` | `powershell.exe` | PowerShell executable |
| `SOL_SUPERVISOR_BASH` | `bash` | Bash executable |

## Why waits are short

The objective is not to hold one MCP request open for ten minutes. The supervisor prompt makes Sol repeatedly call `await_event` inside the same assistant execution:

```text
await_event(40s)
  -> heartbeat
  -> await_event(40s)
  -> heartbeat
  -> await_event(40s)
  -> EVENT
  -> act
  -> await_event(40s)
```

That is the hypothesis this PoC exists to test.

## Long-running local work

Do not make `exec` itself wait for multi-minute jobs. Launch long work in the background, let the command return quickly, and have the worker publish an event when it finishes. This keeps individual MCP calls comfortably below host-side timeouts.

Example shape on PowerShell:

```powershell
Start-Process powershell.exe -ArgumentList '-NoProfile','-Command','<long command>'
```

The eventual worker can notify the supervisor with `POST /event`.

## Security model for this PoC

`exec` is intentionally powerful. `cwd` is only a starting directory; it is **not** a sandbox. The OS account running this service and its filesystem ACLs are the actual boundary.

The server defaults to loopback only. Do not expose port 8788 directly to an untrusted network.

## PoC acceptance criteria

See [`SUPERVISOR_PROMPT.md`](./SUPERVISOR_PROMPT.md). The key result is whether a normal Sol High chat can stay in a repeated tool loop, wake on an externally injected event, act on the PC, then return to waiting without another human message.
