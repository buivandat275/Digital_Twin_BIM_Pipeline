$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $projectRoot

Write-Host "Đang khởi động PostgreSQL và FastAPI bằng Docker..." -ForegroundColor Cyan
docker compose up -d --build postgres api
if ($LASTEXITCODE -ne 0) {
    throw "Docker Compose không thể khởi động API."
}

Write-Host "FastAPI: http://127.0.0.1:8010" -ForegroundColor Green
Write-Host "API docs: http://127.0.0.1:8010/docs" -ForegroundColor Green
Write-Host "Xem log: docker compose logs -f api" -ForegroundColor Yellow
docker compose ps
