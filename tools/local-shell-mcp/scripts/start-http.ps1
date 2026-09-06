param(
  [string]$EnvFile = "C:\ai-agent-data\local-shell-mcp.http.env",
  [int]$Port = 8792,
  [string]$DataDir = "C:\ai-agent-data",
  [string]$AllowedHosts = ""
)

# Starts the MCP server on the loopback HTTP transport, reading the secrets
# written by scripts/new-http-secrets.ps1. Keep this window open: it is the
# server, and its output is where denied requests are explained.

$ErrorActionPreference = "Stop"

if (-not (Test-Path $EnvFile)) {
  throw "$EnvFile not found. Run scripts/new-http-secrets.ps1 first."
}

foreach ($line in Get-Content $EnvFile) {
  $trimmed = $line.Trim()
  if ($trimmed -eq "" -or $trimmed.StartsWith("#")) {
    continue
  }

  $separator = $trimmed.IndexOf("=")
  if ($separator -lt 1) {
    continue
  }

  $name = $trimmed.Substring(0, $separator).Trim()
  $value = $trimmed.Substring($separator + 1).Trim()
  Set-Item -Path "env:$name" -Value $value
}

foreach ($required in @("LOCAL_SHELL_MCP_HTTP_PATH", "LOCAL_SHELL_MCP_HTTP_TOKEN")) {
  if (-not (Get-Item -Path "env:$required" -ErrorAction SilentlyContinue)) {
    throw "$required is missing from $EnvFile."
  }
}

$env:LOCAL_SHELL_MCP_TRANSPORT = "http"
$env:LOCAL_SHELL_MCP_HTTP_PORT = "$Port"
$env:LOCAL_SHELL_MCP_DATA_DIR = $DataDir

if ($AllowedHosts -ne "") {
  $env:LOCAL_SHELL_MCP_HTTP_ALLOWED_HOSTS = $AllowedHosts
}

$entry = Join-Path $PSScriptRoot "..\dist\index.js"
if (-not (Test-Path $entry)) {
  throw "dist/index.js not found. Run 'npm run build' first."
}

Write-Host "Starting local-shell-mcp on http://127.0.0.1:$Port$($env:LOCAL_SHELL_MCP_HTTP_PATH)"
Write-Host "Press Ctrl+C to stop."
Write-Host ""

node $entry
