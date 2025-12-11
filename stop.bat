@echo off
echo ========================================
echo   Stopping TestPoint Application
echo ========================================
echo.

echo Stopping backend processes...
taskkill /F /IM python.exe /FI "COMMANDLINE eq *main.py*" >nul 2>&1
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :8000 ^| findstr LISTENING') do taskkill /F /PID %%a >nul 2>&1

echo Stopping frontend processes...
taskkill /F /IM node.exe /FI "COMMANDLINE eq *next*" >nul 2>&1
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :3009 ^| findstr LISTENING') do taskkill /F /PID %%a >nul 2>&1

timeout /t 1 /nobreak >nul

echo.
echo ========================================
echo   All services stopped
echo ========================================
echo.
pause

