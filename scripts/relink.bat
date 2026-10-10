@echo off
setlocal
echo.
echo  =======================================
echo   ARGUS — Fresh WhatsApp Pairing
echo  =======================================
echo.

set "REPO_ROOT=%~dp0.."
set "BRAIN_DIR=%REPO_ROOT%\apps\brain"
set "BRIDGE_DIR=%REPO_ROOT%\apps\bridge"

echo  [1/3] Clearing old encryption session keys...
if exist "%BRIDGE_DIR%\auth_info" (
    del /q /s "%BRIDGE_DIR%\auth_info\*" > nul 2>&1
)

echo  [2/3] Starting AI Brain (Python Backend)...
start "ARGUS Brain" cmd /k "cd /d "%BRAIN_DIR%" && python -m uvicorn main:app --host 127.0.0.1 --port 8000"

timeout /t 2 /nobreak > nul

echo  [3/3] Starting WhatsApp Bridge for fresh QR code...
echo.
echo  -------------------------------------------------------------
echo   IMPORTANT: On your phone, go to WhatsApp -^> Linked Devices
echo   and LOG OUT of any existing linked device first!
echo  -------------------------------------------------------------
echo.
cd /d "%BRIDGE_DIR%" && npm run dev
pause
