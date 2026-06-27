param(
    # Wipe ALL persisted data (database, uploads, queues, vectors) and
    # start a clean session. Without this flag, setup reuses whatever
    # state is already in Docker volumes.
    [switch]$Fresh,

    # Launch the marketing-website Vite entry (port 5273) instead of the
    # localhost dashboard app. The backend is still brought up so the
    # /api proxy works for any "demo" endpoints used by the marketing site.
    #
    # Default (no flag):  backend (:8000) + dashboard app (:5173)
    # With -Website:      backend (:8000) + marketing website (:5273)
    [switch]$Website,

    # Serve ONLY the standalone coming-soon page (static, no backend/Docker)
    # on port 5373 - the teaser that goes live on orchestraty.com right now.
    [switch]$Coming
)

$ErrorActionPreference = "Continue"
$COMPOSE_FILE = "infrastructure/docker-compose.yml"
$FRONTEND_DIR = "frontend/Frontend"

function Banner($title, $color = "Cyan") {
    Write-Host ""
    Write-Host "========================================" -ForegroundColor $color
    Write-Host "  $title" -ForegroundColor $color
    Write-Host "========================================" -ForegroundColor $color
    Write-Host ""
}

function Step($n, $msg, $color = "Yellow") {
    Write-Host "[$n] $msg" -ForegroundColor $color
}

function Sub($msg, $color = "Gray") {
    Write-Host "    $msg" -ForegroundColor $color
}

# Kill any stale Vite process on our ports so strictPort:true doesn't trip.
function Stop-PortHolders {
    param([int[]]$Ports)
    foreach ($port in $Ports) {
        try {
            $conns = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
            if ($conns) {
                foreach ($c in $conns) {
                    $proc = Get-Process -Id $c.OwningProcess -ErrorAction SilentlyContinue
                    if ($proc) {
                        Sub "Killed stale process on port ${port}: $($proc.ProcessName) (PID $($proc.Id))" "Yellow"
                        Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
                    }
                }
                Start-Sleep -Milliseconds 600
            }
        } catch { }
    }
}

# -Coming: serve ONLY the standalone coming-soon page. It is a single static
# file (inline CSS + JS), so there is no Docker, no backend, no build step.
if ($Coming) {
    Banner "Orchestraty - Coming Soon page (standalone)"
    Stop-PortHolders -Ports @(5373)
    if (-not (Test-Path "$FRONTEND_DIR/node_modules")) {
        Sub "Installing frontend dependencies (first run)..." "Yellow"
        Push-Location $FRONTEND_DIR; npm install; Pop-Location
    }
    Write-Host ""
    Write-Host "  Coming Soon page: http://localhost:5373" -ForegroundColor Green
    Write-Host "  Standalone teaser for orchestraty.com - no backend, no Docker." -ForegroundColor Gray
    Write-Host "  To deploy: npm run build:coming  ->  frontend/Frontend/dist-coming/" -ForegroundColor Gray
    Write-Host ""
    Write-Host "  Ctrl+C stops it." -ForegroundColor Gray
    Write-Host ""
    Push-Location $FRONTEND_DIR
    try {
        npx vite --config vite.coming.config.ts --host 0.0.0.0 --open
    } finally {
        Pop-Location
        Write-Host ""
        Write-Host "Coming Soon page stopped." -ForegroundColor Yellow
    }
    return
}

$mode = if ($Website -and $Fresh) { "Website + Fresh (wipe data)" }
        elseif ($Website)          { "Website (marketing site)" }
        elseif ($Fresh)            { "Fresh (wipe data)" }
        else                       { "Normal start" }
Banner "Orchestraty - Setup ($mode)"

Step "1/5" "Cleaning up stale processes from previous runs..."
# Always clean both Vite ports so switching between modes never trips over a stale child.
Stop-PortHolders -Ports @(5173, 5273)
Sub "Cleanup done." "Green"
Write-Host ""

if ($Fresh) {
    Step "2/5" "WIPE: removing ALL data (DB, uploads, queues, vectors)..." "Red"
    docker compose -f $COMPOSE_FILE down -v
    Sub "All persisted data destroyed." "Red"
} else {
    Step "2/5" "Reusing existing containers..."
}
Write-Host ""

Step "3/5" "Starting Docker services..."
docker compose -f $COMPOSE_FILE up -d
if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "ERROR: Docker Compose failed. Is Docker Desktop running?" -ForegroundColor Red
    exit 1
}
Sub "Services started." "Green"
Write-Host ""

Step "4/5" "Waiting for services to be healthy..."

# Postgres
$retry = 0
while ($retry -lt 30) {
    docker exec orchestraty-postgres pg_isready -U orchestraty -d orchestraty 2>&1 | Out-Null
    if ($LASTEXITCODE -eq 0) { Sub "PostgreSQL: Ready" "Green"; break }
    $retry++; Start-Sleep -Seconds 2
}
if ($retry -ge 30) { Sub "PostgreSQL: NOT ready after 60s" "Red" }

