@echo off
echo.
echo  =======================================
echo   ARGUS v2 - Personal AI Assistant
echo  =======================================
echo.

:: Start AI Brain
echo [1/2] Starting AI Brain (backend)...
start "ARGUS Brain" cmd /k "cd /d e:\ARGUS\backend && python -m uvicorn main:app --host 127.0.0.1 --port 8000 --reload"

:: Wait for brain to initialize
echo Waiting for Brain to start...
timeout /t 3 /nobreak > nul

:: Start WhatsApp Bridge
echo [2/2] Starting WhatsApp Bridge...
start "ARGUS Bridge" cmd /k "cd /d e:\ARGUS\bridge && npm run dev"

echo.
echo  =======================================
echo   ARGUS is starting up!
echo  =======================================
echo.
echo   Brain:  http://127.0.0.1:8000/health
echo   Bridge: Check its terminal for QR code
echo.
echo   Close this window - ARGUS runs in the
echo   two terminals that just opened.
echo  =======================================
echo.
pause
