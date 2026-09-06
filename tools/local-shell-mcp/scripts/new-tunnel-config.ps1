param(
  [Parameter(Mandatory = $true)][string]$Hostname,
  [string]$TunnelName = "local-shell-mcp",
  [int]$Port = 8792,
  [string]$ConfigFile = "$env:USERPROFILE\.cloudflared\config.yml",
  [switch]$Force
)

# Writes the cloudflared ingress configuration for a named tunnel, filling in the
# tunnel UUID and credentials path from `cloudflared tunnel list` so neither has
# to be transcribed by hand.
#
# Run `cloudflared tunnel login` and `cloudflared tunnel create <name>` first.

$ErrorActionPreference = "Stop"

$cloudflared = (Get-Command cloudflared -ErrorAction SilentlyContinue).Source
if (-not $cloudflared) {
  $fallback = "C:\Program Files (x86)\cloudflared\cloudflared.exe"
  if (Test-Path $fallback) {
    $cloudflared = $fallback
  } else {
    throw "cloudflared not found. Install it with: winget install --id Cloudflare.cloudflared"
  }
}

if ((Test-Path $ConfigFile) -and (-not $Force)) {
  throw "$ConfigFile already exists. Pass -Force to overwrite it."
}

$tunnels = & $cloudflared tunnel list --output json | ConvertFrom-Json
$tunnel = $tunnels | Where-Object { $_.name -eq $TunnelName } | Select-Object -First 1

if (-not $tunnel) {
  throw "No tunnel named '$TunnelName'. Create it first with: cloudflared tunnel create $TunnelName"
}

$tunnelId = $tunnel.id
$credentials = Join-Path (Split-Path -Parent $ConfigFile) "$tunnelId.json"

if (-not (Test-Path $credentials)) {
  throw "Credentials file not found at $credentials. Re-run: cloudflared tunnel create $TunnelName"
}

# httpHostHeader keeps the origin's Host allowlist at its loopback default, so
# the public hostname never has to be added to LOCAL_SHELL_MCP_HTTP_ALLOWED_HOSTS.
$lines = @(
  "tunnel: $tunnelId",
  "credentials-file: $credentials",
  "",
  "ingress:",
  "  - hostname: $Hostname",
  "    service: http://127.0.0.1:$Port",
  "    originRequest:",
  "      httpHostHeader: 127.0.0.1:$Port",
  "      connectTimeout: 10s",
  "  - service: http_status:404"
)

$directory = Split-Path -Parent $ConfigFile
if (-not (Test-Path $directory)) {
  $null = New-Item -ItemType Directory -Force -Path $directory
}

Set-Content -Path $ConfigFile -Value $lines -Encoding ascii

Write-Host ""
Write-Host "Wrote $ConfigFile"
Write-Host "  tunnel   $TunnelName ($tunnelId)"
Write-Host "  hostname $Hostname"
Write-Host "  origin   http://127.0.0.1:$Port"
Write-Host ""
Write-Host "Next:"
Write-Host "  cloudflared tunnel route dns $TunnelName $Hostname"
Write-Host "  cloudflared tunnel run $TunnelName"
Write-Host ""
Write-Host "Then point the Worker at it once:"
Write-Host "  'https://$Hostname' | npx wrangler secret put ORIGIN_BASE"
