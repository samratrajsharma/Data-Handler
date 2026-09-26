<#
.SYNOPSIS
    Create a Data Handler shortcut on the Desktop (or anywhere you choose).

.DESCRIPTION
    Makes a .lnk that runs run.cmd from this folder. Double-clicking it starts
    the stack (pulling images the first time) and opens the browser when the
    API reports healthy — the same thing run.cmd does from a terminal.

    Docker Desktop must already be running. The shortcut does not start Docker
    itself: launching it from a shortcut gives no way to show the several
    minutes of engine startup, and a window that appears to hang is worse than
    an error that says what to do. run.ps1 already fails with a clear message
    when the Docker daemon is unreachable.

.PARAMETER Path
    Folder to create the shortcut in. Defaults to the Desktop.

.PARAMETER Name
    Shortcut file name (without .lnk). Defaults to "Data Handler".

.EXAMPLE
    .\install-shortcut.ps1
    .\install-shortcut.ps1 -Path "C:\Users\me\Documents"
#>

[CmdletBinding()]
param(
    [string] $Path = [Environment]::GetFolderPath("Desktop"),
    [string] $Name = "Data Handler"
)

$ErrorActionPreference = "Stop"

function Ok  ($m) { Write-Host "  $m" -ForegroundColor Green }
function Inf ($m) { Write-Host "  $m" -ForegroundColor DarkGray }
function Die ($m) { Write-Host "  $m" -ForegroundColor Red; exit 1 }

# $PSScriptRoot is the folder holding THIS script, which is the repo root.
# Resolved rather than assumed so the shortcut keeps working when the folder
# is moved or renamed after install — the .lnk stores an absolute path.
$root   = $PSScriptRoot
$target = Join-Path $root "run.cmd"

if (-not (Test-Path $target)) {
    Die "run.cmd not found next to this script ($root). Run it from the folder you unzipped."
}

if (-not (Test-Path $Path)) {
    Die "Destination folder does not exist: $Path"
}

$linkPath = Join-Path $Path "$Name.lnk"

if (Test-Path $linkPath) {
    $answer = Read-Host "  '$Name.lnk' already exists there. Replace it? [y/N]"
    if ($answer -notmatch '^[Yy]') { Inf "Cancelled."; exit 0 }
}

# ── Icon ────────────────────────────────────────────────────────────────
# A .lnk cannot use a PNG. Windows wants .ico (or an icon inside an .exe/.dll).
# If we ever ship one at infrastructure/datahandler.ico it is picked up here;
# otherwise fall back to a stock shell icon rather than leaving the generic
# "unknown file" page, which is what an un-set IconLocation produces.
$icon = Join-Path $root "infrastructure\datahandler.ico"
if (-not (Test-Path $icon)) {
    $icon = "$env:SystemRoot\System32\imageres.dll,109"   # blue app-window icon
}

try {
    $shell = New-Object -ComObject WScript.Shell
    $lnk   = $shell.CreateShortcut($linkPath)

    # Point at run.cmd, NOT at powershell.exe with arguments. run.cmd already
    # bypasses the execution policy for one process, which is the whole reason
    # it exists — files extracted from a downloaded ZIP carry the Mark of the
    # Web and Windows refuses to run their .ps1 directly.
    $lnk.TargetPath       = $target
    $lnk.WorkingDirectory = $root
    $lnk.IconLocation     = $icon
    $lnk.Description      = "Start Data Handler (requires Docker Desktop to be running)"
    $lnk.WindowStyle      = 1        # normal window: the pull/startup log stays visible
    $lnk.Save()
}
catch {
    Die "Could not create the shortcut: $($_.Exception.Message)"
}

Ok "Shortcut created: $linkPath"
Inf "Start Docker Desktop first, then double-click it."
