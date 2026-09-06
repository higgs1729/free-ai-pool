param(
  [string]$EnvFile = "C:\ai-agent-data\local-shell-mcp.http.env",
  [switch]$Force
)

# Generates the two secrets the HTTP transport needs and stores them outside the
# repository. The same two values are later handed to the Cloudflare Worker as
# MCP_PATH and MCP_TOKEN.

$ErrorActionPreference = "Stop"

if ((Test-Path $EnvFile) -and (-not $Force)) {
  throw "$EnvFile already exists. Pass -Force to replace the secrets (this invalidates the deployed Worker secrets and any bearer-capable client configuration)."
}

function New-RandomBytes {
  param([int]$Count)

  $bytes = New-Object byte[] $Count
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try {
    $rng.GetBytes($bytes)
  } finally {
    $rng.Dispose()
  }

  return $bytes
}

function ConvertTo-Base64Url {
  param([byte[]]$Bytes)

  return [Convert]::ToBase64String($Bytes).Replace('+', '-').Replace('/', '_').TrimEnd('=')
}

$pathBytes = New-RandomBytes -Count 24
$pathHex = -join ($pathBytes | ForEach-Object { $_.ToString("x2") })
$mcpPath = "/mcp/$pathHex"
$mcpToken = ConvertTo-Base64Url -Bytes (New-RandomBytes -Count 32)

$directory = Split-Path -Parent $EnvFile
if (-not (Test-Path $directory)) {
  $null = New-Item -ItemType Directory -Force -Path $directory
}

$lines = @(
  "LOCAL_SHELL_MCP_HTTP_PATH=$mcpPath",
  "LOCAL_SHELL_MCP_HTTP_TOKEN=$mcpToken"
)
Set-Content -Path $EnvFile -Value $lines -Encoding ascii

# The file is a credential. Drop inherited access and keep it to this account.
$null = icacls $EnvFile /inheritance:r /grant:r "$($env:USERNAME):(R,W)" 2>&1

Write-Host ""
Write-Host "Wrote $EnvFile"
Write-Host ""
Write-Host "MCP_PATH   $mcpPath"
Write-Host "MCP_TOKEN  $mcpToken"
Write-Host ""
Write-Host "Paste MCP_PATH and MCP_TOKEN into 'wrangler secret put'. Configure MCP_TOKEN"
Write-Host "only in a bearer-capable client. Do not paste either secret into chat."
