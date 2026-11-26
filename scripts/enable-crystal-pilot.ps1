[CmdletBinding(DefaultParameterSetName = 'Enable')]
param(
    [string]$Release = 'C:\publish\1Reports',
    [string]$Templates = 'C:\publish\efi-crystal-templates',
    [string]$WorkerDir = 'C:\publish\crystal-worker-build\crystal-worker\bin\Release\net48',
    [Parameter(Mandatory, ParameterSetName = 'Enable')]
    [string]$ReportLogin,
    [Parameter(Mandatory, ParameterSetName = 'Enable')]
    [ValidatePattern('^[A-Fa-f0-9]{64}$')]
    [string]$ApprovedTemplateSha256,
    [string]$PasswordEnvironmentVariable = 'EFI_CRYSTAL_PILOT_PASSWORD',
    [Parameter(Mandatory)]
    [string]$RollbackFile,
    [Parameter(Mandatory, ParameterSetName = 'Rollback')]
    [switch]$Rollback
)

$ErrorActionPreference = 'Stop'
$poolName = '1Reports'
$worker = Join-Path $workerDir '1Reports.Crystal.exe'
$templateName = 'SRPL-InvRefNEW-4x6.rpt'
$templatePath = Join-Path $Templates $templateName
$rollbackPath = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($RollbackFile)
$settingPattern = '\ACrystal__(WorkerPath|Roots__labels__(Path|Category|Roles__0|ApprovedFile|ApprovedSha256)|Connections__0__(Source|Database|Provider|IntegratedSecurity|User|PasswordEnvironmentVariable))\z'

if (!$Rollback) {
    foreach ($file in @($worker, "$release\web.config", "$release\1Reports.exe",
            "$release\wwwroot\index.html", $templatePath)) {
        if (!(Test-Path -LiteralPath $file -PathType Leaf)) {
            throw "Missing pilot file: $file"
        }
    }
    if ((Get-FileHash -LiteralPath $templatePath -Algorithm SHA256).Hash -ne $ApprovedTemplateSha256) {
        throw 'The pilot report does not match its approved SHA-256.'
    }
    $Release = (Resolve-Path -LiteralPath $Release).ProviderPath
    $Templates = (Resolve-Path -LiteralPath $Templates).ProviderPath
    $worker = (Resolve-Path -LiteralPath $worker).ProviderPath
}

