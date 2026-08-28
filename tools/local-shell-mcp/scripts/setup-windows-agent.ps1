param(
  [string]$AgentUser = "ai-agent",
  [string]$DataRoot = "C:\ai-agent-data",
  [string[]]$WritableRoots = @("C:\dev", "C:\agents")
)

$ErrorActionPreference = "Stop"

function Assert-Administrator {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = [Security.Principal.WindowsPrincipal]::new($identity)
  if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw "Run this script from an elevated PowerShell session."
  }
}

Assert-Administrator

try {
  $null = Get-LocalUser -Name $AgentUser -ErrorAction Stop
} catch {
  throw "Local user '$AgentUser' does not exist. Create it as a standard (non-Administrator) user first."
}

$dataDirectories = @(
  $DataRoot,
  (Join-Path $DataRoot "tmp"),
  (Join-Path $DataRoot "home"),
  (Join-Path $DataRoot "npm-cache"),
  (Join-Path $DataRoot "logs")
)

foreach ($directory in $dataDirectories) {
  New-Item -ItemType Directory -Path $directory -Force | Out-Null
}

$rootsToGrant = @($WritableRoots + $DataRoot) | Select-Object -Unique
foreach ($root in $rootsToGrant) {
  if (-not (Test-Path -LiteralPath $root)) {
    Write-Warning "Skipping missing path: $root"
    continue
  }

  Write-Host "Granting Modify to ${AgentUser}: $root"
  & icacls.exe $root /grant "${AgentUser}:(OI)(CI)M" /T /C | Out-Host
  if ($LASTEXITCODE -ne 0) {
    throw "icacls failed for $root with exit code $LASTEXITCODE"
  }
}

Write-Host ""
Write-Host "Writable development roots configured."
Write-Host "Security boundary: run local-shell-mcp as the standard user '$AgentUser'."
Write-Host "This script intentionally does NOT weaken ACLs on Windows system directories or another user's profile."
Write-Host "Protect especially sensitive locations (SSH keys, cloud credentials, browser profiles, password stores, private keys) by removing read access for '$AgentUser' where necessary."
Write-Host ""
Write-Host "Recommended MCP environment:"
Write-Host "  LOCAL_SHELL_MCP_DATA_DIR=$DataRoot"
