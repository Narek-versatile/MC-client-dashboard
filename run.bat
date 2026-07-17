@echo off
REM Launch the Minecraft Bot Manager headless service on Windows.
REM Open http://localhost:3000 in your browser once it starts.
setlocal

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js not found. Run setup.bat first ^(or install from https://nodejs.org^).
  pause
  exit /b 1
)

if not exist node_modules (
  echo [ERROR] Dependencies not installed. Run setup.bat first.
  pause
  exit /b 1
)

node server.js
pause
