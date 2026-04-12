param(
    [int]$DurationSeconds = 5,
    [string]$BaseUrl = "http://127.0.0.1:8010",
    [string]$OutFile = ""
)

$ErrorActionPreference = "Stop"

if ($DurationSeconds -lt 1) {
    throw "DurationSeconds must be >= 1."
}

function Get-DebugState {
    param([string]$Url)
    return Invoke-RestMethod -Uri ($Url.TrimEnd("/") + "/api/debug") -Method Get
}

$base = $BaseUrl.TrimEnd("/")
$startedAt = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
$startedAtFloat = [double]([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()) / 1000.0

Write-Host ("[capture-debug] capturing from {0} for {1}s..." -f $base, $DurationSeconds)
Start-Sleep -Seconds $DurationSeconds

$debug = Get-DebugState -Url $base
$frames = @()
if ($debug.frames) {
    $frames = @($debug.frames | Where-Object {
        $_.ts -ge $startedAtFloat
    })
}

$summary = [ordered]@{
    captured_at = [DateTimeOffset]::UtcNow.ToString("o")
    duration_seconds = $DurationSeconds
    base_url = $base
    started_at_unix = $startedAt
    started_at_precise = $startedAtFloat
    connected = $debug.connected
    last_error = $debug.last_error
    last_boxs_info_at = $debug.last_boxs_info_at
    messages_seen = $debug.messages_seen
    captured_frames = $frames
    raw_last_boxs_info = $debug.raw_last_boxs_info
}

$json = $summary | ConvertTo-Json -Depth 20

if ($OutFile) {
    $outDir = Split-Path -Parent $OutFile
    if ($outDir) {
        New-Item -ItemType Directory -Force -Path $outDir | Out-Null
    }
    Set-Content -Path $OutFile -Value $json -Encoding UTF8
    Write-Host ("[capture-debug] saved to {0}" -f $OutFile)
} else {
    $json
}
