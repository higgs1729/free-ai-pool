# local-shell-mcp

Local MCP server that gives an AI agent direct PowerShell/Bash execution on the host machine.

This package currently lives under `free-ai-pool/tools/local-shell-mcp` only because Git operations are temporarily inconvenient. It is intentionally self-contained and is planned to be extracted later into its own repository named `local-shell-mcp`.

## Security model

`local-shell-mcp` deliberately does **not** pretend that `cwd` or command filtering is a sandbox.

The real security boundary is the Windows user running this MCP server plus NTFS ACLs:

- run the server as a dedicated **standard (non-Administrator) user**, e.g. `ai-agent`;
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

1. Create a dedicated standard Windows user named `ai-agent` (or choose another name).
2. From an elevated PowerShell, run:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\setup-windows-agent.ps1 -AgentUser ai-agent
```

The setup script creates `C:\ai-agent-data` and grants the account Modify rights to `C:\dev`, `C:\agents`, and the data directory. It does not make the account an Administrator and does not weaken Windows system-directory ACLs.

Review the ACLs of important personal/credential directories separately and remove the agent account's access where appropriate.

## Install and build

From this directory:

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

## Extraction to its own repository

This directory has its own `package.json`, `tsconfig.json`, source, tests, scripts and documentation and does not import `free-ai-pool` internals. It can therefore later be moved directly into the root of a new `local-shell-mcp` repository. Git history can also be preserved later with subtree/filtering tools if desired.