# Redis
$retry = 0
while ($retry -lt 15) {
    $r = docker exec orchestraty-redis redis-cli ping 2>&1
    if ("$r" -match "PONG") { Sub "Redis: Ready" "Green"; break }
    $retry++; Start-Sleep -Seconds 2
}

# API
$retry = 0; $apiReady = $false
while ($retry -lt 40) {
    try {
        $resp = Invoke-RestMethod -Uri "http://localhost:8000/health" -TimeoutSec 3 -ErrorAction SilentlyContinue
        if ($resp.status -eq "healthy") { $apiReady = $true; break }
    } catch { }
    $retry++; Start-Sleep -Seconds 2
}
if ($apiReady) {
    Sub "API Server: Ready (uvicorn --reload mode)" "Green"
} else {
    Sub "API Server: NOT ready after 80s - check 'docker logs orchestraty-api'" "Red"
}

# MinIO
try {
    Invoke-WebRequest -Uri "http://localhost:9001" -UseBasicParsing -TimeoutSec 3 -ErrorAction SilentlyContinue | Out-Null
    Sub "MinIO: Ready" "Green"
} catch { Sub "MinIO: Starting..." "Gray" }

# Celery worker
$celery = docker inspect --format "{{.State.Status}}" orchestraty-celery-worker 2>&1
if ("$celery" -match "running") {
    Sub "Celery Worker: Running" "Green"
} else {
    Sub "Celery Worker: $celery" "Yellow"
}
Write-Host ""

# Frontend deps
Step "5/5" "Checking frontend dependencies..."
$needInstall = $false
if (-not (Test-Path "$FRONTEND_DIR/node_modules")) {
    $needInstall = $true
} else {
    $lock = "$FRONTEND_DIR/node_modules/.package-lock.json"
    if (-not (Test-Path $lock) -or ((Get-Item "$FRONTEND_DIR/package.json").LastWriteTime -gt (Get-Item $lock).LastWriteTime)) {
        $needInstall = $true
    }
}
if ($needInstall) {
    Sub "Installing / updating frontend dependencies (package.json changed)..." "Yellow"
    Push-Location $FRONTEND_DIR
    npm install
    Pop-Location
} else {
    Sub "node_modules up to date." "Green"
}
Write-Host ""

if ($Website) {
    Banner "Orchestraty marketing website is running!" "Green"
    Write-Host "  Marketing Website: http://localhost:5273" -ForegroundColor Green
    Write-Host "  Documentation:     http://localhost:5273/docs" -ForegroundColor Green
    Write-Host "  API Docs:          http://localhost:8000/docs" -ForegroundColor Green
    Write-Host ""
    Write-Host "  This is the marketing site (the live-website target)." -ForegroundColor Gray
    Write-Host "  The dashboard app is NOT running. Drop -Website to switch." -ForegroundColor Gray
    Write-Host ""
    Write-Host "  Ctrl+C stops the site. Docker keeps running until .\stop.ps1." -ForegroundColor Gray
    Write-Host ""

    Push-Location $FRONTEND_DIR
    try {
        npx vite --config vite.website.config.ts --host 0.0.0.0 --open
    } finally {
        Pop-Location
        Write-Host ""
        Write-Host "Marketing website stopped. Docker is still running." -ForegroundColor Yellow
        Write-Host "Run .\stop.ps1 to bring everything down." -ForegroundColor Gray
    }
} else {
    Banner "Orchestraty is running!" "Green"
    Write-Host "  App:              http://localhost:5173" -ForegroundColor Green
    Write-Host "  API Docs:         http://localhost:8000/docs" -ForegroundColor Green
    Write-Host "  MinIO Console:    http://localhost:9001" -ForegroundColor Green
    Write-Host ""
    Write-Host "  Commands:" -ForegroundColor White
    Write-Host '    .\setup.ps1            Start the localhost app' -ForegroundColor Gray
    Write-Host '    .\setup.ps1 -Website   Start the marketing website (port 5273)' -ForegroundColor Gray
    Write-Host '    .\setup.ps1 -Coming    Start the standalone coming-soon page (port 5373)' -ForegroundColor Gray
    Write-Host '    .\setup.ps1 -Fresh     Wipe ALL data and start fresh' -ForegroundColor Gray
    Write-Host '    .\stop.ps1             Stop' -ForegroundColor Gray
    Write-Host ""
    Write-Host "  Ctrl+C stops the app. Docker keeps running until .\stop.ps1." -ForegroundColor Gray
    Write-Host ""

    Push-Location $FRONTEND_DIR
    try {
        npx vite --host 0.0.0.0 --open
    } finally {
        Pop-Location
        Write-Host ""
        Write-Host "App stopped. Docker is still running." -ForegroundColor Yellow
        Write-Host "Run .\stop.ps1 to bring everything down." -ForegroundColor Gray
    }
}
