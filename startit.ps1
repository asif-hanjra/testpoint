# PowerShell script to start both backend and frontend
Write-Host "Starting TestPoint Application..." -ForegroundColor Green
Write-Host ""

# Get the script directory
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $scriptDir

# Start backend in background
Write-Host "Starting backend..." -ForegroundColor Yellow
$backendJob = Start-Job -ScriptBlock {
    Set-Location $using:scriptDir
    Set-Location backend
    & .\venv\Scripts\Activate.ps1
    python main.py
}

# Wait a bit for backend to start
Start-Sleep -Seconds 3

# Start frontend in background
Write-Host "Starting frontend..." -ForegroundColor Yellow
$frontendJob = Start-Job -ScriptBlock {
    Set-Location $using:scriptDir
    Set-Location frontend
    npm run dev
}

Write-Host ""
Write-Host "Both services are starting!" -ForegroundColor Green
Write-Host ""
Write-Host "Backend will be available at: http://localhost:8000" -ForegroundColor Cyan
Write-Host "Frontend will be available at: http://localhost:3009" -ForegroundColor Cyan
Write-Host ""
Write-Host "To view logs, use: Get-Job | Receive-Job" -ForegroundColor Gray
Write-Host "To stop servers, press Ctrl+C" -ForegroundColor Gray
Write-Host ""

# Keep the script running and show output
try {
    while ($true) {
        Receive-Job -Job $backendJob, $frontendJob -ErrorAction SilentlyContinue
        Start-Sleep -Seconds 1
    }
} finally {
    Write-Host "Stopping servers..." -ForegroundColor Yellow
    Stop-Job -Job $backendJob, $frontendJob -ErrorAction SilentlyContinue
    Remove-Job -Job $backendJob, $frontendJob -ErrorAction SilentlyContinue
}

