@echo off
schtasks /create /tn "FocusTrackerServer" /tr "E:\major\poc3\model_server\run_server.bat" /sc onlogon /rl highest /f

if %errorlevel% == 0 (
    echo.
    echo FocusTrackerServer task registered successfully.
    echo The server will start automatically at every login.
    echo.
    echo To stop or disable it: open Task Scheduler (Win+R, type taskschd.msc)
    echo and find "FocusTrackerServer" in the task list.
) else (
    echo.
    echo ERROR: Failed to register the task. Try running this script as Administrator.
)
pause
