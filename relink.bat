@echo off
echo.
echo  =======================================
echo   ARGUS - Fresh WhatsApp Pairing
echo  =======================================
echo.
echo  [1/3] Clearing old encryption session keys...
if exist e:\ARGUS\bridge\auth_info (
    del /q /s e:\ARGUS\bridge\auth_info\* > nul 2>&1
)

echo  [2/3] Starting AI Brain (Python Backend)...
start "ARGUS Brain" cmd /k "cd /d e:\ARGUS\backend && py -3.10 -m uvicorn main:app --host 127.0.0.1 --port 8000"

timeout /t 2 /nobreak > nul

echo  [3/3] Starting WhatsApp Bridge for fresh QR code...
echo.
echo  -------------------------------------------------------------
echo   IMPORTANT: On your phone, go to WhatsApp -^> Linked Devices
echo   and LOG OUT of any existing linked device first!
echo  -------------------------------------------------------------
echo.
cd /d e:\ARGUS\bridge && npm run dev
pause
