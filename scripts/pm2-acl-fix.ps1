#Requires -Version 7.0
<#
.SYNOPSIS
  Repair ownership/ACLs on C:\ProgramData\pm2, or report them (default).
.PARAMETER Apply
  Without -Apply: report-only, prints owner and ACLs for key paths.
  With -Apply: take ownership for 'carte', grant Full control to carte/SYSTEM/
  Administrators, disable inheritance (copying ACEs), remove BUILTIN\Users ACEs.
#>
[CmdletBinding()]
param([switch]$Apply)

$ErrorActionPreference = 'Stop'
$Root = 'C:\ProgramData\pm2'
$Targets = @(
    $Root
    "$Root\dump.pm2"
    "$Root\dump.pm2.bak"
    "$Root\pm2.pid"
    "$Root\module_conf.json"
)

# --- (a) Elevation gate: refuse everything without Administrators ---
$principal = [Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    [Console]::Error.WriteLine('ERROR: elevation required. Re-run from an elevated PowerShell (Run as Administrator).')
    exit 1
}

function Show-AclReport([string]$Label) {
    Write-Host "=== $Label ==="
    foreach ($p in $Targets) {
        if (-not (Test-Path -LiteralPath $p)) {
            Write-Host "`n-- $p -- (missing)"
            continue
        }
        $owner = (Get-Acl -LiteralPath $p).Owner
        Write-Host "`n-- $p -- owner: $owner"
        icacls $p
    }
}

# --- (b) Report-only default ---
Show-AclReport 'BEFORE'
if (-not $Apply) {
    Write-Host "`nReport-only mode. Re-run with -Apply to repair ownership/ACLs."
    exit 0
}

# --- (c) Apply: ownership -> grants -> inheritance off -> strip Users ---
Write-Host "`n=== APPLYING FIX ==="
takeown /F $Root /R /D Y | Out-Null
icacls $Root /setowner carte /T /C
icacls $Root /grant 'carte:(OI)(CI)F' 'SYSTEM:(OI)(CI)F' 'BUILTIN\Administrators:(OI)(CI)F' /T /C
icacls $Root /inheritance:d
icacls $Root /remove:g 'BUILTIN\Users' /T /C
icacls $Root /remove:d 'BUILTIN\Users' /T /C

# --- (d) After summary ---
Show-AclReport 'AFTER'
Write-Host "`nDone."
exit 0
