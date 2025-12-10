@echo off
echo ========================================
echo   Starting TestPoint Application
echo ========================================
echo.

REM Get the directory where the script is located
cd /d "%~dp0"

REM Start backend in a new window
echo [1/2] Starting backend server...
start "Backend Server" cmd /k "cd /d %~dp0backend && venv\Scripts\activate && python main.py"

REM Wait a bit for backend to start
timeout /t 3 /nobreak >nul

REM Start frontend in a new window
echo [2/2] Starting frontend server...
start "Frontend Server" cmd /k "cd /d %~dp0frontend && npm run dev"

echo.
echo ========================================
echo   Both services are starting!
echo ========================================
echo.
echo   Backend:  http://localhost:8000
echo   Frontend: http://localhost:3009
echo.
echo   Two new windows have opened - one for each server.
echo   To stop: Close the windows or press Ctrl+C in each.
echo.
pause

