param(
  [string]$EnvFile = "C:\ai-agent-data\local-shell-mcp.tunnel.env",
  [string]$TunnelClient = "C:\ai-agent-data\bin\tunnel-client.exe",
  [string]$NodeExecutable = "node",
  [string]$DataDir = "C:\ai-agent-data",
  [string]$HealthAddr = "127.0.0.1:8791",
  [string]$LogFile = ""
)

# Single command that brings up the ChatGPT path: runs tunnel-client, which
# launches the stdio MCP server as a child process and polls the OpenAI control
# plane for work. No listener is opened to the outside.
#
# $EnvFile holds the two values that identify this tunnel:
#
#   CONTROL_PLANE_TUNNEL_ID=tunnel_...
#   CONTROL_PLANE_API_KEY=...
#
# Get both from https://platform.openai.com/settings/organization (Tunnels
# management, and a runtime API key with Tunnels Read + Use).

$ErrorActionPreference = "Stop"

if ($LogFile -ne "") {
  $logDirectory = Split-Path -Parent $LogFile
  if ($logDirectory -and -not (Test-Path $logDirectory)) {
    $null = New-Item -ItemType Directory -Force -Path $logDirectory
  }
  Start-Transcript -Path $LogFile -Append | Out-Null
}

try {
  if (-not (Test-Path $TunnelClient)) {
    throw "tunnel-client not found at $TunnelClient"
  }

  if (-not (Test-Path $EnvFile)) {
    throw @"
$EnvFile not found. Create it with these two lines:

  CONTROL_PLANE_TUNNEL_ID=tunnel_...
  CONTROL_PLANE_API_KEY=...

The tunnel id comes from Tunnels management and the key from Runtime API keys at
https://platform.openai.com/settings/organization
"@
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

    Set-Item -Path ("env:" + $trimmed.Substring(0, $separator).Trim()) -Value $trimmed.Substring($separator + 1).Trim()
  }

  foreach ($required in @("CONTROL_PLANE_TUNNEL_ID", "CONTROL_PLANE_API_KEY")) {
    if (-not (Get-Item -Path "env:$required" -ErrorAction SilentlyContinue)) {
      throw "$required is missing from $EnvFile."
    }
  }

  $entry = (Resolve-Path (Join-Path $PSScriptRoot "..\dist\index.js")).Path.Replace('\', '/')
  $env:LOCAL_SHELL_MCP_DATA_DIR = $DataDir

  # stdio: tunnel-client owns the MCP server's lifetime, so exec runs as whoever
  # runs this script.
  $mcpCommand = "command=$NodeExecutable $entry"

  Write-Host "Starting tunnel-client"
  Write-Host "  tunnel   $($env:CONTROL_PLANE_TUNNEL_ID)"
  Write-Host "  mcp      $NodeExecutable $entry"
  Write-Host "  health   http://$HealthAddr/healthz  (UI at /ui)"
  Write-Host ""

  & $TunnelClient run `
    --control-plane.tunnel-id $env:CONTROL_PLANE_TUNNEL_ID `
    --control-plane.api-key "env:CONTROL_PLANE_API_KEY" `
    --mcp.command $mcpCommand `
    --health.listen-addr $HealthAddr

  $exitCode = $LASTEXITCODE
  Write-Host "tunnel-client exited with code $exitCode"
  exit $exitCode
} finally {
  if ($LogFile -ne "") {
    Stop-Transcript | Out-Null
  }
}
