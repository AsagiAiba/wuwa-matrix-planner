param([string]$ReleaseDirectory)
$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
if (-not $ReleaseDirectory) { $ReleaseDirectory = Join-Path $projectRoot 'dist\WuwaMatrixPlanner-v0.1.0-win-x64' }
$ReleaseDirectory = [IO.Path]::GetFullPath($ReleaseDirectory)
$manifest = Get-Content -LiteralPath (Join-Path $ReleaseDirectory 'release-manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json
foreach ($entry in $manifest.files) {
    $file = Join-Path $ReleaseDirectory $entry.path
    if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { throw "Missing file: $($entry.path)" }
    $hash = (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($hash -ne $entry.sha256) { throw "Hash mismatch: $($entry.path)" }
}
$launcher = Join-Path $ReleaseDirectory '终焉矩阵血线排布.exe'
$env:PATH = "$env:SystemRoot\System32"
$process = $null
$serverProcessId = $null
try {
    $process = Start-Process -FilePath $launcher -ArgumentList @('--headless','--port','4186') -WindowStyle Hidden -PassThru
    $health = $null
    for ($attempt = 0; $attempt -lt 50; $attempt++) {
        Start-Sleep -Milliseconds 150
        for ($port = 4186; $port -lt 4196; $port++) {
            try {
                $candidate = Invoke-RestMethod -Uri "http://127.0.0.1:$port/__matrix_health" -TimeoutSec 1
                if ($candidate.root -eq $ReleaseDirectory -and $candidate.app -eq 'wuwa-matrix-hp-planner') { $health = $candidate; $testPort = $port; break }
            } catch { }
        }
        if ($health) { break }
        if ($process.HasExited) { throw "Launcher exited: $($process.ExitCode)" }
    }
    if (-not $health) { throw 'Packaged service did not start.' }
    if ($health.version -ne '0.1.0') { throw 'Packaged version mismatch.' }
    $serverProcessId = [int]$health.pid
    $baseUrl = "http://127.0.0.1:$testPort"
    $html = (Invoke-WebRequest -Uri $baseUrl -UseBasicParsing).Content
    if (-not $html.Contains('V0.1')) { throw 'Version badge not present.' }
    $scores = Invoke-RestMethod -Uri "$baseUrl/data/scores.json"
    if ($scores.records.Count -ne 75 -or $scores.max_round -ne 15) { throw 'Score data mismatch.' }
    $second = Start-Process -FilePath $launcher -ArgumentList @('--headless','--port','4186') -WindowStyle Hidden -PassThru
    if (-not $second.WaitForExit(8000) -or $second.ExitCode -ne 0) { throw 'Second launch did not reuse existing service.' }
    $after = Invoke-RestMethod -Uri "$baseUrl/__matrix_health"
    if ($after.pid -ne $serverProcessId) { throw 'Server reuse changed the process.' }
    $env:MATRIX_URL = $baseUrl
    $sourceNode = Join-Path $ReleaseDirectory 'runtime\node.exe'
    Push-Location $projectRoot
    try {
        & $sourceNode 'tools/browser_smoke.mjs'
        if ($LASTEXITCODE -ne 0) { throw 'Packaged browser checks failed.' }
    } finally { Pop-Location }
    Write-Output "PASS: $($manifest.fileCount) file hashes; no PATH Node.js; packaged EXE; V0.1 API and UI; bundled R15 data; second launch reuse; full browser workflow."
} finally {
    if ($serverProcessId) {
        try {
            $check = Invoke-RestMethod -Uri "http://127.0.0.1:$testPort/__matrix_health" -TimeoutSec 1
            if ($check.root -eq $ReleaseDirectory -and [int]$check.pid -eq $serverProcessId) { Stop-Process -Id $serverProcessId -Force -ErrorAction SilentlyContinue }
        } catch { }
    }
    if ($process -and -not $process.HasExited) { Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue }
    Remove-Item Env:MATRIX_URL -ErrorAction SilentlyContinue
}
