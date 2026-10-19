$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$backend = Join-Path $root 'backend'
$web = Join-Path $root 'web'
$venvPython = Join-Path $backend '.venv\Scripts\python.exe'

if (-not (Test-Path $venvPython)) {
  Write-Host '首次运行：创建后端虚拟环境...' -ForegroundColor Cyan
  py -m venv (Join-Path $backend '.venv')
  & $venvPython -m pip install -e "$backend[dev]"
}

if (-not (Test-Path (Join-Path $web 'node_modules'))) {
  Write-Host '首次运行：安装前端依赖...' -ForegroundColor Cyan
  Push-Location $web
  npm install
  Pop-Location
}

Write-Host '启动后端：http://127.0.0.1:8010' -ForegroundColor Green
Start-Process powershell.exe -WorkingDirectory $backend -ArgumentList @(
  '-NoExit', '-Command',
  "& '$venvPython' -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8010"
)

Write-Host '启动前端：http://localhost:3000' -ForegroundColor Green
Start-Process powershell.exe -WorkingDirectory $web -ArgumentList @(
  '-NoExit', '-Command',
  'npm run dev'
)

Start-Sleep -Seconds 2
Start-Process 'http://localhost:3000'
Write-Host '前后端已启动，浏览器正在打开。' -ForegroundColor Green
