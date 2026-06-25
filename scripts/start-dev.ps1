<#
.SYNOPSIS
  一键启动 resume-platform 本地开发环境：FastAPI 后端 + Celery worker（eval/agent 双队列）+ Vite 前端。

.DESCRIPTION
  在三个新的 PowerShell 窗口中分别启动：
    1) Backend：uvicorn app.main:app --reload
    2) Celery worker：celery -A app.workers.celery_app:celery_app worker --pool=threads -Q eval,agent
    3) Frontend：npm run dev

  每个窗口标题独立标识（[BACKEND] / [CELERY] / [FRONTEND]），便于排查。
  关闭对应窗口即可单独停止该服务，不影响其他两个。

.NOTES
  编码说明：本文件使用 UTF-8 with BOM。Windows PowerShell 5.x 默认按 GBK 解码无 BOM 的 .ps1，
  含中文注释的脚本会触发 ParserError；这是项目里唯一允许 BOM 的文件类型，请勿移除。

.PARAMETER ProjectRoot
  项目根目录。默认为脚本所在目录的上一级。

.PARAMETER BackendPort
  后端 uvicorn 监听端口，默认 8000。

.PARAMETER NoFrontend
  跳过前端启动（仅启动 backend + celery）。

.PARAMETER NoCelery
  跳过 Celery 启动（仅启动 backend + frontend）。

.EXAMPLE
  .\scripts\start-dev.ps1
  # 启动全部三个服务

.EXAMPLE
  .\scripts\start-dev.ps1 -NoFrontend
  # 只启动后端 + Celery

.NOTES
  前置条件：
    - backend/ 目录存在 .env（数据库/Redis/LLM 等环境变量）
    - 后端 Python 依赖已安装（pip install -e backend 或 pyproject 同步）
    - 前端依赖已安装（cd frontend ; npm install）
    - Redis 已启动（Celery broker）
#>

[CmdletBinding()]
param(
    [string]$ProjectRoot = (Split-Path -Parent $PSScriptRoot),
    [int]$BackendPort = 8000,
    [switch]$NoFrontend,
    [switch]$NoCelery
)

$ErrorActionPreference = "Stop"

# 解析为绝对路径，避免后续 Set-Location 异常
$ProjectRoot = (Resolve-Path -Path $ProjectRoot).Path
$BackendDir  = Join-Path $ProjectRoot "backend"
$FrontendDir = Join-Path $ProjectRoot "frontend"

# 路径校验
if (-not (Test-Path $BackendDir)) {
    throw "后端目录不存在：$BackendDir"
}
if (-not $NoFrontend -and -not (Test-Path $FrontendDir)) {
    throw "前端目录不存在：$FrontendDir（如不需要前端可加 -NoFrontend）"
}

# .env 校验：缺失会导致 pydantic-settings 启动失败
$envFile = Join-Path $BackendDir ".env"
if (-not (Test-Path $envFile)) {
    Write-Warning "未找到 $envFile，后端可能因缺少环境变量启动失败。"
}

Write-Host "================================================" -ForegroundColor Cyan
Write-Host " resume-platform 本地开发环境启动" -ForegroundColor Cyan
Write-Host "================================================" -ForegroundColor Cyan
Write-Host " ProjectRoot : $ProjectRoot"
Write-Host " BackendDir  : $BackendDir"
Write-Host " FrontendDir : $FrontendDir"
Write-Host " BackendPort : $BackendPort"
Write-Host " NoCelery    : $NoCelery"
Write-Host " NoFrontend  : $NoFrontend"
Write-Host "================================================" -ForegroundColor Cyan

