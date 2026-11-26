<#
Lists every parameter of each Crystal report (main report and subreports) and what 1Reports does with it,
so it can be checked against what Crystal Reports itself prompts for. Reads the templates only: no database
sign-in, nothing is changed. Run on the server, where the Crystal runtime and the worker are installed:

  & '\\tsclient\D\SSSSS\EFI Reports\scripts\explain-crystal-parameters.ps1' -Templates 'C:\publish\efi-crystal-templates'

Roles: prompt (asked once), linked (filled from the main report by a subreport link), shared (takes the value
of an equal parameter asked once), unused (not used by the report, so Crystal doesn't ask for it either).
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [string]$Templates,
    [string]$Worker = 'C:\publish\crystal-worker-build\crystal-worker\bin\Release\net48\1Reports.Crystal.exe'
)

$ErrorActionPreference = 'Stop'
if (!(Test-Path -LiteralPath $Worker -PathType Leaf)) { throw "Worker not found: $Worker" }
$files = @(Get-ChildItem -LiteralPath $Templates -Filter *.rpt -File -Recurse)
if ($files.Count -eq 0) { throw "No .rpt files under $Templates" }

foreach ($file in $files) {
    $request = @{ operation = 'explain'; path = $file.FullName } | ConvertTo-Json -Compress
    $output = $request | & $Worker
    Write-Host ''
    Write-Host "== $($file.Name)" -ForegroundColor Cyan
    if ($LASTEXITCODE -ne 0) { Write-Warning "The worker could not read this report (exit code $LASTEXITCODE)."; continue }
    $rows = $output | ConvertFrom-Json
    if (!$rows) { Write-Host '   No parameters.'; continue }
    $rows | Format-Table @{ n = 'Report'; e = { $_.report } }, @{ n = 'Parameter'; e = { $_.parameter } },
        @{ n = 'Role'; e = { $_.role } }, @{ n = 'Asked as'; e = { $_.prompt } }, @{ n = 'Why'; e = { $_.reason } } -AutoSize -Wrap |
        Out-String -Width 220 | Write-Host
    $asked = @($rows | Where-Object role -eq 'prompt').Count
    Write-Host "   People are asked for $asked of $(@($rows).Count) parameters."
}
