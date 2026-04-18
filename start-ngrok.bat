@echo off
setlocal
cd /d "%~dp0"

echo Iniciando ngrok hacia http://127.0.0.1:3001 ...
echo.

ngrok version >nul 2>&1
if errorlevel 1 (
  echo ngrok no esta instalado o no esta en PATH.
  pause
  exit /b 1
)

ngrok http 3001

echo.
echo ngrok se detuvo.
pause
