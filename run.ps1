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
    .\run.ps1 -Llm         Also start the bundled Ollama and pull the default model.
    .\run.ps1 -Dev         Live code reload (mounts the repo over the image).
    .\run.ps1 -Stop        Stop the stack (data volumes preserved).
    .\run.ps1 -NoBrowser   Start, but don't auto-open the browser.
    .\run.ps1 -Logs        After starting, follow the API + worker logs.

  -Dev is for contributors editing Python. It mounts this repo over /app so the
  API hot-reloads, at the cost of much slower startup on Docker Desktop (every
  import crosses the host filesystem bridge and the image's precompiled
  bytecode is masked). Without it you run exactly the code in the image.
#>
param(
    [switch]$Fresh,
    [switch]$Build,
    [switch]$Llm,
    [switch]$Dev,
    [switch]$Stop,
    [switch]$NoBrowser,
    [switch]$Logs
)

# Deliberately "Continue", not "Stop".
#
# Docker writes progress bars, warnings and "not found" notices to stderr as a
# matter of course. Under $ErrorActionPreference='Stop', Windows PowerShell 5.1
# converts any REDIRECTED native stderr into a terminating NativeCommandError —
# so `docker image inspect ... *> $null` on a missing image killed this script
# outright, and `docker info *> $null` was a latent copy of the same bug.
#
# Real failures are caught explicitly via $LASTEXITCODE checks instead, which is
# the only reliable signal for a native command on 5.1.
$ErrorActionPreference = "Continue"

# PowerShell 7.3+ routes native stderr through $ErrorActionPreference even
# without redirection. Opt out. The variable does not exist on 5.1, where
# assigning it is a harmless no-op.
$PSNativeCommandUseErrorActionPreference = $false

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

# Compose file set. -Dev layers the live-reload overlay on top of the base file.
$COMPOSE_DEV = "infrastructure/docker-compose.dev.yml"
$composeFiles = @("-f", $COMPOSE)
if ($Dev) {
    $composeFiles += @("-f", $COMPOSE_DEV)
}

# Optional Ollama (local LLM) profile.
$profileArgs = @()
if ($Llm) {
    $profileArgs = @("--profile", "llm")
    # Point the app at the bundled Ollama on the compose network. Without this
    # the app keeps the .env default (host.docker.internal), which addresses an
    # Ollama on the HOST — so -Llm would start a container nothing talks to.
    # docker-compose.yml reads this as ${OLLAMA_BASE_URL:-...}.
    $env:OLLAMA_BASE_URL = "http://ollama:11434"
}

# Windows' legacy console host (conhost) does not enable ANSI/VT escape
# processing by default. Without it, Docker's progress renderer cannot move the
# cursor to redraw its bars in place, so it reprints a whole frame on every
# refresh — producing hundreds of duplicate "Downloading 78.64MB" lines.
# Turning VT on gives the normal single-line-per-layer progress display.
#
# Best-effort: on any failure (older Windows, restricted host) we simply fall
# back to the noisier output rather than breaking the run.
try {
    Add-Type -Namespace DhConsole -Name Vt -MemberDefinition @'
[DllImport("kernel32.dll", SetLastError=true)]
public static extern IntPtr GetStdHandle(int nStdHandle);
[DllImport("kernel32.dll", SetLastError=true)]
public static extern bool GetConsoleMode(IntPtr hConsoleHandle, out uint lpMode);
[DllImport("kernel32.dll", SetLastError=true)]
public static extern bool SetConsoleMode(IntPtr hConsoleHandle, uint dwMode);
'@ -ErrorAction Stop
    $stdOut = [DhConsole.Vt]::GetStdHandle(-11)   # STD_OUTPUT_HANDLE
    $mode = 0
    if ([DhConsole.Vt]::GetConsoleMode($stdOut, [ref]$mode)) {
        # 0x0004 = ENABLE_VIRTUAL_TERMINAL_PROCESSING
        [void][DhConsole.Vt]::SetConsoleMode($stdOut, $mode -bor 0x0004)
    }
} catch { }

# --- Stop mode -------------------------------------------------------------
if ($Stop) {
    Info "Stopping the stack (data volumes are preserved)..."
    docker compose @composeFiles @profileArgs down
    if ($LASTEXITCODE -ne 0) { Die "docker compose down failed. See output above." }
    Ok "Stopped."
    exit 0
}

# --- Preconditions ---------------------------------------------------------
# Check the exit code, not an exception. In Windows PowerShell 5.1 a native
# command's non-zero exit does NOT throw, so the old try/catch here never fired
# and a stopped Docker Desktop surfaced much later as a confusing compose error.
docker info *> $null
if ($LASTEXITCODE -ne 0) { Die "Docker is not running. Start Docker Desktop and try again." }

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
    docker compose @composeFiles @profileArgs down -v
}

