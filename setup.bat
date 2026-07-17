@echo off
REM ============================================================
REM  setup.bat - Windows setup for the Minecraft Bot Manager
REM  Run by double-clicking, or: setup.bat  in a cmd window.
REM ============================================================
setlocal

echo ===============================================
echo   Minecraft Bot Manager - Windows Setup
echo ===============================================
echo.

REM --- Check for Node.js ---
where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js was not found.
  echo.
  echo Please install the LTS version from:
  echo     https://nodejs.org/en/download
  echo.
  echo Then re-run this script.
  echo.
  pause
  exit /b 1
)

for /f "delims=" %%v in ('node --version') do set NODEV=%%v
echo [1/3] Found Node.js %NODEV%
echo.

REM --- Initialize project if needed ---
echo [2/3] Preparing project...
if not exist package.json (
  call npm init -y >nul
)

REM --- Install dependencies ---
echo [3/3] Installing dependencies (mineflayer@4.37.1, ws)...
call npm install mineflayer@4.37.1 ws
if errorlevel 1 (
  echo.
  echo [ERROR] npm install failed. Check your internet connection and try again.
  pause
  exit /b 1
)

echo.
echo ===============================================
echo   Setup complete!
echo.
echo   Launch the dashboard with:   run.bat
echo   Then open in your browser:   http://localhost:3000
echo ===============================================
echo.
pause
