@echo off
echo ========================================
echo   Starting TestPoint Application
echo ========================================
echo.

REM Get the directory where the script is located
cd /d "%~dp0"

REM Start backend in background
echo [1/2] Starting backend server...
cd backend
start /b "" cmd /c "venv\Scripts\activate && python main.py > ..\backend.log 2>&1"
cd ..
echo Backend started in background

REM Wait a bit for backend to start
timeout /t 3 /nobreak >nul

REM Start frontend in background
echo [2/2] Starting frontend server...
cd frontend
start /b "" cmd /c "npm run dev > ..\frontend.log 2>&1"
cd ..
echo Frontend started in background

echo.
echo ========================================
echo   Both services are starting!
echo ========================================
echo.
echo   Backend:  http://localhost:8000
echo   Frontend: http://localhost:3009
echo.
echo   Services are running in the background.
echo.
echo   To view logs:
echo     Backend:  type backend.log
echo     Frontend: type frontend.log
echo.
echo   To stop servers:
echo     stop.bat
echo.
pause

