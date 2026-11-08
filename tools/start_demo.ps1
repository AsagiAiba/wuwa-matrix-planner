param([switch]$NoBrowser, [switch]$CheckOnly)
$ErrorActionPreference = 'Stop'
try {
    $projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
    $nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
    $candidates = @(
        $(if ($nodeCommand) { $nodeCommand.Source }),
        (Join-Path $projectRoot 'runtime\node.exe'),
        (Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'),
        (Join-Path $env:ProgramFiles 'nodejs\node.exe'),
        (Join-Path $env:LOCALAPPDATA 'Programs\nodejs\node.exe')
    )
    $nodePath = $candidates | Where-Object { $_ -and (Test-Path -LiteralPath $_ -PathType Leaf) } | Select-Object -First 1
    if (-not $nodePath) { throw '未找到 Node.js 运行时，请安装 Node.js 后重试。' }
    if ($CheckOnly) { Write-Output $nodePath; exit 0 }
    $port = 4173
    if ($env:MATRIX_PORT) { $port = [int]$env:MATRIX_PORT }
    $url = "http://127.0.0.1:$port"
    function Get-DemoStatus {
        try { return Invoke-RestMethod -Uri "$url/__matrix_health" -TimeoutSec 1 } catch { return $null }
    }
    $status = Get-DemoStatus
    if (-not $status -or $status.app -ne 'wuwa-matrix-hp-planner') {
        $logDir = Join-Path $projectRoot 'outputs'
        [void](New-Item -ItemType Directory -Force -Path $logDir)
        $process = Start-Process -FilePath $nodePath -ArgumentList @('server.mjs') -WorkingDirectory $projectRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $logDir 'demo-server.log') -RedirectStandardError (Join-Path $logDir 'demo-server-error.log') -PassThru
        for ($attempt = 0; $attempt -lt 30; $attempt++) {
            Start-Sleep -Milliseconds 150
            $status = Get-DemoStatus
            if ($status -and $status.app -eq 'wuwa-matrix-hp-planner') { break }
            if ($process.HasExited) { break }
        }
    }
    if (-not $status -or $status.app -ne 'wuwa-matrix-hp-planner') { throw "Demo 启动失败，请查看 outputs\demo-server-error.log；端口 $port 可能已被其他程序占用。" }
    if ($status.root -ne $projectRoot) { throw "端口 $port 正在运行另一个目录的 Demo，请先关闭该服务。" }
    Write-Output "Demo 已启动：$url"
    if (-not $NoBrowser) { Start-Process -FilePath $url }
    exit 0
} catch {
    Write-Host $_.Exception.Message -ForegroundColor Red
    exit 1
}
