<#
Deploys the "saved database logins + report upload" release to the 1Reports server.
Run on the server in an Administrator PowerShell, AFTER running in SSMS (as a DBA):
  1. publish\HubIdentity.sql                      (creates dbo.ReportCredentials)
  2. scripts\grant-workspace-permissions.sql      (lets the app pool use it)

The script: prepares the key and upload folders with app-pool-only write access, lets the app pool
write published reports, backs up and replaces only the changed site files, rebuilds the Crystal
worker, and restarts the app pool. It never reads or writes any database password.
#>
[CmdletBinding()]
param(
    [string]$Release = '\\tsclient\D\SSSSS\EFI Reports\publish\release-20261118-saved-logins',
    [string]$WorkerSource = '\\tsclient\D\SSSSS\EFI Reports\crystal-worker\Program.cs',
    [string]$Site = 'C:\publish\1Reports',
    [string]$Templates = 'C:\publish\efi-crystal-templates',
    [string]$WorkerBuild = 'C:\publish\crystal-worker-build',
    [string]$Pool = '1Reports'
)

$ErrorActionPreference = 'Stop'
Import-Module WebAdministration
$identity = "IIS AppPool\$Pool"
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$changed = @(
    '1Reports.dll', '1Reports.pdb', 'HubIdentity.sql',
    'wwwroot\index.html', 'wwwroot\assets\index-CKw1s9Cw.css', 'wwwroot\assets\index-wNJUNQkb.js'
)
$retired = @('wwwroot\assets\index-BGyjaSUT.js', 'wwwroot\assets\index-BV4Luz_c.css')

# 0. Check the release is the expected one before touching anything.
$manifest = (Get-Content -LiteralPath (Join-Path $Release 'release-manifest.json') -Raw | ConvertFrom-Json).web
foreach ($file in $changed) {
    $expected = ($manifest | Where-Object path -eq $file).sha256
    $actual = (Get-FileHash -LiteralPath (Join-Path $Release $file)).Hash
    if (!$expected -or $expected -ne $actual) { throw "Release file does not match its manifest: $file" }
}
if (!(Test-Path -LiteralPath $WorkerSource)) { throw "Worker source not found: $WorkerSource" }
Write-Host 'Release verified.'

# 1. Data Protection keys and upload staging: outside the site, writable only by the app pool and administrators.
$data = Join-Path $env:ProgramData 'EFIHub'
foreach ($folder in 'keys', 'uploads') {
    $path = Join-Path $data $folder
    New-Item -ItemType Directory -Force -Path $path | Out-Null
    & icacls $path /inheritance:r /grant:r 'SYSTEM:(OI)(CI)F' 'Administrators:(OI)(CI)F' "${identity}:(OI)(CI)M" | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Could not set permissions on $path" }
}
Write-Host "Prepared $data\keys and $data\uploads for $identity."

# 2. Let the app pool publish uploaded reports into the template folder.
& icacls $Templates /grant "${identity}:(OI)(CI)M" | Out-Null
if ($LASTEXITCODE -ne 0) { throw "Could not grant write access to $Templates" }
Write-Host "Granted $identity write access to $Templates."

# 3. Stop the site, back up the files being replaced, copy the new ones.
Stop-WebAppPool $Pool -ErrorAction SilentlyContinue
while ((Get-WebAppPoolState $Pool).Value -ne 'Stopped') { Start-Sleep 1 }
$backup = "$Site-backup-$stamp"
foreach ($file in $changed + $retired) {
    $current = Join-Path $Site $file
    if (Test-Path -LiteralPath $current) {
        $target = Join-Path $backup $file
        New-Item -ItemType Directory -Force -Path (Split-Path $target) | Out-Null
        Copy-Item -LiteralPath $current -Destination $target
    }
}
foreach ($file in $changed) {
    $target = Join-Path $Site $file
    New-Item -ItemType Directory -Force -Path (Split-Path $target) | Out-Null
    Copy-Item -LiteralPath (Join-Path $Release $file) -Destination $target -Force
}
foreach ($file in $retired) { Remove-Item -LiteralPath (Join-Path $Site $file) -ErrorAction SilentlyContinue }
Write-Host "Site updated. Replaced files backed up to $backup."

# 4. Rebuild the Crystal worker with the new "connect" check.
$program = Join-Path $WorkerBuild 'crystal-worker\Program.cs'
Copy-Item -LiteralPath $program -Destination "$program.bak-$stamp"
Copy-Item -LiteralPath $WorkerSource -Destination $program -Force
& (Join-Path $WorkerBuild 'scripts\build-crystal-worker.ps1')
if ($LASTEXITCODE -ne 0) { throw 'Crystal worker build failed. The app pool is still stopped.' }
Write-Host 'Crystal worker rebuilt.'

# 5. Start the site again.
Start-WebAppPool $Pool
Write-Host "App pool $Pool is $((Get-WebAppPoolState $Pool).Value)."
Write-Host 'Done. Next: in Settings > Report databases, add a login for each database.'
