@echo off
title Pushup Pro - Cloudflare Tunnel
cd /d "%~dp0"
echo Starting Pushup Pro with free Cloudflare tunnel...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0run-tunnel.ps1"
echo.
pause
