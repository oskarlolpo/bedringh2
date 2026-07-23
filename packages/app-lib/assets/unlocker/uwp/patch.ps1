param (
    [Parameter(Mandatory=$true)]
    [string]$Action,
    [Parameter(Mandatory=$true)]
    [string]$WorkDir
)

$sys32Path = "C:\Windows\System32\Windows.ApplicationModel.Store.dll"
$sysWowPath = "C:\Windows\SysWOW64\Windows.ApplicationModel.Store.dll"

$backupSys32 = Join-Path $WorkDir "backups\System32.dll"
$backupSysWow = Join-Path $WorkDir "backups\SysWOW64.dll"

$crackSys32 = Join-Path $WorkDir "System32\Windows.ApplicationModel.Store.dll"
$crackSysWow = Join-Path $WorkDir "SysWOW64\Windows.ApplicationModel.Store.dll"

# Ensure backups dir exists
$backupDir = Join-Path $WorkDir "backups"
if (!(Test-Path $backupDir)) {
    New-Item -ItemType Directory -Force -Path $backupDir | Out-Null
}

function Take-Ownership ($Path) {
    if (Test-Path $Path) {
        takeown /f $Path /a | Out-Null
        # *S-1-5-32-544 = Administrators in any locale
        # *S-1-1-0 = Everyone
        icacls $Path /grant "*S-1-5-32-544:F" /grant "*S-1-1-0:F" /c /q | Out-Null
    }
}

function Safe-Replace ($Source, $Dest) {
    Take-Ownership $Dest
    if (Test-Path $Dest) {
        # Rename existing file out of the way (bypasses "in-use" locks by Explorer/Svchost)
        $oldPath = "$Dest.old.$(Get-Date -UFormat %s)"
        Move-Item -Path $Dest -Destination $oldPath -Force -ErrorAction SilentlyContinue | Out-Null
    }
    if (Test-Path $Source) {
        Copy-Item -Path $Source -Destination $Dest -Force
    }
}

if ($Action -eq "Enable") {
    # Backup if not already backed up
    if (!(Test-Path $backupSys32)) {
        if (Test-Path $sys32Path) { Copy-Item -Path $sys32Path -Destination $backupSys32 -Force }
    }
    if (!(Test-Path $backupSysWow)) {
        if (Test-Path $sysWowPath) { Copy-Item -Path $sysWowPath -Destination $backupSysWow -Force }
    }

    # Take ownership and replace
    Safe-Replace $crackSys32 $sys32Path
    Safe-Replace $crackSysWow $sysWowPath

    Add-MpPreference -ExclusionPath $sys32Path -ErrorAction SilentlyContinue
    Add-MpPreference -ExclusionPath $sysWowPath -ErrorAction SilentlyContinue

} elseif ($Action -eq "Disable") {
    # Restore from backup
    if (Test-Path $backupSys32) {
        Safe-Replace $backupSys32 $sys32Path
    }
    if (Test-Path $backupSysWow) {
        Safe-Replace $backupSysWow $sysWowPath
    }
}
