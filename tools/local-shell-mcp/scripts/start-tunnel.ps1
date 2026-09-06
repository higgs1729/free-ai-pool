param(
  [int]$Port = 8792,
  [string]$TokenFile = "C:\ai-agent-data\local-shell-mcp.cf.env",
  [string]$WorkerConfig = "$PSScriptRoot\..\cloudflare\wrangler.toml",
  [int]$StartupTimeoutSec = 60
)

# Starts a TryCloudflare quick tunnel and pushes its freshly minted hostname to
# the Worker as ORIGIN_BASE, so the URL never has to be copied by hand.
#
# Requires a Cloudflare API token with only "Workers Scripts: Edit", stored as
#   CLOUDFLARE_API_TOKEN=...
# in $TokenFile (or already present in the environment).

$ErrorActionPreference = "Stop"

function Get-Cloudflared {
  $command = (Get-Command cloudflared -ErrorAction SilentlyContinue).Source
  if ($command) {
    return $command
  }

  $fallback = "C:\Program Files (x86)\cloudflared\cloudflared.exe"
  if (Test-Path $fallback) {
    return $fallback
  }

  throw "cloudflared not found. Install it with: winget install --id Cloudflare.cloudflared"
}

function Get-ApiToken {
  param([string]$Path)

  if ($env:CLOUDFLARE_API_TOKEN) {
    return $env:CLOUDFLARE_API_TOKEN
  }

  if (-not (Test-Path $Path)) {
    throw "No API token. Create one in the Cloudflare dashboard with 'Workers Scripts: Edit' only, then write CLOUDFLARE_API_TOKEN=<token> to $Path"
  }

  foreach ($line in Get-Content $Path) {
    if ($line.Trim().StartsWith("CLOUDFLARE_API_TOKEN=")) {
      return $line.Trim().Substring("CLOUDFLARE_API_TOKEN=".Length).Trim()
    }
  }

  throw "$Path does not contain CLOUDFLARE_API_TOKEN=<token>"
}

# cloudflared prints the hostname inside a drawn box, which is exactly what makes
# copying it by hand error-prone. Reading it from the log removes that step.
function Find-TunnelUrl {
  param([string[]]$Lines)

  foreach ($line in $Lines) {
    $match = [regex]::Match($line, 'https://[a-z0-9-]+\.trycloudflare\.com')
    if ($match.Success) {
      return $match.Value
    }
  }

  return $null
}

function Set-OriginBase {
  param([string]$Url, [string]$Token, [string]$ConfigPath)

  $previousToken = $env:CLOUDFLARE_API_TOKEN
  $env:CLOUDFLARE_API_TOKEN = $Token
  try {
    $Url | npx wrangler secret put ORIGIN_BASE --config $ConfigPath
    if ($LASTEXITCODE -ne 0) {
      throw "wrangler secret put failed with exit code $LASTEXITCODE"
    }
  } finally {
    $env:CLOUDFLARE_API_TOKEN = $previousToken
  }
}

# Restart policy state. A quick tunnel has no availability guarantee, so an
# unattended drop should recover — but a tunnel that cannot stay up must not
# silently republish a new hostname every few seconds.
$script:RestartCount = 0
$script:MaxRestarts = 3
$script:HealthyUptimeSec = 60
$script:ForgivenUptimeSec = 3600

<#
  Decides what happens when cloudflared exits.

  Three rules, in order:

  1. A clean exit (code 0) is deliberate — Ctrl+C — so stop.
  2. An exit after less than $HealthyUptimeSec means the tunnel never became
     healthy. Restarting would be a tight failure loop, so stop and say why.
  3. Otherwise restart, at most $MaxRestarts times. A tunnel that stayed up for
     $ForgivenUptimeSec was genuinely healthy, so its budget is refilled — a
     machine left running for weeks should not exhaust three lifetime restarts.
