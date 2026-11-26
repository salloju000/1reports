<#
One-time switch of the live site from the old program names (EFI.ReportingHub.exe, EFI.ReportingHub.Crystal.exe)
to 1Reports.exe and 1Reports.Crystal.exe. Run on the server in an Administrator PowerShell AFTER copying the
release's files into the site folder (everything except web.config and appsettings*.json). For example:
  & 'C:\publish\release-20261119-1reports-names\switch-to-1reports-files.ps1' -Release 'C:\publish\release-20261119-1reports-names'

It backs up web.config and the IIS configuration, rebuilds the Crystal worker under its new name, points
web.config and the pool's Crystal__WorkerPath at the new programs, moves the old EFI.ReportingHub.* files
to a backup folder, and starts the site again. If anything fails after the pool stops, web.config and the
pool setting are restored and the pool is started again.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [string]$Release,
    [string]$Site = 'C:\publish\1Reports',
    [string]$Pool = '1Reports',
    [string]$WorkerBuild = 'C:\publish\crystal-worker-build'
)

$ErrorActionPreference = 'Stop'
Import-Module WebAdministration
$appcmd = Join-Path $env:windir 'system32\inetsrv\appcmd.exe'
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$backup = "$Site-names-backup-$stamp"

# 0. The new program must already be in the site folder.
foreach ($file in '1Reports.exe', '1Reports.dll', 'wwwroot\index.html') {
    if (!(Test-Path -LiteralPath (Join-Path $Site $file))) { throw "Copy the release into $Site first: $file is missing." }
}
foreach ($file in 'crystal-worker\Program.cs', 'crystal-worker\1Reports.Crystal.csproj', 'scripts\build-crystal-worker.ps1') {
    if (!(Test-Path -LiteralPath (Join-Path $Release $file))) { throw "The release is missing $file." }
}

# 1. Back up what this script changes.
New-Item -ItemType Directory -Force -Path $backup | Out-Null
Copy-Item -LiteralPath (Join-Path $Site 'web.config') -Destination $backup
Backup-WebConfiguration -Name "pre-1reports-names-$stamp" | Out-Null
$poolXml = [xml](& $appcmd list apppool $Pool /config /xml)
$oldWorker = ($poolXml.SelectNodes('//environmentVariables/add') | Where-Object { $_.name -eq 'Crystal__WorkerPath' }).value
if (!$oldWorker) { throw "Pool $Pool has no Crystal__WorkerPath setting." }
Write-Host "Backed up to $backup (and IIS configuration pre-1reports-names-$stamp)."

# 2. Rebuild the Crystal worker under its new name (the old one keeps working until the switch).
Copy-Item -LiteralPath (Join-Path $WorkerBuild 'crystal-worker') -Destination (Join-Path $backup 'crystal-worker-source') -Recurse
Copy-Item -LiteralPath (Join-Path $Release 'crystal-worker\Program.cs') -Destination (Join-Path $WorkerBuild 'crystal-worker\Program.cs') -Force
Copy-Item -LiteralPath (Join-Path $Release 'crystal-worker\1Reports.Crystal.csproj') -Destination (Join-Path $WorkerBuild 'crystal-worker\1Reports.Crystal.csproj') -Force
Copy-Item -LiteralPath (Join-Path $Release 'scripts\build-crystal-worker.ps1') -Destination (Join-Path $WorkerBuild 'scripts\build-crystal-worker.ps1') -Force
Remove-Item -LiteralPath (Join-Path $WorkerBuild 'crystal-worker\EFI.ReportingHub.Crystal.csproj') -ErrorAction SilentlyContinue
& (Join-Path $WorkerBuild 'scripts\build-crystal-worker.ps1')
if ($LASTEXITCODE -ne 0) { throw 'Crystal worker build failed. Nothing on the site was changed.' }
$newWorker = Join-Path (Split-Path $oldWorker) '1Reports.Crystal.exe'
if (!(Test-Path -LiteralPath $newWorker)) {
    $found = Get-ChildItem -LiteralPath (Join-Path $WorkerBuild 'crystal-worker\bin') -Recurse -Filter '1Reports.Crystal.exe' | Select-Object -First 1
    if (!$found) { throw 'The rebuilt worker 1Reports.Crystal.exe was not found.' }
    $newWorker = $found.FullName
}
Write-Host "Crystal worker built: $newWorker"

# 3. Switch the site over.
if ((Get-WebAppPoolState $Pool).Value -ne 'Stopped') { Stop-WebAppPool $Pool }
while ((Get-WebAppPoolState $Pool).Value -ne 'Stopped') { Start-Sleep 1 }
try {
    $config = Join-Path $Site 'web.config'
    $text = Get-Content -LiteralPath $config -Raw
    if ($text -notmatch 'EFI\.ReportingHub\.exe' -and $text -notmatch '1Reports\.exe') { throw 'web.config does not name the program.' }
    Set-Content -LiteralPath $config -Value ($text -replace 'EFI\.ReportingHub\.exe', '1Reports.exe') -Encoding UTF8 -NoNewline
    & $appcmd set apppool $Pool "/-environmentVariables.[name='Crystal__WorkerPath']" | Out-Null
    & $appcmd set apppool $Pool "/+environmentVariables.[name='Crystal__WorkerPath',value='$newWorker']" | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Could not update Crystal__WorkerPath.' }
    $old = @(Get-ChildItem -LiteralPath $Site -File -Filter 'EFI.ReportingHub*')
    foreach ($file in $old) { Move-Item -LiteralPath $file.FullName -Destination $backup }
    Write-Host "web.config now runs 1Reports.exe; Crystal__WorkerPath = $newWorker; moved $($old.Count) old files to the backup."
}
catch {
    Write-Warning "Switch failed: $_. Restoring web.config and the worker setting."
    Copy-Item -LiteralPath (Join-Path $backup 'web.config') -Destination (Join-Path $Site 'web.config') -Force
    & $appcmd set apppool $Pool "/-environmentVariables.[name='Crystal__WorkerPath']" | Out-Null
    & $appcmd set apppool $Pool "/+environmentVariables.[name='Crystal__WorkerPath',value='$oldWorker']" | Out-Null
    Get-ChildItem -LiteralPath $backup -File -Filter 'EFI.ReportingHub*' | ForEach-Object { Move-Item -LiteralPath $_.FullName -Destination $Site }
    Start-WebAppPool $Pool
    throw
}

# 4. Start the site and check it answers.
Start-WebAppPool $Pool
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
Start-Sleep 2
foreach ($url in 'https://localhost/1Reports/', 'https://localhost/1Reports/api/auth/me') {
    try { $status = (Invoke-WebRequest $url -UseBasicParsing -TimeoutSec 90).StatusCode }
    catch { $status = [int]$_.Exception.Response.StatusCode }
    Write-Host "$url -> $status"
}
Write-Host "Done. Expected: 200 for the page and 401 for /api/auth/me. To undo: stop $Pool, copy $backup\web.config and the"
Write-Host "EFI.ReportingHub.* files back into $Site, set Crystal__WorkerPath to $oldWorker, start $Pool."
