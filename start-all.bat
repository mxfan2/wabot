@echo off
setlocal
cd /d "%~dp0"

echo Abriendo bot y ngrok...

start "WhatsApp Bot" cmd /k "cd /d %~dp0 && node server.js"
start "ngrok" cmd /k "cd /d %~dp0 && ngrok http 3001"

echo.
echo Se abrieron dos ventanas: una para el bot y otra para ngrok.
pause
