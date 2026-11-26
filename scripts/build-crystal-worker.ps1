[CmdletBinding()]
param(
    [ValidateSet('x86', 'x64')]
    [string]$PlatformTarget = 'x64',
    [string]$CrystalSdkDir
)

$ErrorActionPreference = 'Stop'
$project = Join-Path $PSScriptRoot '..\crystal-worker\1Reports.Crystal.csproj'
$temporaryReferences = $null

try {
    if (!$CrystalSdkDir) {
        $gac = Join-Path $env:windir 'Microsoft.NET\assembly\GAC_MSIL'
        $assemblies = @(
            'CrystalDecisions.CrystalReports.Engine'
            'CrystalDecisions.Shared'
            'CrystalDecisions.ReportAppServer.ClientDoc'
            'CrystalDecisions.ReportAppServer.DataDefModel'
            'CrystalDecisions.ReportAppServer.Controllers'
        )
        $temporaryReferences = [IO.Directory]::CreateDirectory(
            (Join-Path ([IO.Path]::GetTempPath()) ('1Reports-Crystal-' + [guid]::NewGuid())))
        $CrystalSdkDir = $temporaryReferences.FullName
        foreach ($assembly in $assemblies) {
            $folder = Join-Path $gac $assembly
            $matches = @(Get-ChildItem -LiteralPath $folder -Filter "$assembly.dll" -File -Recurse)
            if ($matches.Count -ne 1) {
                throw "Expected one installed reference for $assembly. Supply -CrystalSdkDir explicitly."
            }
            Copy-Item -LiteralPath $matches[0].FullName -Destination $CrystalSdkDir
        }
    }

    dotnet build $project -c Release "-p:CrystalSdkDir=$CrystalSdkDir" "-p:PlatformTarget=$PlatformTarget"
    if ($LASTEXITCODE -ne 0) { throw 'Crystal worker build failed.' }
}
finally {
    if ($temporaryReferences) {
        $resolved = (Resolve-Path -LiteralPath $temporaryReferences.FullName).ProviderPath
        $tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
        if ($resolved.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase) -and
            (Split-Path -Leaf $resolved) -like '1Reports-Crystal-*') {
            Remove-Item -LiteralPath $resolved -Recurse -Force
        }
    }
}
