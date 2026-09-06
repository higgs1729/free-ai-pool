param(
  [Parameter(Mandatory = $true)][string]$BaseUrl,
  [string]$EnvFile = "C:\ai-agent-data\local-shell-mcp.http.env",
  [int]$TimeoutSec = 30
)

# Checks the whole chain (edge -> tunnel -> local server) before an MCP client is
# involved, so a failure can be attributed to one hop instead of three.
#
#   powershell -ExecutionPolicy Bypass -File .\scripts\test-endpoint.ps1 -BaseUrl https://local-shell-mcp-edge.<subdomain>.workers.dev

$ErrorActionPreference = "Stop"

if (-not (Test-Path $EnvFile)) {
  throw "$EnvFile not found. Run scripts/new-http-secrets.ps1 first."
}

$secrets = @{}
foreach ($line in Get-Content $EnvFile) {
  $trimmed = $line.Trim()
  if ($trimmed -eq "" -or $trimmed.StartsWith("#")) {
    continue
  }

  $separator = $trimmed.IndexOf("=")
  if ($separator -lt 1) {
    continue
  }

  $secrets[$trimmed.Substring(0, $separator).Trim()] = $trimmed.Substring($separator + 1).Trim()
}

$mcpPath = $secrets["LOCAL_SHELL_MCP_HTTP_PATH"]
$mcpToken = $secrets["LOCAL_SHELL_MCP_HTTP_TOKEN"]

if (-not $mcpPath -or -not $mcpToken) {
  throw "$EnvFile is missing LOCAL_SHELL_MCP_HTTP_PATH or LOCAL_SHELL_MCP_HTTP_TOKEN."
}

$uri = $BaseUrl.TrimEnd('/') + $mcpPath

Write-Host "Endpoint: $($BaseUrl.TrimEnd('/'))<secret path>"
Write-Host ""

# 1. An unauthenticated request must be refused before it reaches anything.
$anonymousStatus = curl.exe -s -o NUL -w "%{http_code}" --max-time $TimeoutSec -X POST $uri -H "Content-Type: application/json" -d "{}"

if ($anonymousStatus -eq "404") {
  Write-Host "[PASS] unauthenticated request refused (404)"
} else {
  Write-Host "[FAIL] unauthenticated request returned $anonymousStatus, expected 404"
}

# 2. An authenticated initialize must reach the local server and come back.
$body = @{
  jsonrpc = "2.0"
  id      = 1
  method  = "initialize"
  params  = @{
    protocolVersion = "2025-06-18"
    capabilities    = @{}
    clientInfo      = @{ name = "test-endpoint"; version = "0" }
  }
} | ConvertTo-Json -Depth 10 -Compress

$response = $body | curl.exe -s --max-time $TimeoutSec -X POST $uri `
  -H "Authorization: Bearer $mcpToken" `
  -H "Content-Type: application/json" `
  -H "Accept: application/json, text/event-stream" `
  --data-binary "@-"

if ($response -match "local-shell-mcp") {
  Write-Host "[PASS] authenticated initialize reached the local server"
  Write-Host ""
  Write-Host "The chain works. A bearer-capable client can now use the Worker URL."
} elseif ([string]::IsNullOrWhiteSpace($response)) {
  Write-Host "[FAIL] no response within ${TimeoutSec}s"
  Write-Host ""
  Write-Host "Check, in order: the start-http.ps1 window, the cloudflared window,"
  Write-Host "then 'npx wrangler tail' for the edge."
} else {
  Write-Host "[FAIL] unexpected response:"
  Write-Host $response
  Write-Host ""
  Write-Host "A 404 here usually means ORIGIN_BASE, MCP_PATH or MCP_TOKEN in the"
  Write-Host "Worker no longer matches $EnvFile."
}
