param(
  [string]$TaskName = "local-shell-mcp-tunnel",
  [string]$LogFile = "C:\ai-agent-data\logs\tunnel-client.log",
  [switch]$Uninstall
)

# Registers a per-user scheduled task that starts the MCP tunnel at logon.
#
# Deliberately a logon trigger rather than a startup trigger: a startup task runs
# before anyone signs in, which on Windows means running as SYSTEM or storing an
# account password. exec would then run with those privileges. Tying it to the
# logon of this account keeps exec at exactly the privileges of the person who
# signed in - the same boundary the rest of this package assumes.

$ErrorActionPreference = "Stop"

if ($Uninstall) {
  if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    Write-Host "Removed scheduled task '$TaskName'."
  } else {
    Write-Host "No scheduled task named '$TaskName'."
  }
  return
}

$starter = (Resolve-Path (Join-Path $PSScriptRoot "start-mcp-tunnel.ps1")).Path

$arguments = @(
  "-NoProfile",
  "-ExecutionPolicy", "Bypass",
  "-WindowStyle", "Hidden",
  "-File", "`"$starter`"",
  "-LogFile", "`"$LogFile`""
) -join " "

$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $arguments
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited

# The tunnel is a long-lived poller: it must not be stopped for running long, and
# it should come back if it dies. It is not started on battery-saver rules either,
# because a laptop on battery is still a machine the connector is expected to reach.
$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -DontStopOnIdleEnd `
  -ExecutionTimeLimit ([TimeSpan]::Zero) `
  -RestartCount 3 `
  -RestartInterval (New-TimeSpan -Minutes 1) `
  -StartWhenAvailable

if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
}

$null = Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings

Write-Host ""
Write-Host "Registered scheduled task '$TaskName'."
Write-Host "  runs     $starter"
Write-Host "  trigger  at logon of $env:USERNAME"
Write-Host "  log      $LogFile"
Write-Host ""
Write-Host "Start it now without waiting for a logon:"
Write-Host "  Start-ScheduledTask -TaskName $TaskName"
Write-Host ""
Write-Host "Remove it:"
Write-Host "  powershell -ExecutionPolicy Bypass -File `"$PSCommandPath`" -Uninstall"