# 通用：在新窗口启动一条命令
# - 标题用 $Host.UI.RawUI.WindowTitle 设置，便于任务栏识别
# - 不设置 -WindowStyle Hidden：开发场景需要看到日志
function Start-DevWindow {
    param(
        [Parameter(Mandatory)] [string]$Title,
        [Parameter(Mandatory)] [string]$WorkingDir,
        [Parameter(Mandatory)] [string]$Command
    )

    $escapedTitle = $Title.Replace("'", "''")
    $escapedDir   = $WorkingDir.Replace("'", "''")
    # 用 -NoExit 让窗口保留以便查看日志/停止
    $inner = @"
`$Host.UI.RawUI.WindowTitle = '$escapedTitle'
Set-Location -Path '$escapedDir'
Write-Host '[$Title] 启动中：$Command' -ForegroundColor Green
$Command
Write-Host ''
Write-Host '[$Title] 进程已退出，按任意键关闭窗口...' -ForegroundColor Yellow
[System.Console]::ReadKey() | Out-Null
"@

    Start-Process -FilePath "powershell.exe" -ArgumentList @(
        "-NoExit",
        "-NoProfile",
        "-ExecutionPolicy", "Bypass",
        "-Command", $inner
    ) | Out-Null
}

# 1) 启动后端
$backendCmd = "python -m uvicorn app.main:app --reload --host 0.0.0.0 --port $BackendPort"
Start-DevWindow -Title "BACKEND" -WorkingDir $BackendDir -Command $backendCmd
Write-Host "[OK] 已派发 BACKEND 窗口（端口 $BackendPort）" -ForegroundColor Green

# 2) 启动 Celery worker
if (-not $NoCelery) {
    # 从 celery_app 读取 ALL_QUEUES（task_routes 的单一来源），保证新增任务模块时
    # 只需在 celery_app.TASK_QUEUE_ROUTES 加一行、脚本无需修改即生效。
    # Windows 强制 threads pool（与 celery_app.py 配置一致），避免 spawn 多进程权限问题。
    # 用 `python -m celery` 而非裸 `celery`：避免依赖 Scripts/ 是否在 PATH。
    Push-Location $BackendDir
    try {
        $queues = (& python -c "from app.workers.celery_app import ALL_QUEUES; print(ALL_QUEUES)" 2>$null).Trim()
    } finally {
        Pop-Location
    }
    if (-not $queues) {
        Write-Warning "无法解析 celery 队列列表，回退到 eval,agent"
        $queues = "eval,agent"
    }
    $celeryCmd = "python -m celery -A app.workers.celery_app:celery_app worker --pool=threads --concurrency=4 -Q $queues -l info"
    Start-DevWindow -Title "CELERY" -WorkingDir $BackendDir -Command $celeryCmd
    Write-Host "[OK] 已派发 CELERY 窗口（队列 $queues）" -ForegroundColor Green
} else {
    Write-Host "[SKIP] -NoCelery 已生效，未启动 Celery worker" -ForegroundColor Yellow
}

# 3) 启动前端
if (-not $NoFrontend) {
    # 首次启动 / worktree 副本里 node_modules 不存在时自动 install，避免 vite 找不到。
    $nodeModules = Join-Path $FrontendDir "node_modules"
    if (-not (Test-Path $nodeModules)) {
        Write-Host "[FRONTEND] 检测到 node_modules 缺失，先执行 npm install ..." -ForegroundColor Yellow
        Push-Location $FrontendDir
        try {
            npm install
            if ($LASTEXITCODE -ne 0) {
                throw "npm install 退出码 $LASTEXITCODE"
            }
        } finally {
            Pop-Location
        }
    }
    $frontendCmd = "npm run dev"
    Start-DevWindow -Title "FRONTEND" -WorkingDir $FrontendDir -Command $frontendCmd
    Write-Host "[OK] 已派发 FRONTEND 窗口（vite dev server）" -ForegroundColor Green
} else {
    Write-Host "[SKIP] -NoFrontend 已生效，未启动前端" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "全部启动指令已派发。请观察各窗口日志确认服务就绪。" -ForegroundColor Cyan
Write-Host "停止：直接关闭对应窗口（或 Ctrl+C）" -ForegroundColor Cyan
