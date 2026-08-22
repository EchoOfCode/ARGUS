@echo off
echo.
echo  =============================================================
echo   ARGUS v2 — Complete Fresh Start (Clean Reset)
echo  =============================================================
echo.
echo  [1/4] Wiping old local databases & message logs...
if exist e:\ARGUS\bridge\argus.db del /f /q e:\ARGUS\bridge\argus.db > nul 2>&1
if exist e:\ARGUS\bridge\argus.db-wal del /f /q e:\ARGUS\bridge\argus.db-wal > nul 2>&1
if exist e:\ARGUS\bridge\argus.db-shm del /f /q e:\ARGUS\bridge\argus.db-shm > nul 2>&1
if exist e:\ARGUS\backend\argus_memory.db del /f /q e:\ARGUS\backend\argus_memory.db > nul 2>&1

echo  [2/4] Clearing old WhatsApp session keys...
if exist e:\ARGUS\bridge\auth_info del /f /q /s e:\ARGUS\bridge\auth_info\* > nul 2>&1

echo.
echo  -------------------------------------------------------------
echo   IMPORTANT: On your phone, go to WhatsApp -^> Linked Devices
echo   and LOG OUT of any existing linked device first!
echo  -------------------------------------------------------------
echo.

echo  [3/4] Starting AI Brain (Python Backend)...
start "ARGUS Brain" cmd /k "cd /d e:\ARGUS\backend && py -3.10 -m uvicorn main:app --host 127.0.0.1 --port 8000"

timeout /t 3 /nobreak > nul

echo  [4/4] Starting WhatsApp Bridge (QR Code will appear below)...
echo.
cd /d e:\ARGUS\bridge && npm run dev
pause
