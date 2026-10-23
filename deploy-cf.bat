@echo off
cd /d "%~dp0"
node deploy.mjs %*
pause
