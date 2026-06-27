$ErrorActionPreference = "Continue"
$COMPOSE_FILE = "infrastructure/docker-compose.yml"

Write-Host ""
Write-Host "========================================" -ForegroundColor Yellow
Write-Host "  Orchestraty - Stop" -ForegroundColor Yellow
Write-Host "========================================" -ForegroundColor Yellow
Write-Host ""

# 1. Kill leftover Vite dev servers on 5173 (app) and 5273 (marketing site)
Write-Host "[1/3] Killing frontend dev servers..." -ForegroundColor Yellow
foreach ($port in @(5173, 5273)) {
    try {
        $conns = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
        foreach ($c in $conns) {
            $proc = Get-Process -Id $c.OwningProcess -ErrorAction SilentlyContinue
            if ($proc) {
                Write-Host "    Killed: $($proc.ProcessName) on port $port (PID $($proc.Id))" -ForegroundColor Gray
                Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
            }
        }
    } catch { }
}

# Catch any remaining vite/node child processes by command line.
try {
    $nodes = Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue
    foreach ($n in $nodes) {
        if ($n.CommandLine -and ($n.CommandLine -match "vite" -or $n.CommandLine -match "Frontend")) {
            Write-Host "    Killed leftover node: PID $($n.ProcessId)" -ForegroundColor Gray
            Stop-Process -Id $n.ProcessId -Force -ErrorAction SilentlyContinue
        }
    }
} catch { }
Write-Host "    Frontend processes stopped." -ForegroundColor Green
Write-Host ""

# 2. Stop Docker stack (data preserved - use .\setup.ps1 -Fresh to wipe).
Write-Host "[2/3] Stopping Docker containers..." -ForegroundColor Yellow
docker compose -f $COMPOSE_FILE down
Write-Host "    Docker stopped. Data volumes preserved." -ForegroundColor Green
Write-Host ""

# 3. Sanity check
Write-Host "[3/3] Verifying ports are free..." -ForegroundColor Yellow
$stillHeld = @()
foreach ($port in @(5173, 5273, 8000, 5432, 6379)) {
    $conn = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
    if ($conn) { $stillHeld += $port }
}
if ($stillHeld.Count -eq 0) {
    Write-Host "    All Orchestraty ports are free." -ForegroundColor Green
} else {
    Write-Host "    Still in use: $($stillHeld -join ', ') - something else may be using these ports." -ForegroundColor Yellow
}
Write-Host ""

Write-Host "Done. Run .\setup.ps1 to start again, or .\setup.ps1 -Fresh for a clean session." -ForegroundColor Cyan
Write-Host ""