#>
function Invoke-TunnelExitPolicy {
  param([int]$ExitCode, [int]$UptimeSeconds, [string]$LastUrl)

  Write-Host ""
  Write-Host "Tunnel exited (code $ExitCode) after $UptimeSeconds seconds."

  if ($ExitCode -eq 0) {
    Write-Host "Clean exit; not restarting."
    return $false
  }

  if ($UptimeSeconds -lt $script:HealthyUptimeSec) {
    Write-Host "It stayed up for less than $($script:HealthyUptimeSec)s, so this is a failure loop rather than a dropped tunnel."
    Write-Host "Not restarting. Check that local-shell-mcp is listening, then run this script again."
    return $false
  }

  if ($UptimeSeconds -ge $script:ForgivenUptimeSec -and $script:RestartCount -gt 0) {
    Write-Host "It had been healthy for over $($script:ForgivenUptimeSec)s; restart budget refilled."
    $script:RestartCount = 0
  }

  if ($script:RestartCount -ge $script:MaxRestarts) {
    Write-Host "Already restarted $($script:RestartCount) times without a lasting tunnel. Not restarting again."
    Write-Host "The public MCP endpoint stays broken until this script is run again - that is deliberate, so the instability is visible."
    return $false
  }

  $script:RestartCount++
  Write-Host "Restarting (attempt $($script:RestartCount) of $($script:MaxRestarts)) in 5 seconds..."
  Start-Sleep -Seconds 5

  return $true
}

function Start-Tunnel {
  param([string]$Cloudflared, [int]$Port, [string]$Token, [string]$ConfigPath, [int]$TimeoutSec)

  $stdoutFile = Join-Path $env:TEMP "local-shell-mcp-tunnel.out.log"
  $stderrFile = Join-Path $env:TEMP "local-shell-mcp-tunnel.err.log"
  Set-Content -Path $stdoutFile -Value "" -Encoding ascii
  Set-Content -Path $stderrFile -Value "" -Encoding ascii

  $arguments = @(
    "tunnel",
    "--url", "http://127.0.0.1:$Port",
    "--http-host-header", "127.0.0.1:$Port"
  )

  Write-Host "Starting quick tunnel to http://127.0.0.1:$Port ..."
  $process = Start-Process -FilePath $Cloudflared -ArgumentList $arguments `
    -RedirectStandardOutput $stdoutFile -RedirectStandardError $stderrFile `
    -NoNewWindow -PassThru

  $startedAt = Get-Date
  $url = $null

  while (-not $url) {
    if ($process.HasExited) {
      throw "cloudflared exited before publishing a hostname. See $stderrFile"
    }
    if (((Get-Date) - $startedAt).TotalSeconds -gt $TimeoutSec) {
      $null = $process.Kill()
      throw "No trycloudflare.com hostname appeared within ${TimeoutSec}s. See $stderrFile"
    }

    Start-Sleep -Milliseconds 500
    $lines = @()
    $lines += Get-Content $stdoutFile -ErrorAction SilentlyContinue
    $lines += Get-Content $stderrFile -ErrorAction SilentlyContinue
    $url = Find-TunnelUrl -Lines $lines
  }

  Write-Host "Tunnel is up: $url"
  Write-Host "Publishing it to the Worker as ORIGIN_BASE ..."
  Set-OriginBase -Url $url -Token $Token -ConfigPath $ConfigPath

  Write-Host ""
  Write-Host "Ready. The Worker endpoint URL is unchanged."
  Write-Host "Press Ctrl+C to stop the tunnel."
  Write-Host ""

  $process.WaitForExit()

  return [pscustomobject]@{
    ExitCode      = $process.ExitCode
    UptimeSeconds = [int]((Get-Date) - $startedAt).TotalSeconds
    Url           = $url
  }
}

$cloudflared = Get-Cloudflared
$token = Get-ApiToken -Path $TokenFile
$configPath = (Resolve-Path $WorkerConfig).Path

do {
  $result = Start-Tunnel -Cloudflared $cloudflared -Port $Port -Token $token -ConfigPath $configPath -TimeoutSec $StartupTimeoutSec
  $restart = Invoke-TunnelExitPolicy -ExitCode $result.ExitCode -UptimeSeconds $result.UptimeSeconds -LastUrl $result.Url
} while ($restart)