# --- Start (build only when asked) -----------------------------------------
# By default we don't rebuild: the first run builds any missing images, later
# runs just start the existing ones (fast). -Build / -Fresh force a rebuild so
# code changes are baked in. --remove-orphans drops containers for services no
# longer in the compose file.
$buildArgs = @()
if ($Build -or $Fresh) {
    $buildArgs = @("--build")
    Info "Rebuilding images and starting all services."
    Write-Host "  First build takes roughly 5-10 minutes (compiling hdbscan," -ForegroundColor DarkGray
    Write-Host "  downloading wheels). Later builds reuse cached layers and"   -ForegroundColor DarkGray
    Write-Host "  finish in under a minute. Live build progress follows."      -ForegroundColor DarkGray
    Write-Host ""
} else {
    # Fast path: pull prebuilt images from GHCR if published (no local build).
    # --ignore-pull-failures lets any service without a published image fall
    # back to building on the 'up' below.
    #
    # Docker writes ALL pull progress to stderr. This used to end in `2>$null`,
    # which discarded Compose's own per-layer progress bars along with the
    # errors — so a perfectly healthy multi-minute pull looked identical to a
    # freeze. Never redirect this.
    #
    # Compose's default --progress=auto already renders live per-layer bars on a
    # terminal and falls back to plain line output when redirected, so we do not
    # pass --progress explicitly (older Compose builds reject the flag).
    # What Compose does NOT tell you is the total size or the elapsed time, so
    # we bracket the call with both.
    Write-Host ""
    Info "Downloading images."
    Write-Host "  App images ......... ~500 MB (backend + frontend)"             -ForegroundColor Gray
    Write-Host "  Service images ..... ~300 MB (Postgres, Redis, MinIO, Qdrant)" -ForegroundColor Gray
    Write-Host "  Unpacked on disk ... ~1.9 GB"                                  -ForegroundColor Gray
    Write-Host ""
    Write-Host "  One-time cost - later runs start in seconds. Docker's live"    -ForegroundColor DarkGray
    Write-Host "  per-layer progress follows."                                   -ForegroundColor DarkGray
    Write-Host "  Safe to Ctrl+C - finished layers are kept and resumed."        -ForegroundColor DarkGray
    Write-Host ""

    # No --progress flag. Compose's default ("auto") renders live per-layer bars
    # on a VT-capable terminal and degrades to plain lines when redirected. The
    # VT-enable block near the top of this script is what makes the good path
    # work on Windows' legacy console. Explicitly forcing "plain" was worse: it
    # re-prints every layer on each poll tick even when nothing changed.
    $pullTimer = [System.Diagnostics.Stopwatch]::StartNew()
    docker compose @composeFiles @profileArgs pull --ignore-pull-failures
    $pullTimer.Stop()
    Ok ("Download finished in {0:mm\:ss}." -f $pullTimer.Elapsed)

    # A missing image is NOT auto-built by `up`. When a service declares both
    # `image:` and `build:`, Compose resolves the reference and fails hard if
    # the registry does not have it — it does not silently fall back to the
    # build section. So check explicitly and add --build ourselves.
    # Use `docker images -q`, NOT `docker image inspect`.
    #
    # `docker image inspect` writes "No such image" to stderr for a missing
    # image, and $ErrorActionPreference='Stop' (top of this file) makes Windows
    # PowerShell 5.1 turn ANY native-command stderr into a terminating
    # NativeCommandError — even when the stream is redirected with `*> $null`.
    # `docker images -q` writes nothing to stderr: it prints the image ID if
    # present and an empty string if not.
    $apiImage = "ghcr.io/samratrajsharma/data-handler-api:latest"
    $apiImageId = docker images -q $apiImage
    if ([string]::IsNullOrWhiteSpace($apiImageId)) {
        Warn "$apiImage is not published yet - building it locally instead."
        Write-Host "  First build takes roughly 5-10 minutes; later builds reuse" -ForegroundColor DarkGray
        Write-Host "  cached layers and finish in under a minute."                -ForegroundColor DarkGray
        Write-Host ""
        $buildArgs = @("--build")
    }
}
# Not redirected either: if an image still has to be built here (e.g. a tag that
# isn't published yet), BuildKit's own progress output is the only feedback the
# user gets, and it can run for several minutes.
Info "Starting services..."
docker compose @composeFiles @profileArgs up -d @buildArgs --remove-orphans
if ($LASTEXITCODE -ne 0) { Die "docker compose failed. See output above.  Logs: docker compose @composeFiles logs api" }

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
if ($apiReady) {
    Ok "API is healthy."
} else {
    Warn "API health check timed out after 120s."
    # A boot crash + `restart: unless-stopped` looks exactly like a slow start,
    # so show the evidence instead of making the user go find it.
    Write-Host ""
    Write-Host "  Last 40 lines of the api log:" -ForegroundColor Yellow
    docker compose @composeFiles logs --tail=40 api
    Write-Host ""
}

# --- Check the Celery worker ----------------------------------------------
# Without this a crash-looping worker is invisible: the API answers, the UI
# loads, and every background job queues forever with no error anywhere.
Info "Checking the background worker..."
$workerState = docker compose @composeFiles ps -a --format "{{.Service}} {{.State}}" |
               Select-String -SimpleMatch "celery-worker"
if ($workerState -match "running") {
    Ok "Worker is running."
} else {
    Warn "Celery worker is not running - background jobs will queue forever."
    Write-Host "  Last 20 lines of the worker log:" -ForegroundColor Yellow
    docker compose @composeFiles logs --tail=20 celery-worker
    $workerFailed = $true
}

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
# Report honestly. This used to print "Stack is up." unconditionally, even when
# BOTH health checks had timed out — so a total failure and a clean start looked
# identical, and the exit code was 0 either way.
Write-Host ""
if (-not $apiReady) {
    Write-Host "  Stack did NOT come up cleanly." -ForegroundColor Red
    Write-Host "  The API never answered $API_URL/health. Logs are above." -ForegroundColor Red
    Write-Host "  Follow them live with:  .\run.ps1 -Logs" -ForegroundColor Gray
    Write-Host ""
    exit 1
}
if ($workerFailed) { Warn "Stack is up, but the background worker is down (see above)." }
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
    docker compose @composeFiles logs -f api celery-worker
}
