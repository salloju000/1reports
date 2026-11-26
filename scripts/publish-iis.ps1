param(
    [Parameter(Mandatory)]
    [string]$OutputDirectory,
    [string]$BasePath = '/1Reports/',
    [string]$WorkerDirectory,
    [string]$TemplateDirectory
)

$ErrorActionPreference = 'Stop'
if ($BasePath -cnotmatch '\A/(?:[A-Za-z0-9_-]+/)*\z') {
    throw 'BasePath must be / or a path such as /1Reports/.'
}

$outputPath = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($OutputDirectory)
if (Test-Path -LiteralPath $outputPath) {
    throw "Choose a new publish directory. The path already exists: $outputPath"
}

$previousBase = $env:HUB_BASE_PATH
Push-Location (Join-Path $PSScriptRoot '..')
try {
    $revision = git rev-parse HEAD
    if ($LASTEXITCODE -ne 0) { throw 'Could not identify the source revision.' }
    $sourceStatus = @(git status --porcelain --untracked-files=normal)
    if ($LASTEXITCODE -ne 0) { throw 'Could not identify working tree changes.' }
    $migration = (Get-ChildItem server/Migrations/*_*.Designer.cs | Sort-Object Name | Select-Object -Last 1).Name.Replace('.Designer.cs', '')
    if (!(Select-String -LiteralPath publish/HubIdentity.sql -SimpleMatch $migration -Quiet)) {
        throw 'Regenerate publish/HubIdentity.sql for the current migration before publishing.'
    }

    dotnet publish server/1Reports.csproj -c Release -r win-x64 --self-contained true -o $outputPath
    if ($LASTEXITCODE -ne 0) { throw 'Backend publish failed.' }

    $env:HUB_BASE_PATH = $BasePath
    npm.cmd run build -- --outDir (Join-Path $outputPath 'wwwroot')
    if ($LASTEXITCODE -ne 0) { throw 'Frontend build failed.' }

    foreach ($file in 'web.config', '1Reports.exe', 'wwwroot/index.html') {
        if (!(Test-Path -LiteralPath (Join-Path $outputPath $file) -PathType Leaf)) {
            throw "Publish is incomplete. Missing $file."
        }
    }
    Copy-Item -LiteralPath publish/HubIdentity.sql -Destination (Join-Path $outputPath 'HubIdentity.sql')
    $files = @(Get-ChildItem -LiteralPath $outputPath -Recurse -File | ForEach-Object {
        @{ path = $_.FullName.Substring($outputPath.TrimEnd('\').Length + 1); sha256 = (Get-FileHash -LiteralPath $_.FullName).Hash }
    })
    $external = foreach ($kind in 'worker', 'templates') {
        $directory = if ($kind -eq 'worker') { $WorkerDirectory } else { $TemplateDirectory }
        if (!$directory) { continue }
        $externalRoot = (Resolve-Path -LiteralPath $directory).ProviderPath.TrimEnd('\')
        Get-ChildItem -LiteralPath $externalRoot -Recurse -File | ForEach-Object {
            @{ kind = $kind; path = $_.FullName.Substring($externalRoot.Length + 1); sha256 = (Get-FileHash -LiteralPath $_.FullName).Hash }
        }
    }
    [ordered]@{
        revision = $revision
        dirty = $sourceStatus.Count -gt 0
        migration = $migration
        basePath = $BasePath
        web = $files
        external = @($external)
    } | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $outputPath 'release-manifest.json') -Encoding UTF8
    Write-Output "IIS publish completed at $outputPath"
}
finally {
    $env:HUB_BASE_PATH = $previousBase
    Pop-Location
}
