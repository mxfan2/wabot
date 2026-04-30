@echo off
setlocal
cd /d "%~dp0"

set "LOCAL_AI_MODEL=qwen3.5:latest"
for /f "usebackq tokens=1,* delims==" %%A in (".env") do (
  if /I "%%A"=="LOCAL_AI_MODEL" set "LOCAL_AI_MODEL=%%B"
)

echo Abriendo AI local, bot y ngrok...
echo Modelo local: %LOCAL_AI_MODEL%
echo.

where ollama >nul 2>&1
if errorlevel 1 (
  echo Ollama no esta instalado o no esta en PATH. El bot abrira, pero la AI local no va a responder.
) else (
  powershell -NoProfile -ExecutionPolicy Bypass -Command "if (Get-NetTCPConnection -LocalPort 11434 -State Listen -ErrorAction SilentlyContinue) { exit 0 } else { exit 1 }"
  if errorlevel 1 (
    start "Local AI - Ollama" cmd /k "cd /d %~dp0 && ollama serve"
  ) else (
    echo Ollama ya esta corriendo en 127.0.0.1:11434.
  )
  echo Calentando modelo local %LOCAL_AI_MODEL%...
  powershell -NoProfile -ExecutionPolicy Bypass -Command "try { $body = @{ model = $env:LOCAL_AI_MODEL; prompt = 'Responde solo OK.'; stream = $false; keep_alive = '4h' } | ConvertTo-Json; Invoke-RestMethod -Uri 'http://127.0.0.1:11434/api/generate' -Method Post -ContentType 'application/json' -Body $body -TimeoutSec 120 | Out-Null; Write-Host 'AI local lista:' $env:LOCAL_AI_MODEL } catch { Write-Host 'No se pudo calentar la AI local:' $_.Exception.Message }"
)

echo.
echo Iniciando WhatsApp Bot y ngrok...

powershell -NoProfile -ExecutionPolicy Bypass -Command "if (Get-NetTCPConnection -LocalPort 3001 -State Listen -ErrorAction SilentlyContinue) { exit 0 } else { exit 1 }"
if errorlevel 1 (
  start "WhatsApp Bot" cmd /k "cd /d %~dp0 && node server.js"
) else (
  echo WhatsApp Bot ya esta corriendo en 0.0.0.0:3001.
)

powershell -NoProfile -ExecutionPolicy Bypass -Command "try { Invoke-RestMethod -Uri 'http://127.0.0.1:4040/api/tunnels' -TimeoutSec 2 | Out-Null; exit 0 } catch { exit 1 }"
if errorlevel 1 (
  start "ngrok" cmd /k "cd /d %~dp0 && ngrok http 3001"
) else (
  echo ngrok ya esta corriendo.
)

echo.
pause
