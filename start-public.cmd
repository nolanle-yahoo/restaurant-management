@echo off
REM One-click launcher: publishes the Restaurant app to a public URL.
REM Double-click this file. Closing the window stops the server and tunnel.
title Restaurant - Public Share
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-public.ps1"
echo.
echo Stopped. Press any key to close.
pause >nul
