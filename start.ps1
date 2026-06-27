param(
    [switch]$Fresh,
    [switch]$NoBrowser
)

$ErrorActionPreference = "Continue"
$COMPOSE_FILE = "infrastructure/docker-compose.yml"

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Orchestraty - Start" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# ── Fresh wipe if requested ──────────────────────────────────────────────
if ($Fresh) {
    Write-Host "[!] FRESH START - wiping all data..." -ForegroundColor Red
    docker compose -f $COMPOSE_FILE down -v 2>$null
    Write-Host "  Data wiped." -ForegroundColor Red
    Write-Host ""
}

# ── Step 1: Start Docker services ────────────────────────────────────────
Write-Host "[1/5] Starting Docker services..." -ForegroundColor Yellow

# Build only if -Fresh or first time
if ($Fresh) {
    docker compose -f $COMPOSE_FILE up -d --build
} else {
    docker compose -f $COMPOSE_FILE up -d
}

if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: Docker Compose failed. Is Docker running?" -ForegroundColor Red
    exit 1
}
Write-Host "  Docker services started." -ForegroundColor Green
Write-Host ""

# ── Step 2: Wait for API to be ready ────────────────────────────────────
Write-Host "[2/5] Waiting for API..." -ForegroundColor Yellow

$retry = 0
$maxRetries = 40
while ($retry -lt $maxRetries) {
    try {
        $resp = Invoke-RestMethod -Uri "http://localhost:8000/health" -TimeoutSec 3 -ErrorAction SilentlyContinue
        if ($resp.status -eq "healthy") {
            Write-Host "  API ready." -ForegroundColor Green
            break
        }
    }
    catch { }
    $retry++
    if ($retry % 5 -eq 0) {
        Write-Host "  Still waiting... ($retry/$maxRetries)" -ForegroundColor Gray
    }
    Start-Sleep -Seconds 2
}
if ($retry -ge $maxRetries) {
    Write-Host "  WARNING: API may not be ready. Check: docker compose -f $COMPOSE_FILE logs api" -ForegroundColor Yellow
}
Write-Host ""

# ── Step 3: Install frontend dependencies if needed ─────────────────────
Write-Host "[3/5] Checking frontend dependencies..." -ForegroundColor Yellow
$frontendDir = "frontend/Frontend"

if (-not (Test-Path "$frontendDir/node_modules")) {
    Write-Host "  Installing npm dependencies..." -ForegroundColor Gray
    Push-Location $frontendDir
    npm install
    Pop-Location
}
Write-Host "  Frontend ready." -ForegroundColor Green
Write-Host ""

# ── Step 4: Launch SuperAdmin panel (:5174) in background ───────────────
Write-Host "[4/5] Launching SuperAdmin panel on :5174..." -ForegroundColor Yellow
$saJob = Start-Job -ScriptBlock {
    param($dir)
    Set-Location $dir
    npx vite --config vite.superadmin.config.ts --host 0.0.0.0
} -ArgumentList (Resolve-Path $frontendDir).Path
Write-Host "  SuperAdmin panel starting (background)." -ForegroundColor Green
Write-Host ""

# ── Step 5: Launch main webapp (:5173) ──────────────────────────────────
Write-Host "[5/5] Launching Orchestraty..." -ForegroundColor Yellow
Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Orchestraty is running!" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Main App:         http://localhost:5173" -ForegroundColor Green
Write-Host "  SuperAdmin Panel: http://localhost:5174" -ForegroundColor Green
Write-Host "  API Docs:         http://localhost:8000/docs" -ForegroundColor Green
Write-Host "  MinIO:            http://localhost:9001" -ForegroundColor Green
Write-Host ""
Write-Host "  SuperAdmin:  admin@orchestraty.com" -ForegroundColor Magenta
Write-Host "  (password configured in .env SUPERADMIN_PASSWORD)" -ForegroundColor Gray
Write-Host ""
Write-Host "  Press Ctrl+C to stop." -ForegroundColor Gray
Write-Host ""

# Launch main Vite dev server (blocking — Ctrl+C to stop)
Push-Location $frontendDir
try {
    if ($NoBrowser) {
        npx vite --host 0.0.0.0
    } else {
        npx vite --host 0.0.0.0 --open
    }
} finally {
    # Clean up SuperAdmin background job when main server stops
    Stop-Job $saJob -ErrorAction SilentlyContinue
    Remove-Job $saJob -ErrorAction SilentlyContinue
    Pop-Location
}
