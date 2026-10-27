<#
.SYNOPSIS
  Installs herdr-nightcity: the neon theme, animated sidebar and Windows Terminal scheme.

.DESCRIPTION
  1. Copies fx/ to %APPDATA%\herdr\fx and links the equalize panes plugin
  2. Backs up your herdr config.toml, then writes the generated one
  3. Adds the Neon Rain scheme to Windows Terminal (as a fragment; your settings.json is untouched)
  4. Reloads herdr and starts the sidebar animator in the background

.PARAMETER Autostart
  Also start the animator when you log in (adds a shortcut to your Startup folder).

.PARAMETER NoStart
  Install files only; don't reload herdr or start the animator.
#>
param(
  [switch]$Autostart,
  [switch]$NoStart
)
$ErrorActionPreference = 'Stop'

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw 'Node.js is required (https://nodejs.org). Install it and run this again.'
}

$herdrDir = Join-Path $env:APPDATA 'herdr'
$fxDir = Join-Path $herdrDir 'fx'
$config = Join-Path $herdrDir 'config.toml'
New-Item -ItemType Directory -Force $fxDir | Out-Null

Copy-Item (Join-Path $PSScriptRoot 'fx\*') $fxDir -Recurse -Force
Write-Host "Copied animator to $fxDir"

if (Get-Command herdr -ErrorAction SilentlyContinue) {
  herdr plugin link (Join-Path $fxDir 'equalize') | Out-Null
  Write-Host 'Linked the equalize panes plugin'
}

if (Test-Path $config) {
  $backup = "$config.bak-$(Get-Date -Format yyyyMMdd-HHmmss)"
  Copy-Item $config $backup
  Write-Host "Backed up your config to $backup"
}
node (Join-Path $fxDir 'build-config.js') $config

$fragments = Join-Path $env:LOCALAPPDATA 'Microsoft\Windows Terminal\Fragments\herdr-nightcity'
New-Item -ItemType Directory -Force $fragments | Out-Null
Copy-Item (Join-Path $PSScriptRoot 'windows-terminal\neon-rain.json') $fragments -Force
Write-Host 'Added the Neon Rain scheme to Windows Terminal (pick it in Settings > Profiles > Defaults > Appearance)'

$launcher = Join-Path $fxDir 'start-sidebar-fx.vbs'
if ($Autostart) {
  $shortcut = Join-Path ([Environment]::GetFolderPath('Startup')) 'herdr sidebar-fx.lnk'
  $shell = New-Object -ComObject WScript.Shell
  $link = $shell.CreateShortcut($shortcut)
  $link.TargetPath = Join-Path $env:WINDIR 'System32\wscript.exe'
  $link.Arguments = "`"$launcher`""
  $link.Description = 'Animates the herdr sidebar'
  $link.Save()
  Write-Host "Animator will start at login ($shortcut)"
}

if (-not $NoStart) {
  if (Get-Command herdr -ErrorAction SilentlyContinue) {
    herdr server reload-config | Out-Null
    Write-Host 'Reloaded herdr'
  } else {
    Write-Host 'herdr is not on PATH; the new config applies the next time herdr starts'
  }
  Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
    Where-Object CommandLine -match 'sidebar-fx' |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
  Start-Process wscript.exe -ArgumentList "`"$launcher`""
  Write-Host 'Started the sidebar animator'
}
