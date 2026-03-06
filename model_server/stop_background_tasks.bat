@echo off
echo Stopping FocusTracker background processes...
taskkill /f /im python.exe
echo Done.
pause
