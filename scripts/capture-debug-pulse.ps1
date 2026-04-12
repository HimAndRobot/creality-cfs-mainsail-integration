param(
    [int]$DurationSeconds = 5,
    [int]$IntervalMs = 250,
    [string]$BaseUrl = "http://127.0.0.1:8010",
    [string]$OutFile = ""
)

$ErrorActionPreference = "Stop"

if ($DurationSeconds -lt 1) {
    throw "DurationSeconds must be >= 1."
}

if ($IntervalMs -lt 50) {
    throw "IntervalMs must be >= 50."
}

function Get-DebugState {
    param([string]$Url)
    return Invoke-RestMethod -Uri ($Url.TrimEnd("/") + "/api/debug") -Method Get
}

function Get-FeedStateValue {
    param($Parsed)
    if ($null -eq $Parsed) { return $null }
    if ($Parsed -is [System.Collections.IDictionary] -and $Parsed.Contains("feedState")) {
        return $Parsed["feedState"]
    }
    return $null
}

$base = $BaseUrl.TrimEnd("/")
$startedAtPrecise = [double]([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()) / 1000.0
$deadline = (Get-Date).AddSeconds($DurationSeconds)
$lastSeenFrameTs = $startedAtPrecise
$samples = New-Object System.Collections.ArrayList
$capturedFrames = New-Object System.Collections.ArrayList

Write-Host ("[capture-debug-pulse] polling {0} every {1}ms for {2}s..." -f $base, $IntervalMs, $DurationSeconds)

while ((Get-Date) -lt $deadline) {
    $debug = Get-DebugState -Url $base

    $newFrames = @()
    if ($debug.frames) {
        $newFrames = @($debug.frames | Where-Object { $_.ts -gt $lastSeenFrameTs })
        if ($newFrames.Count -gt 0) {
            $lastSeenFrameTs = ($newFrames | Measure-Object -Property ts -Maximum).Maximum
            foreach ($frame in $newFrames) {
                [void]$capturedFrames.Add($frame)
            }
        }
    }

    $feedStates = @()
    foreach ($frame in $newFrames) {
        $feedState = Get-FeedStateValue -Parsed $frame.parsed
        if ($null -ne $feedState) {
            $feedStates += [int]$feedState
        }
    }

    $sample = [ordered]@{
        ts = [double]([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()) / 1000.0
        connected = $debug.connected
        last_error = $debug.last_error
        new_frame_count = @($newFrames).Count
        feed_states = @($feedStates)
        raw_last_message = $debug.raw_last_message
    }
    [void]$samples.Add($sample)

    Start-Sleep -Milliseconds $IntervalMs
}

$summary = [ordered]@{
    captured_at = [DateTimeOffset]::UtcNow.ToString("o")
    duration_seconds = $DurationSeconds
    interval_ms = $IntervalMs
    base_url = $base
    started_at_precise = $startedAtPrecise
    sample_count = $samples.Count
    samples = $samples
    captured_frames = $capturedFrames
}

$json = $summary | ConvertTo-Json -Depth 20

if ($OutFile) {
    $outDir = Split-Path -Parent $OutFile
    if ($outDir) {
        New-Item -ItemType Directory -Force -Path $outDir | Out-Null
    }
    Set-Content -Path $OutFile -Value $json -Encoding UTF8
    Write-Host ("[capture-debug-pulse] saved to {0}" -f $OutFile)
} else {
    $json
}
