@echo off
rem Starts RTSPmv if needed and opens the multiviewer fullscreen (Edge/Chrome kiosk).
cd /d "%~dp0.."
start "" /min python rtspmv.py
timeout /t 3 /nobreak >nul
python rtspmv.py --kiosk