Add-Type -Path "$env:windir\System32\inetsrv\Microsoft.Web.Administration.dll"
$iis = New-Object Microsoft.Web.Administration.ServerManager
try {
    $app = $iis.Sites['Default Web Site'].Applications['/1Reports']
    $pool = $iis.ApplicationPools[$poolName]
    if (!$app -or !$pool -or $app.ApplicationPoolName -ne $poolName) {
        throw 'The expected 1Reports application and pool were not found.'
    }

    $root = $app.VirtualDirectories['/']
    $previousPath = $root.PhysicalPath
    $variables = $pool.GetCollection('environmentVariables')
    if ($Rollback) {
        $backup = Get-Content -LiteralPath $rollbackPath -Raw | ConvertFrom-Json
        if ($previousPath -ne $backup.release -or
            [string]::IsNullOrWhiteSpace($backup.previousPath) -or
            !(Test-Path -LiteralPath ([Environment]::ExpandEnvironmentVariables($backup.previousPath)) -PathType Container) -or
            @($backup.settings).Count -ne 12 -or
            @($backup.settings.name | Sort-Object -Unique).Count -ne 12 -or
            @($backup.settings | Where-Object { $_.name -notmatch $settingPattern }).Count) {
            throw 'The rollback record is invalid or the pilot is no longer the active release.'
        }
        foreach ($saved in $backup.settings) {
            $entry = $variables | Where-Object { $_['name'] -eq $saved.name } | Select-Object -First 1
            if ($entry) { [void]$variables.Remove($entry) }
            if ($saved.present) {
                $entry = $variables.CreateElement('add')
                $entry.SetAttributeValue('name', [string]$saved.name)
                $entry.SetAttributeValue('value', [string]$saved.value)
                [void]$variables.Add($entry)
            }
        }
        $root.PhysicalPath = $backup.previousPath
        $iis.CommitChanges()
        if ($backup.poolStarted) {
            if ($pool.State -eq 'Started') { [void]$pool.Recycle() }
            else { [void]$pool.Start() }
        } elseif ($pool.State -eq 'Started') { [void]$pool.Stop() }
        "1Reports restored to $($backup.previousPath)"
        return
    }
    if ($previousPath -eq $Release) {
        throw 'The pilot release is already active.'
    }

    if ([string]::IsNullOrWhiteSpace($ReportLogin) -or $ReportLogin.Trim() -eq 'sa') {
        throw 'Supply the DBA-approved read-only report login.'
    }
    if ($variables | Where-Object { $_['name'] -match '^Crystal__Roots__labels__Roles__(?!0$)' }) {
        throw 'Remove additional roles from the inventory label pilot root before enabling it.'
    }
    if ($PasswordEnvironmentVariable -notmatch '^[A-Za-z_][A-Za-z0-9_]*$') {
        throw 'Supply a valid protected password variable name.'
    }
    $secret = $variables | Where-Object { $_['name'] -eq $PasswordEnvironmentVariable } | Select-Object -First 1
    if (!$secret -or [string]::IsNullOrEmpty($secret['value'])) {
        throw 'Provision the worker password through protected Hub pool configuration first.'
    }

    $settings = [ordered]@{
        Crystal__WorkerPath = $worker
        Crystal__Roots__labels__Path = $templates
        Crystal__Roots__labels__Category = 'Inventory labels'
        Crystal__Roots__labels__Roles__0 = 'Administrator'
        Crystal__Roots__labels__ApprovedFile = $templateName
        Crystal__Roots__labels__ApprovedSha256 = $ApprovedTemplateSha256
        Crystal__Connections__0__Source = 'PlantManager'
        Crystal__Connections__0__Database = 'PlantmanagerTest'
        Crystal__Connections__0__Provider = 'ODBC (RDO)'
        Crystal__Connections__0__IntegratedSecurity = 'false'
        Crystal__Connections__0__User = $ReportLogin.Trim()
        Crystal__Connections__0__PasswordEnvironmentVariable = $PasswordEnvironmentVariable
    }
    $backup = @{
        release = $Release
        previousPath = $previousPath
        poolStarted = $pool.State -eq 'Started'
        settings = @(foreach ($name in $settings.Keys) {
            $entry = $variables | Where-Object { $_['name'] -eq $name } | Select-Object -First 1
            @{ name = $name; present = $null -ne $entry; value = if ($entry) { [string]$entry['value'] } }
        })
    }
    $backupJson = $backup | ConvertTo-Json -Depth 4
    $backupStream = [IO.File]::Open($rollbackPath, [IO.FileMode]::CreateNew)
    try {
        $backupBytes = [Text.Encoding]::UTF8.GetBytes($backupJson)
        $backupStream.Write($backupBytes, 0, $backupBytes.Length)
    } finally { $backupStream.Dispose() }

    try {
        foreach ($name in $settings.Keys) {
            $value = [string]$settings[$name]
            $entry = $variables | Where-Object { $_['name'] -eq $name } | Select-Object -First 1
            if ($null -eq $entry) {
                $entry = $variables.CreateElement('add')
                $entry.SetAttributeValue('name', $name.PSObject.BaseObject)
                $entry.SetAttributeValue('value', $value.PSObject.BaseObject)
                [void]$variables.Add($entry)
            } else {
                $entry.SetAttributeValue('value', $value.PSObject.BaseObject)
            }
        }
        $root.PhysicalPath = $release
        $iis.CommitChanges()
    } catch {
        $failureLine = $_.InvocationInfo.ScriptLineNumber
        $cause = $_.Exception.GetBaseException()
        throw ('IIS pilot configuration failed at script line {0}. {1} (0x{2:X8}).' -f
            $failureLine, $cause.GetType().FullName, $cause.HResult)
    } finally {
        $settings.Clear()
    }

    if ($pool.State -eq 'Started') {
        [void]$pool.Recycle()
    } else {
        [void]$pool.Start()
    }
    "1Reports pilot active at $release"
    "Previous path: $previousPath"
    "Rollback record: $rollbackPath"
} finally {
    $iis.Dispose()
}
