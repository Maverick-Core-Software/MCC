#Requires -Version 7.0
<#
.SYNOPSIS
  Read-only report of pm2 daemon processes (node running pm2\lib\Daemon.js).
  Never kills anything; always exits 0. Empty table is a valid result.
#>

try {
    $procs = Get-CimInstance Win32_Process -Filter "Name like 'node%'" -ErrorAction Stop |
        Where-Object { $_.CommandLine -match 'pm2\\lib\\Daemon\.js' }

    $parentIds = @{}
    foreach ($p in Get-CimInstance Win32_Process -ErrorAction SilentlyContinue) {
        if ($p.ParentProcessId) { $parentIds[$p.ParentProcessId] = $true }
    }

    $rows = foreach ($p in $procs) {
        [pscustomobject]@{
            PID        = $p.ProcessId
            StartTime  = $p.CreationDate
            ParentPID  = $p.ParentProcessId
            HasChildren = $parentIds.ContainsKey([int]$p.ProcessId)
        }
    }

    if ($rows) {
        $rows | Format-Table -AutoSize
        Write-Host "$($rows.Count) pm2 daemon process(es) found."
    } else {
        Write-Host 'No pm2 daemon processes found.'
    }
} catch {
    Write-Host "Report failed (non-fatal): $($_.Exception.Message)"
}
exit 0
