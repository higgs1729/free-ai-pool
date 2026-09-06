# local-shell-mcp — Handoff

Updated: 2026-09-06

## Current status

CI is green ✅

Verified on Node 24:

- dependency install ✅
- TypeScript typecheck ✅
- Vitest ✅
- build ✅
- existing `free-ai-pool` CI also remains green ✅
- repository docs and setup script now default to the existing `hermes` account ✅
- host ACL setup completed: `hermes` has Modify access to `C:\dev`, `C:\agents`, and `C:\ai-agent-data` ✅

**Next session should start from Windows host setup / ACL configuration.**

## Decision

Build a local MCP server that exposes direct PowerShell/Bash execution to AI clients.

Temporary location:

```text
free-ai-pool/tools/local-shell-mcp
```

Planned final repository name:

```text
local-shell-mcp
```

The package is intentionally standalone so it can be extracted later without depending on `free-ai-pool` internals.

## Security boundary

Do not treat `cwd` or command filtering as a sandbox.

The real boundary is a dedicated standard Windows account (default name in docs/scripts: `hermes`) plus NTFS ACLs.

Current policy:

- the agent is not an Administrator;
- `C:\dev` and `C:\agents` are explicitly writable;
- `C:\ai-agent-data` is writable scratch/cache storage;
- the account otherwise has the normal permissions of a standard Windows user;
- important personal data is protected with ACLs;
- SSH keys, cloud credentials, browser profiles, password stores and private keys should ideally be unreadable by the agent account.

The current Windows host already has the `hermes` account. It is enabled, belongs only to
the built-in `Users` group, and is not a member of `Administrators`. The account already
has explicit Modify access to `C:\dev` and `C:\agents`. Keep `C:\ai-agent-data` separate
from the Hermes canonical home at `C:\hermes-data`.

The host also leaves an inherited `Authenticated Users: Modify` entry on these roots,
matching the current ACLs of `C:\dev`, `C:\agents`, and `C:\hermes-data`. This means the
current setup matches the existing Hermes deployment, but is not a hermes-only write
boundary; tightening inherited ACLs is a separate security-hardening decision.

## Implemented MCP API

```ts
exec({
  shell: "powershell" | "bash",
  command: string,
  cwd: string,
  timeoutMs?: number
})
```

Implemented safeguards/limits:

- absolute `cwd` required;
- direct child-process spawn (`shell: false` at Node layer);
- PowerShell starts `-NoProfile -NonInteractive`;
- Bash starts `--noprofile --norc -lc`;
- default timeout 120s;
- maximum timeout 600s;
- stdout/stderr capture capped independently at 2 MiB;
- process-tree termination on timeout;
- stdin disabled;
- stdout reserved for MCP stdio transport;
- parent environment is filtered by default;
- explicit env passthrough supported;
- `TEMP`, `TMP`, `HOME`, npm cache redirected under the data directory.

## Files

```text
tools/local-shell-mcp/
├─ package.json
├─ tsconfig.json
├─ README.md
├─ HANDOFF.md
├─ src/
│  ├─ config.ts
│  ├─ exec.ts
│  └─ index.ts
├─ test/
│  └─ exec.test.ts
└─ scripts/
   └─ setup-windows-agent.ps1
```

CI workflow:

```text
.github/workflows/local-shell-mcp.yml
```

## Next steps

Done:

1. CI green (typecheck, tests, build); `hermes` account and host ACLs verified.
2. Codex registration added and then removed on 2026-09-05: Codex has its own
   shell tool.
3. HTTP transport, `authorize()` and the Cloudflare Worker edge built and
   verified end to end on 2026-09-05 (`scripts/test-endpoint.ps1`: two PASS
   through `workers.dev` -> quick tunnel -> `127.0.0.1:8792`).
4. That path cannot serve ChatGPT: a custom connector offers only `OAuth`,
   `none` or `both`, with no API-key option, so it cannot send the bearer token
   both layers require.
5. **ChatGPT now connects through OpenAI's Secure MCP Tunnel**, driving the
   **stdio** server. `tunnel-client` 0.0.14 was built from source to
   `C:/ai-agent-data/bin/tunnel-client.exe` (Go was installed for this; the
   published archive ships no Windows binary). The connector was created
   successfully on 2026-09-06.
6. The HTTP transport and the Worker are kept, not deleted. README positions
   them as a general-purpose public-HTTP option for bearer-capable clients.
7. Real E2E on 2026-09-06: `git status` PASS, write/read/delete under `C:/dev`
   PASS, and command timeout PASS (`timedOut: true`). PowerShell scripts also
   parse cleanly.
8. `install-autostart.ps1` registered the per-user `local-shell-mcp-tunnel`
   logon task with `RunLevel Limited`. Task Scheduler still reports `0x41303`
   (has not run yet), so autostart must be verified at the next real logon.

Open:

9. **Denied-access E2E remains.** The current tunnel runs as the interactive
   Windows account, not `hermes`, so a test now would not validate the documented
   dedicated-account ACL boundary.
10. **Cloudflare teardown.** While the Worker and its quick tunnel stay
    deployed, an internet-facing entrance to `exec` remains. Delete the Worker
    (`npx wrangler delete` from `cloudflare/`), revoke the `Workers Scripts:
    Edit` API token, and remove `C:/ai-agent-data/local-shell-mcp.cf.env`.
    `local-shell-mcp.http.env` can stay if the HTTP path may be used again.
11. `exec` runs as whoever starts `tunnel-client`, currently the interactive
    account. Running it as `hermes` is what makes the documented OS/ACL boundary
    real; decide whether to do that.
12. Once Git is convenient again, extract this directory into repository
    `local-shell-mcp`.
