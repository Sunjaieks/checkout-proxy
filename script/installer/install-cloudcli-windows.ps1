<#
.SYNOPSIS
    Installs Node.js (if it isn't already installed) and @cloudcli-ai/cloudcli, so that
    Checkout-Proxy's [Tools] -> [AI Desktop] feature works out of the box.

.DESCRIPTION
    Usage (download and run directly):
        irm <raw-url-of-this-script> | iex

    or download it first and run locally:
        powershell -ExecutionPolicy Bypass -File install-cloudcli-windows.ps1

    Running from an elevated (Administrator) PowerShell window is recommended in case
    Node.js needs to be installed.
#>

$ErrorActionPreference = 'Stop'

$CloudCliPackage = '@cloudcli-ai/cloudcli'
$NodeDistUrl = 'https://nodejs.org/dist/latest-lts/'

function Write-Info([string]$Message) {
    Write-Host ""
    Write-Host "[cloudcli-installer] $Message" -ForegroundColor Cyan
}

function Write-ErrorMsg([string]$Message) {
    Write-Host ""
    Write-Host "[cloudcli-installer] ERROR: $Message" -ForegroundColor Red
}

function Test-CommandExists([string]$Name) {
    return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

function Update-SessionPath {
    # Installers update the Machine/User PATH in the registry, but this PowerShell session
    # won't see the change until we merge it into $env:Path ourselves.
    $machinePath = [System.Environment]::GetEnvironmentVariable('Path', 'Machine')
    $userPath = [System.Environment]::GetEnvironmentVariable('Path', 'User')
    $env:Path = "$machinePath;$userPath"
}

function Install-NodeViaWinget {
    Write-Info "Installing Node.js via winget..."
    winget install --id OpenJS.NodeJS.LTS -e --silent --accept-source-agreements --accept-package-agreements
}

function Install-NodeViaMsi {
    Write-Info "winget not available. Downloading the official Node.js installer from nodejs.org..."
    $arch = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { 'arm64' } else { 'x64' }

    $listing = Invoke-WebRequest -UseBasicParsing -Uri $NodeDistUrl
    $msiName = $listing.Links.href | Where-Object { $_ -match "node-v[\d.]+-$arch\.msi$" } | Select-Object -First 1
    if (-not $msiName) {
        Write-ErrorMsg "Could not determine the latest Node.js installer filename."
        Write-ErrorMsg "Please install Node.js manually from https://nodejs.org/en/download and re-run this script."
        exit 1
    }
    $msiName = [System.IO.Path]::GetFileName($msiName)
    $msiUrl = "$NodeDistUrl$msiName"
    $tmpMsi = Join-Path $env:TEMP $msiName

    Write-Info "Downloading $msiName..."
    Invoke-WebRequest -UseBasicParsing -Uri $msiUrl -OutFile $tmpMsi

    try {
        Write-Info "Installing Node.js (a UAC prompt may appear)..."
        Start-Process -FilePath 'msiexec.exe' -ArgumentList "/i `"$tmpMsi`" /qn /norestart" -Wait
    } finally {
        Remove-Item -Force $tmpMsi -ErrorAction SilentlyContinue
    }
}

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Host "[cloudcli-installer] Note: run this script from an elevated (Administrator) PowerShell window if Node.js needs to be installed." -ForegroundColor Yellow
}

if ((Test-CommandExists 'node') -and (Test-CommandExists 'npm')) {
    Write-Info "Node.js is already installed ($(node -v)). Skipping Node.js installation."
} else {
    Write-Info "Node.js was not found on this machine."
    if (Test-CommandExists 'winget') {
        Install-NodeViaWinget
    } else {
        Install-NodeViaMsi
    }

    Update-SessionPath

    if (-not (Test-CommandExists 'node')) {
        Write-ErrorMsg "Node.js installation finished, but 'node' is still not on PATH."
        Write-ErrorMsg "Please close and reopen PowerShell, then re-run this script."
        exit 1
    }
    Write-Info "Node.js installed successfully ($(node -v))."
}

Write-Info "Installing $CloudCliPackage globally via npm..."
npm install -g $CloudCliPackage

Write-Info "Done! $CloudCliPackage is installed."
Write-Info "Open Checkout-Proxy and click [Tools] -> [AI Desktop] to launch it."
