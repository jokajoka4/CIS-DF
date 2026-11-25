@echo off
rem Double-click this file to start the CIS-DF exam simulator.
rem It opens your browser automatically. Close this window to stop the app.
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Download the LTS version from https://nodejs.org, install it, then double-click this file again.
  pause
  exit /b 1
)
set OPEN_BROWSER=1
call npm start
echo.
echo The app has stopped.
pause
