# local-shell-mcp — Handoff

Updated: 2026-08-28

## Current status

CI is green ✅

Verified on Node 24:

- dependency install ✅
- TypeScript typecheck ✅
- Vitest ✅
- build ✅
- existing `free-ai-pool` CI also remains green ✅

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

The real boundary is a dedicated standard Windows account (default name in docs/scripts: `ai-agent`) plus NTFS ACLs.

Current policy:

- the agent is not an Administrator;
- `C:\dev` and `C:\agents` are explicitly writable;
- `C:\ai-agent-data` is writable scratch/cache storage;
- the account otherwise has the normal permissions of a standard Windows user;
- important personal data is protected with ACLs;
- SSH keys, cloud credentials, browser profiles, password stores and private keys should ideally be unreadable by the agent account.

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

1. ✅ CI green (`typecheck`, tests, build) — completed 2026-08-28.
2. **NEXT:** On the Windows machine, create/choose the dedicated standard account.
3. Run `scripts/setup-windows-agent.ps1` from elevated PowerShell.
4. Install/build the package under the dedicated account.
5. Register the built stdio server in the intended MCP client.
6. Run real Windows E2E: `git status`, file write under `C:\dev`, npm test/build, timeout test, and denied-access test against a protected directory.
7. Once Git is convenient again, extract this directory into repository `local-shell-mcp`.
