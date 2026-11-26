<#
Deploys a release built by scripts\publish-iis.ps1 to the 1Reports server.
Run on the server in an Administrator PowerShell, AFTER a DBA has run in SSMS the SQL the release needs
(scripts\create-*.sql for each new migration), then pass -DatabaseUpdated to confirm. For example:
  & '\\tsclient\D\SSSSS\EFI Reports\scripts\deploy-release.ps1' -Release '\\tsclient\D\SSSSS\EFI Reports\publish\release-<name>' -DatabaseUpdated

The script verifies every release file against its manifest, stops the app pool, backs up and replaces
only the files that changed (never web.config or appsettings*.json, which belong to the server), removes
retired frontend assets, and starts the pool again. It does not rebuild the Crystal worker.
If anything fails after the pool stops, the site files are restored from the backup automatically.
#>
[CmdletBinding()]
param(
    [switch]$DatabaseUpdated,
    [Parameter(Mandatory)]
    [string]$Release,
    [string]$Site = 'C:\publish\1Reports',
    [string]$Pool = '1Reports'
)

$ErrorActionPreference = 'Stop'
if (!$DatabaseUpdated) {
    throw 'Run the release''s SQL in SSMS first, then re-run with -DatabaseUpdated.'
}
Import-Module WebAdministration
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$serverOwned = '^(web\.config|appsettings(\.[^\\]+)?\.json)$'

# 0. Verify the release is complete and unmodified before touching anything.
$manifest = Get-Content -LiteralPath (Join-Path $Release 'release-manifest.json') -Raw | ConvertFrom-Json
Write-Host "Release $($manifest.revision.Substring(0, 8)) needs database migration $($manifest.migration)."
foreach ($file in $manifest.web) {
    $actual = (Get-FileHash -LiteralPath (Join-Path $Release $file.path)).Hash
    if ($actual -ne $file.sha256) { throw "Release file does not match its manifest: $($file.path)" }
}
Write-Host "Release verified: $($manifest.web.Count) files."

# 1. Work out what changes: files that differ, and frontend assets the new build no longer uses.
$changed = @($manifest.web | Where-Object { $_.path -notmatch $serverOwned } | Where-Object {
    $current = Join-Path $Site $_.path
    !(Test-Path -LiteralPath $current) -or (Get-FileHash -LiteralPath $current).Hash -ne $_.sha256
} | ForEach-Object { $_.path })
$keep = @{}; $manifest.web | ForEach-Object { $keep[$_.path] = $true }
$assets = Join-Path $Site 'wwwroot\assets'
$retired = @(if (Test-Path -LiteralPath $assets) {
    Get-ChildItem -LiteralPath $assets -File | ForEach-Object { "wwwroot\assets\$($_.Name)" } | Where-Object { !$keep[$_] }
})
Write-Host "$($changed.Count) files to replace, $($retired.Count) retired assets to remove."
if ($changed.Count -eq 0 -and $retired.Count -eq 0) { Write-Host 'The site already matches this release.'; return }

# 2. Stop the site and back up everything that will be replaced or removed.
Stop-WebAppPool $Pool -ErrorAction SilentlyContinue
$deadline = (Get-Date).AddMinutes(2)
while ((Get-WebAppPoolState $Pool).Value -ne 'Stopped') {
    if ((Get-Date) -gt $deadline) { throw "App pool $Pool did not stop." }
    Start-Sleep 1
}
$backup = "$Site-backup-$stamp"
$added = @()
foreach ($file in $changed + $retired) {
    $current = Join-Path $Site $file
    if (Test-Path -LiteralPath $current) {
        $target = Join-Path $backup $file
        New-Item -ItemType Directory -Force -Path (Split-Path $target) | Out-Null
        Copy-Item -LiteralPath $current -Destination $target
    } else { $added += $file }
}
Write-Host "Backed up to $backup."

# 3. Replace, and roll back to the backup if anything goes wrong.
try {
    foreach ($file in $changed) {
        $target = Join-Path $Site $file
        New-Item -ItemType Directory -Force -Path (Split-Path $target) | Out-Null
        Copy-Item -LiteralPath (Join-Path $Release $file) -Destination $target -Force
    }
    foreach ($file in $retired) { Remove-Item -LiteralPath (Join-Path $Site $file) }
    Copy-Item -LiteralPath (Join-Path $Release 'release-manifest.json') -Destination (Join-Path $Site 'release-manifest.json') -Force
}
catch {
    Write-Warning "Update failed: $_. Restoring the previous files."
    foreach ($file in $added) { Remove-Item -LiteralPath (Join-Path $Site $file) -ErrorAction SilentlyContinue }
    Get-ChildItem -LiteralPath $backup -Recurse -File | ForEach-Object {
        Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $Site $_.FullName.Substring($backup.Length + 1)) -Force
    }
    Start-WebAppPool $Pool
    throw
}

# 4. Start the site again.
Start-WebAppPool $Pool
Write-Host "App pool $Pool is $((Get-WebAppPoolState $Pool).Value)."
Write-Host "Done. To undo: stop $Pool, copy $backup over $Site, delete these new files, start ${Pool}:"
$added | ForEach-Object { Write-Host "  $_" }
