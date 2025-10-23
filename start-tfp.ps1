[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $scriptDir

if (-not $env:NODE_ENV -or $env:NODE_ENV -eq '') {
    $env:NODE_ENV = 'production'
}

if (-not $env:PORT -or $env:PORT -eq '') {
    $env:PORT = '8082'
}

$npmCommand = if ($IsWindows) { 'npm.cmd' } else { 'npm' }

Write-Host "Starting TooFunny Productions service (NODE_ENV=$($env:NODE_ENV), PORT=$($env:PORT))"

& $npmCommand run start

exit $LASTEXITCODE
