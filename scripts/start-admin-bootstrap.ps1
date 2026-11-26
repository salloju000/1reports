[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [ValidatePattern('^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*$')]
    [string]$SqlHost,
    [Parameter(Mandatory)]
    [ValidateRange(1, 65535)]
    [int]$SqlPort,
    [Parameter(Mandatory)]
    [ValidatePattern('^[A-Fa-f0-9]{64}$')]
    [string]$ApprovedDllSha256,
    [string]$ReleaseDirectory = 'C:\publish\backend'
)

$ErrorActionPreference = 'Stop'
if ($env:COMPUTERNAME -ne 'WIN-4IIIIVPF045') {
    throw 'Run this script on WIN-4IIIIVPF045.'
}

$release = (Resolve-Path -LiteralPath $ReleaseDirectory).ProviderPath
$exe = Join-Path $release '1Reports.exe'
$dll = Join-Path $release '1Reports.dll'
if (!(Test-Path -LiteralPath $exe -PathType Leaf) -or
    (Get-FileHash -LiteralPath $dll -Algorithm SHA256).Hash -ne $ApprovedDllSha256) {
    throw 'The executable is missing or the deployed DLL does not match the approved hash.'
}

$email = (Read-Host 'DBA-verified Hub administrator email').Trim()
if ($email.Length -gt 254 -or $email -notmatch '^[^\s@]+@[^\s@]+$') {
    throw 'Enter a valid email address.'
}

$start = New-Object System.Diagnostics.ProcessStartInfo
$start.FileName = $exe
$start.WorkingDirectory = $release
$start.Arguments = '--urls http://127.0.0.1:0'
$start.UseShellExecute = $false
$settings = New-Object System.Data.Common.DbConnectionStringBuilder
$settings['Server'] = "tcp:$SqlHost,$SqlPort"
$settings['Database'] = 'test'
$settings['User ID'] = 'EFIHubProvisioning'
$settings['Encrypt'] = 'True'
$settings['TrustServerCertificate'] = 'False'
$settings['Persist Security Info'] = 'False'
$settings['Pooling'] = 'False'
$settings['Application Name'] = '1Reports Administrator Bootstrap'

$sqlSecret = $null
$adminSecret = $null
$child = $null
try {
    $sqlSecret = Read-Host 'Temporary EFIHubProvisioning password' -AsSecureString
    $adminSecret = Read-Host 'Hub administrator password' -AsSecureString
    $settings['Password'] = [pscredential]::new('sql', $sqlSecret).GetNetworkCredential().Password
    $start.EnvironmentVariables['ConnectionStrings__Hub'] = $settings.ConnectionString
    $start.EnvironmentVariables['HUB_BOOTSTRAP_ADMIN'] = '1'
    $start.EnvironmentVariables['HUB_ADMIN_EMAIL'] = $email
    $start.EnvironmentVariables['HUB_ADMIN_PASSWORD'] = [pscredential]::new('hub', $adminSecret).GetNetworkCredential().Password
    $start.EnvironmentVariables['ASPNETCORE_ENVIRONMENT'] = 'Production'
    $start.EnvironmentVariables['DOTNET_ENVIRONMENT'] = 'Production'
    $start.EnvironmentVariables['Logging__LogLevel__Default'] = 'Information'
    $start.EnvironmentVariables['Logging__LogLevel__Default'] = 'Information'

    Write-Host 'After bootstrap exits, have the DBA verify membership and remove temporary access.'
    $child = [System.Diagnostics.Process]::Start($start)
    $start.EnvironmentVariables.Remove('ConnectionStrings__Hub')
    $start.EnvironmentVariables.Remove('HUB_ADMIN_PASSWORD')
    $settings.Clear()

    while (!$child.WaitForExit(250)) { }
    if ($child.ExitCode -ne 0) {
        throw "Bootstrap process exited with code $($child.ExitCode). Have the DBA check for partial changes before retrying."
    }
}
finally {
    if ($null -ne $child) {
        if (!$child.HasExited) { $child.Kill() }
        $child.Dispose()
    }
    $start.EnvironmentVariables.Remove('ConnectionStrings__Hub')
    $start.EnvironmentVariables.Remove('HUB_ADMIN_PASSWORD')
    $settings.Clear()
    if ($null -ne $sqlSecret) { $sqlSecret.Dispose() }
    if ($null -ne $adminSecret) { $adminSecret.Dispose() }
}
