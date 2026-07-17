@echo off
REM Pull the latest code, sync dependencies, and relaunch (Windows).
setlocal

echo ===============================================
echo   Refreshing Minecraft Bot Manager
echo ===============================================
echo.

REM --- Detect current branch ---
for /f "delims=" %%b in ('git rev-parse --abbrev-ref HEAD') do set BRANCH=%%b

echo [1/3] Pulling latest code (branch: %BRANCH%)...
git pull origin %BRANCH%
echo.

echo [2/3] Syncing dependencies...
call npm install
echo.

echo [3/3] Launching...
echo.
node server.js
pause
