@echo off
echo Registering FocusTracker autostart tasks...
echo.

REM Delete old tasks if they exist
schtasks /delete /tn "FocusTrackerServer" /f >nul 2>&1
schtasks /delete /tn "FocusTrackerWatcher" /f >nul 2>&1

REM /it = only run when user is logged on (interactive), avoids silent no-op on battery, and allows access to the current window
schtasks /create /tn "FocusTrackerSilent" /tr "wscript.exe E:\major\poc3\model_server\start_server.vbs" /sc onlogon /rl highest /f /it

REM Disable "stop on battery" via PowerShell
powershell -Command "$s = New-Object -ComObject Schedule.Service; $s.Connect(); $t = $s.GetFolder('\').GetTask('FocusTrackerSilent'); $d = $t.Definition; $d.Settings.StopIfGoingOnBatteries = $false; $d.Settings.DisallowStartIfOnBatteries = $false; $t.RegisterTaskDefinition('FocusTrackerSilent', $d, 4, $null, $null, 3)"

echo.
echo Task registered:
echo   FocusTrackerSilent -^> start_server.vbs (runs both server and watcher silently)
echo.
echo To manage: Win+R -^> taskschd.msc
pause
