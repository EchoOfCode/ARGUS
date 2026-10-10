@echo off
setlocal
echo.
echo  =============================================================
echo   ARGUS (Autonomous Real-time General Utility System) Launch
echo  =============================================================
echo.

set "REPO_ROOT=%~dp0.."
set "BRAIN_DIR=%REPO_ROOT%\apps\brain"
set "BRIDGE_DIR=%REPO_ROOT%\apps\bridge"

:: 1. Start AI Brain
echo [1/2] Starting AI Brain (apps/brain)...
start "ARGUS Brain" cmd /k "cd /d "%BRAIN_DIR%" && python -m uvicorn main:app --host 127.0.0.1 --port 8000 --reload"

:: 2. Wait for brain initialization
echo Waiting for AI Brain to initialize...
timeout /t 3 /nobreak > nul

:: 3. Start WhatsApp Bridge
echo [2/2] Starting WhatsApp Bridge (apps/bridge)...
start "ARGUS Bridge" cmd /k "cd /d "%BRIDGE_DIR%" && npm run dev"

echo.
echo  =============================================================
echo   ARGUS is starting up!
echo  =============================================================
echo.
echo   Brain Health: http://127.0.0.1:8000/health
echo   Dashboard:    http://127.0.0.1:8000/dashboard
echo   Bridge:       Check the terminal window for WhatsApp QR code
echo.
echo   Close this window - ARGUS runs in the two dedicated windows.
echo  =============================================================
echo.
pause
