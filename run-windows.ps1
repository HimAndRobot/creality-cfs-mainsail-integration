$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

if (-not (Get-Command py -ErrorAction SilentlyContinue) -and -not (Get-Command python -ErrorAction SilentlyContinue)) {
    Write-Host "Python nao encontrado no PATH." -ForegroundColor Red
    Write-Host "Instale Python 3 e marque a opcao Add Python to PATH."
    exit 1
}

$pythonCmd = if (Get-Command py -ErrorAction SilentlyContinue) { "py" } else { "python" }

if (-not (Test-Path ".venv")) {
    if ($pythonCmd -eq "py") {
        & py -3 -m venv .venv
    } else {
        & python -m venv .venv
    }
}

& .\.venv\Scripts\python.exe -m pip install --upgrade pip
& .\.venv\Scripts\python.exe -m pip install -r requirements.txt

$env:PRINTER_HOST = "192.168.1.242"
$env:CFS_HTTP_HOST = "0.0.0.0"
$env:CFS_HTTP_PORT = "8010"
$env:MAINSAIL_URL = "http://192.168.1.242:4409/"
$env:BACKEND_PUBLIC_URL = "http://127.0.0.1:8010"

& .\.venv\Scripts\python.exe .\app.py
