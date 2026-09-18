# The runner creates the account; dependency installation, build and smoke run only as that standard user.
$ErrorActionPreference = 'Stop'
$user = 'dshbuilder'
$password = [Guid]::NewGuid().ToString('N') + 'aA!7'
$secure = ConvertTo-SecureString $password -AsPlainText -Force
New-LocalUser -Name $user -Password $secure -AccountNeverExpires | Out-Null
$usersGroup = (Get-LocalGroup -SID 'S-1-5-32-545').Name
Add-LocalGroupMember -Group $usersGroup -Member $user
$credential = [PSCredential]::new("$env:COMPUTERNAME\$user", $secure)
$repo = $env:GITHUB_WORKSPACE
$root = Join-Path $env:RUNNER_TEMP 'dsh-standard-build'
New-Item -ItemType Directory -Force $root | Out-Null
icacls $repo /grant "${user}:(OI)(CI)F" /T /Q | Out-Null
icacls $root /grant "${user}:(OI)(CI)F" /T /Q | Out-Null
$node = (Get-Command node).Source
$pwsh = (Get-Command pwsh).Source
$script = Join-Path $root 'build.ps1'
# Values are passed in JSON; no command substitution or credential is written to disk.
@{ repo = $repo; node = $node; path = $env:PATH; root = $root; version = $env:DSH_DESKTOP_DISTRIBUTION_VERSION } |
  ConvertTo-Json | Set-Content (Join-Path $root 'inputs.json')
@'
$ErrorActionPreference = 'Stop'
$inputData = Get-Content (Join-Path $PSScriptRoot 'inputs.json') | ConvertFrom-Json
$env:PATH = $inputData.path
$env:USERPROFILE = Join-Path $inputData.root 'home'
$env:HOME = $env:USERPROFILE
$env:CI = 'true'
$env:PNPM_HOME = Join-Path $env:USERPROFILE 'pnpm'
$env:APPDATA = Join-Path $env:USERPROFILE 'AppData\Roaming'
$env:LOCALAPPDATA = Join-Path $env:USERPROFILE 'AppData\Local'
$env:TEMP = Join-Path $inputData.root 'temp'
$env:TMP = $env:TEMP
New-Item -ItemType Directory -Force $env:TEMP, $env:APPDATA, $env:LOCALAPPDATA | Out-Null
$env:DSH_DESKTOP_DISTRIBUTION_VERSION = $inputData.version
$env:DSH_TELEMETRY_MODE = 'DISABLED'
$env:CSC_IDENTITY_AUTO_DISCOVERY = 'false'
Set-Location $inputData.repo
git config --global --add safe.directory $inputData.repo
& $inputData.node apps/desktop/scripts/ci-portable-build.mjs win-x64
exit $LASTEXITCODE
'@ | Set-Content $script
$stdout = Join-Path $root 'stdout.log'
$stderr = Join-Path $root 'stderr.log'
$process = Start-Process -FilePath $pwsh -ArgumentList @('-NoProfile', '-File', "`"$script`"") `
  -Credential $credential -LoadUserProfile -WorkingDirectory $repo -PassThru `
  -RedirectStandardOutput $stdout -RedirectStandardError $stderr
$offset = 0
while (-not $process.WaitForExit(10000)) {
  $lines = @(Get-Content $stdout -ErrorAction SilentlyContinue)
  if ($lines.Count -gt $offset) { $lines[$offset..($lines.Count - 1)]; $offset = $lines.Count }
}
$process.WaitForExit()
$lines = @(Get-Content $stdout -ErrorAction SilentlyContinue)
if ($lines.Count -gt $offset) { $lines[$offset..($lines.Count - 1)] }
Get-Content $stderr -ErrorAction SilentlyContinue
if ($process.ExitCode -ne 0) { throw "Standard-user desktop build exited $($process.ExitCode)" }
