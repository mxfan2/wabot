@echo off
setlocal
cd /d "%~dp0"

echo Iniciando WhatsApp Loan Bot...
echo.

node --version >nul 2>&1
if errorlevel 1 (
  echo Node.js no esta instalado o no esta en PATH.
  pause
  exit /b 1
)

node server.js

echo.
echo El bot se detuvo.
pause
