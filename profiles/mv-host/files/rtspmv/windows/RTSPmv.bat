@echo off
rem Runs RTSPmv from source (needs Python 3 from python.org or the Microsoft Store).
rem Put go2rtc.exe in the bin folder next to rtspmv.py.
cd /d "%~dp0.."
python rtspmv.py --open %*
pause
