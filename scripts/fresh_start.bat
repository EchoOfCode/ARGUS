@echo off
setlocal
echo.
echo  =============================================================
echo   ARGUS — Complete Fresh Start (Clean Reset)
echo  =============================================================
echo.

set "REPO_ROOT=%~dp0.."
set "BRAIN_DIR=%REPO_ROOT%\apps\brain"
set "BRIDGE_DIR=%REPO_ROOT%\apps\bridge"

echo  [1/4] Wiping old local databases and message logs...
if exist "%BRIDGE_DIR%\argus.db" del /f /q "%BRIDGE_DIR%\argus.db" > nul 2>&1
if exist "%BRIDGE_DIR%\argus.db-wal" del /f /q "%BRIDGE_DIR%\argus.db-wal" > nul 2>&1
if exist "%BRIDGE_DIR%\argus.db-shm" del /f /q "%BRIDGE_DIR%\argus.db-shm" > nul 2>&1
if exist "%BRAIN_DIR%\argus_memory.db" del /f /q "%BRAIN_DIR%\argus_memory.db" > nul 2>&1

echo  [2/4] Clearing old WhatsApp session keys...
if exist "%BRIDGE_DIR%\auth_info" del /f /q /s "%BRIDGE_DIR%\auth_info\*" > nul 2>&1

echo.
echo  -------------------------------------------------------------
echo   IMPORTANT: On your phone, go to WhatsApp -^> Linked Devices
echo   and LOG OUT of any existing linked device first!
echo  -------------------------------------------------------------
echo.

echo  [3/4] Starting AI Brain (Python Backend)...
start "ARGUS Brain" cmd /k "cd /d "%BRAIN_DIR%" && python -m uvicorn main:app --host 127.0.0.1 --port 8000"

timeout /t 3 /nobreak > nul

echo  [4/4] Starting WhatsApp Bridge (QR Code will appear below)...
echo.
cd /d "%BRIDGE_DIR%" && npm run dev
pause
