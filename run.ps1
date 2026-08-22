<#
  Data Handler - single-command launcher (Windows / PowerShell).

  Starts the ENTIRE stack in Docker with one command:
  frontend (nginx) + API + Celery worker + Postgres + Redis + MinIO + Qdrant.

  By default it does NOT rebuild — the first run builds the images, and every
  run after that just starts them (fast). Pass -Build after you change code to
  rebuild, or -Fresh for a clean slate.

  Flags (combine freely, e.g.  .\run.ps1 -Build -Llm):
    .\run.ps1              Start everything (builds only if images are missing), open the app.
    .\run.ps1 -Build       Rebuild the images first (use after changing code).
    .\run.ps1 -Fresh       Wipe ALL data volumes, rebuild, and start (clean slate).
    .\run.ps1 -Llm         Also start the bundled Ollama container (local LLM).
    .\run.ps1 -Stop        Stop the stack (data volumes preserved).
    .\run.ps1 -NoBrowser   Start, but don't auto-open the browser.
    .\run.ps1 -Logs        After starting, follow the API + worker logs.
#>
param(
    [switch]$Fresh,
    [switch]$Build,
    [switch]$Llm,
    [switch]$Stop,
    [switch]$NoBrowser,
    [switch]$Logs
)

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot
$COMPOSE = "infrastructure/docker-compose.yml"
$APP_URL = "http://localhost:3000"
$API_URL = "http://localhost:8000"

function Info($m) { Write-Host $m -ForegroundColor White }
function Ok($m)   { Write-Host $m -ForegroundColor Green }
function Warn($m) { Write-Host $m -ForegroundColor Yellow }
function Die($m)  { Write-Host $m -ForegroundColor Red; exit 1 }

Write-Host ""
Write-Host "  DATA HANDLER" -ForegroundColor White
Write-Host "  ------------" -ForegroundColor DarkGray

# Optional Ollama (local LLM) profile.
$profileArgs = @()
if ($Llm) { $profileArgs = @("--profile", "llm") }

# --- Stop mode -------------------------------------------------------------
if ($Stop) {
    Info "Stopping the stack (data volumes are preserved)..."
    docker compose -f $COMPOSE @profileArgs down
    Ok "Stopped."
    exit 0
}

# --- Preconditions ---------------------------------------------------------
try { docker info *> $null } catch { Die "Docker is not running. Start Docker Desktop and try again." }

if (-not (Test-Path ".env")) {
    if (Test-Path ".env.example") {
        Copy-Item ".env.example" ".env"
        Warn "No .env found - created one from .env.example."
    } else {
        Warn "No .env or .env.example found - continuing with compose defaults."
    }
}

# --- Fresh wipe ------------------------------------------------------------
if ($Fresh) {
    Warn "FRESH: removing all containers and data volumes..."
    docker compose -f $COMPOSE @profileArgs down -v
}

# --- Start (build only when asked) -----------------------------------------
# By default we don't rebuild: the first run builds any missing images, later
# runs just start the existing ones (fast). -Build / -Fresh force a rebuild so
# code changes are baked in. --remove-orphans drops containers for services no
# longer in the compose file.
$buildArgs = @()
if ($Build -or $Fresh) {
    $buildArgs = @("--build"); Info "Rebuilding images and starting all services..."
} else {
    # Fast path: pull prebuilt images from GHCR if published (no local build).
    # --ignore-pull-failures lets any service without a published image fall
    # back to building on the 'up' below.
    Info "Pulling prebuilt images (builds any that aren't published yet)..."
    docker compose -f $COMPOSE @profileArgs pull --ignore-pull-failures 2>$null
}
docker compose -f $COMPOSE @profileArgs up -d @buildArgs --remove-orphans
if ($LASTEXITCODE -ne 0) { Die "docker compose failed. See output above.  Logs: docker compose -f $COMPOSE logs api" }

# --- Wait for the API ------------------------------------------------------
Info "Waiting for the API..."
$apiReady = $false
for ($i = 1; $i -le 60; $i++) {
    try {
        $r = Invoke-RestMethod -Uri "$API_URL/health" -TimeoutSec 3
        if ($r.status -eq "healthy") { $apiReady = $true; break }
    } catch { }
    Start-Sleep -Seconds 2
    if ($i % 5 -eq 0) { Warn "  still starting... ($i/60)" }
}
if ($apiReady) { Ok "API is healthy." } else { Warn "API health check timed out - check: docker compose -f $COMPOSE logs -f api" }

# --- Wait for the frontend (so we don't open the browser too early) --------
Info "Waiting for the frontend..."
$webReady = $false
for ($i = 1; $i -le 30; $i++) {
    try {
        $resp = Invoke-WebRequest -Uri $APP_URL -UseBasicParsing -TimeoutSec 3
        if ($resp.StatusCode -eq 200) { $webReady = $true; break }
    } catch { }
    Start-Sleep -Seconds 2
}
if ($webReady) { Ok "Frontend is up." } else { Warn "Frontend not ready yet - it may still be building." }

# --- Done ------------------------------------------------------------------
Write-Host ""
Ok "Stack is up."
Write-Host "  App (UI) ......... $APP_URL"                        -ForegroundColor White
Write-Host "  API + Swagger .... $API_URL/docs"                   -ForegroundColor Gray
Write-Host "  MinIO console .... http://localhost:9001"           -ForegroundColor Gray
Write-Host "  Qdrant ........... http://localhost:6333/dashboard" -ForegroundColor Gray
Write-Host ""
Write-Host "  Flags: -Build  -Fresh  -Llm  -Stop  -NoBrowser  -Logs" -ForegroundColor DarkGray
Write-Host ""

if (-not $NoBrowser) { Start-Process $APP_URL }

if ($Logs) {
    Info "Following API + worker logs (Ctrl+C to stop; the stack keeps running)..."
    docker compose -f $COMPOSE logs -f api celery-worker
}
