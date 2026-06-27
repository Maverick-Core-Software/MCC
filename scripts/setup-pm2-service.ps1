<#
  setup-pm2-service.ps1
  ----------------------------------------------------------------------------
  Make PM2 — and therefore MCC (mav-console) and the rest of the stack — a real
  Windows service that the Service Control Manager keeps alive. This REPLACES the
  old "PM2 Resurrect On Boot" scheduled task, which only fired at boot (and never
  actually ran) and did nothing when the daemon died mid-session.

  What it does:
    - creates a dedicated, service-owned PM2 home at C:\ProgramData\pm2 so the
      service's daemon never collides with a user-context `pm2`,
    - sets a machine-wide PM2_HOME so your own shells talk to the same daemon,
    - migrates the current process list (from ecosystem.config.cjs) into that home,
    - installs an NSSM service "PM2" (LocalSystem, automatic start) that runs
      scripts/pm2-service-supervisor.cjs to resurrect + self-heal the daemon,
    - configures crash recovery so a dead supervisor is restarted.

  RUN ONCE from an *elevated* PowerShell. Re-running is safe (idempotent).

  After this, manage apps with the service. If you add/remove a PM2 app, run:
      $env:PM2_HOME='C:\ProgramData\pm2'; pm2 start <ecosystem>; pm2 save
  so the dump the service resurrects stays current.
#>

$ErrorActionPreference = 'Stop'

# --- Review these ------------------------------------------------------------
$ServiceName  = 'PM2'
$ServiceHome  = 'C:\ProgramData\pm2'
$RepoDir      = 'C:\Workspace\Active\MCC'
$Ecosystem    = Join-Path $RepoDir 'ecosystem.config.cjs'
$Supervisor   = Join-Path $RepoDir 'scripts\pm2-service-supervisor.cjs'
$NodeExe      = (Get-Command node -ErrorAction Stop).Source
$Pm2Js        = Join-Path $env:APPDATA 'npm\node_modules\pm2\bin\pm2'
# -----------------------------------------------------------------------------

# Must be elevated.
if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
        ).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Run this from an elevated (Administrator) PowerShell.'
}

# Resolve nssm: prefer one already on PATH/ProgramData, else the winget install.
$nssm = (Get-Command nssm -ErrorAction SilentlyContinue).Source
if (-not $nssm) { $nssm = Join-Path $ServiceHome 'nssm.exe' }
if (-not (Test-Path $nssm)) {
    $found = Get-ChildItem "$env:LOCALAPPDATA\Microsoft\WinGet" -Recurse -Filter nssm.exe -ErrorAction SilentlyContinue |
        Where-Object { $_.FullName -match 'win64' } | Select-Object -First 1 -ExpandProperty FullName
    if (-not $found) { throw "nssm.exe not found. Install with: winget install --id NSSM.NSSM" }
    $nssm = $found
}
foreach ($p in @($Ecosystem, $Supervisor, $Pm2Js)) {
    if (-not (Test-Path $p)) { throw "Required path missing: $p" }
}

# 1. Service home + a stable copy of nssm.exe (winget paths can move on update).
New-Item -ItemType Directory -Force -Path $ServiceHome | Out-Null
$nssmStable = Join-Path $ServiceHome 'nssm.exe'
if ($nssm -ne $nssmStable) { Copy-Item $nssm $nssmStable -Force }
$nssm = $nssmStable

# 2. Machine-wide PM2_HOME so service and user shells share one daemon.
[Environment]::SetEnvironmentVariable('PM2_HOME', $ServiceHome, 'Machine')
$env:PM2_HOME = $ServiceHome

# 3. Migrate the process list into the service home, then stop that daemon so the
#    service can own the ports. (Kill any prior user-home daemon first to free
#    ports — brief downtime is expected here.)
Write-Host 'Stopping any existing PM2 daemon to free ports...'
& $NodeExe $Pm2Js kill 2>&1 | Out-Null
Start-Sleep -Seconds 2
Write-Host "Populating $ServiceHome from $Ecosystem ..."
& $NodeExe $Pm2Js start $Ecosystem 2>&1 | Out-Null
Start-Sleep -Seconds 3
& $NodeExe $Pm2Js save 2>&1 | Out-Null
Write-Host 'Stopping the populate daemon; the service will own it from here.'
& $NodeExe $Pm2Js kill 2>&1 | Out-Null
Start-Sleep -Seconds 2

# 4. (Re)install the NSSM service.
if (Get-Service -Name $ServiceName -ErrorAction SilentlyContinue) {
    Write-Host "Removing existing '$ServiceName' service..."
    & $nssm stop   $ServiceName 2>&1 | Out-Null
    & $nssm remove $ServiceName confirm 2>&1 | Out-Null
    Start-Sleep -Seconds 2
}
Write-Host "Installing '$ServiceName' service..."
& $nssm install $ServiceName $NodeExe $Supervisor
& $nssm set $ServiceName AppDirectory $ServiceHome
& $nssm set $ServiceName AppEnvironmentExtra "PM2_HOME=$ServiceHome" "PM2_JS=$Pm2Js"
& $nssm set $ServiceName Start SERVICE_AUTO_START
& $nssm set $ServiceName AppStdout (Join-Path $ServiceHome 'service.out.log')
& $nssm set $ServiceName AppStderr (Join-Path $ServiceHome 'service.err.log')
& $nssm set $ServiceName AppRotateFiles 1
& $nssm set $ServiceName AppRotateBytes 5242880
# Restart the supervisor if it exits; throttle so a hard-failing config backs off.
& $nssm set $ServiceName AppExit Default Restart
& $nssm set $ServiceName AppRestartDelay 5000
& $nssm set $ServiceName AppThrottle 10000
& $nssm set $ServiceName DisplayName 'PM2 (Maverick stack)'
& $nssm set $ServiceName Description 'Keeps the PM2 daemon (MCC / mav-console + stack) alive and resurrected.'

# 5. Retire the old boot-only scheduled task if present.
if (Get-ScheduledTask -TaskName 'PM2 Resurrect On Boot' -ErrorAction SilentlyContinue) {
    Write-Host "Removing superseded scheduled task 'PM2 Resurrect On Boot'..."
    Unregister-ScheduledTask -TaskName 'PM2 Resurrect On Boot' -Confirm:$false
}

# 6. Start it.
Write-Host "Starting '$ServiceName'..."
& $nssm start $ServiceName 2>&1 | Out-Null

Write-Host ''
Write-Host "Done. Verify with:"
Write-Host "  Get-Service $ServiceName"
Write-Host "  `$env:PM2_HOME='$ServiceHome'; pm2 ls"
Write-Host "Service runs as LocalSystem. To run apps under your own account instead,"
Write-Host "set the '$ServiceName' service logon account in services.msc."
