@echo off
setlocal
title HOLLOW GROVE - AI DEFENSE
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  Node.js was not found.
  echo  Install Node.js from https://nodejs.org and run START.bat again.
  echo.
  pause
  exit /b 1
)

echo.
echo  ==========================================
echo    HOLLOW GROVE - AI DEFENSE
echo    Starting local server...
echo  ==========================================
echo.

node server.mjs
pause
