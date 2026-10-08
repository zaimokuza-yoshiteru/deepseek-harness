param([ValidateSet('build', 'startup', 'replay')][string]$Mode = 'build')
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
@{ repo = $repo; node = $node; path = $env:PATH; root = $root; version = $env:DSH_DESKTOP_DISTRIBUTION_VERSION; mode = $Mode; audit = $env:DSH_STARTUP_DEPENDENCY_AUDIT } |
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
$env:DSH_STARTUP_DEPENDENCY_AUDIT = $inputData.audit
# pnpm/action-setup lives in runneradmin's home, which this user cannot read.
$tooling = Join-Path $env:USERPROFILE 'build-tools'
$npmCli = Join-Path (Split-Path $inputData.node) 'node_modules\npm\bin\npm-cli.js'
& $inputData.node $npmCli install --prefix $tooling --ignore-scripts --no-audit --no-fund pnpm@11.23.0
if ($LASTEXITCODE -ne 0) { throw 'Standard-user pnpm setup failed' }
$env:PATH = (Join-Path $tooling 'node_modules\.bin') + ';' + $env:PATH
Set-Location $inputData.repo
git config --global --add safe.directory $inputData.repo
& $inputData.node apps/desktop/scripts/ci-portable-build.mjs win-x64 $inputData.mode
exit $LASTEXITCODE
'@ | Set-Content $script
$stdout = Join-Path $root 'stdout.log'
$stderr = Join-Path $root 'stderr.log'
$process = Start-Process -FilePath $pwsh -ArgumentList @('-NoProfile', '-File', "`"$script`"") `
  -Credential $credential -LoadUserProfile -WorkingDirectory $repo -PassThru `
  -RedirectStandardOutput $stdout -RedirectStandardError $stderr
$offset = 0
$guarded = $false
$ruleGroup = 'DSH-CI-' + [Guid]::NewGuid().ToString('N')
$firewallState = @()
try {
  while (-not $process.WaitForExit(1000)) {
    $requestFile = Join-Path $repo '.artifacts/startup-timing/network-guard-request.json'
    if ($env:DSH_STARTUP_DEPENDENCY_AUDIT -eq '1' -and -not $guarded -and (Test-Path $requestFile)) {
      $request = Get-Content -Raw $requestFile | ConvertFrom-Json
      $application = [IO.Path]::GetFullPath($request.application)
      $allowed = [IO.Path]::GetFullPath((Join-Path $repo '.artifacts/startup-timing')) + [IO.Path]::DirectorySeparatorChar
      if (-not $application.StartsWith($allowed, [StringComparison]::OrdinalIgnoreCase)) { throw 'Firewall request is outside the CI extraction directory' }
      $firewallState = @(Get-NetFirewallProfile | Select-Object Name, Enabled)
      Set-NetFirewallProfile -Profile Domain,Private,Public -Enabled True
      $programs = @(Get-ChildItem -LiteralPath $application -Recurse -File -Filter '*.exe' | Select-Object -ExpandProperty FullName)
      if ($programs.Count -eq 0) { throw 'No application executables found for the firewall guard' }
      foreach ($program in $programs) {
        New-NetFirewallRule -DisplayName $ruleGroup -Group $ruleGroup -Direction Outbound -Action Block `
          -Profile Any -Program $program -RemoteAddress '0.0.0.0-126.255.255.255','128.0.0.0-255.255.255.255','::2-ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff' | Out-Null
      }
      $active = @(Get-NetFirewallRule -PolicyStore ActiveStore -Group $ruleGroup)
      if ($active.Count -ne $programs.Count -or @($active | Where-Object { $_.Enabled -ne 'True' -or $_.Action -ne 'Block' }).Count -ne 0) { throw 'Firewall guard did not become active' }
      @{ active = $true; programs = $programs; scope = 'all non-loopback IPv4 and IPv6 destinations'; applicationRunsAsStandardUser = $true } |
        ConvertTo-Json -Depth 4 | Set-Content (Join-Path $repo '.artifacts/startup-timing/network-guard.json')
      $guarded = $true
    }
    $lines = @(Get-Content $stdout -ErrorAction SilentlyContinue)
    if ($lines.Count -gt $offset) { $lines[$offset..($lines.Count - 1)]; $offset = $lines.Count }
  }
} finally {
  Get-NetFirewallRule -Group $ruleGroup -ErrorAction SilentlyContinue | Remove-NetFirewallRule
  foreach ($profile in $firewallState) { Set-NetFirewallProfile -Name $profile.Name -Enabled $profile.Enabled }
}
$process.WaitForExit()
$lines = @(Get-Content $stdout -ErrorAction SilentlyContinue)
if ($lines.Count -gt $offset) { $lines[$offset..($lines.Count - 1)] }
Get-Content $stderr -ErrorAction SilentlyContinue
if ($process.ExitCode -ne 0) { throw "Standard-user desktop build exited $($process.ExitCode)" }
