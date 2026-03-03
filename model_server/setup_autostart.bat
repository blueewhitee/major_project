@echo off
echo Registering FocusTracker autostart tasks...
echo.

REM /it = only run when user is logged on (interactive), avoids silent no-op on battery
schtasks /create /tn "FocusTrackerServer" /tr "E:\major\poc3\model_server\run_server.bat" /sc onlogon /rl highest /f /it
schtasks /create /tn "FocusTrackerWatcher" /tr "E:\major\poc3\model_server\run_aw_watcher.bat" /sc onlogon /rl highest /f /it

REM Disable "stop on battery" for both tasks via PowerShell
powershell -Command "$s = New-Object -ComObject Schedule.Service; $s.Connect(); $t = $s.GetFolder('\').GetTask('FocusTrackerServer'); $d = $t.Definition; $d.Settings.StopIfGoingOnBatteries = $false; $d.Settings.DisallowStartIfOnBatteries = $false; $t.RegisterTaskDefinition('FocusTrackerServer', $d, 4, $null, $null, 3)"
powershell -Command "$s = New-Object -ComObject Schedule.Service; $s.Connect(); $t = $s.GetFolder('\').GetTask('FocusTrackerWatcher'); $d = $t.Definition; $d.Settings.StopIfGoingOnBatteries = $false; $d.Settings.DisallowStartIfOnBatteries = $false; $t.RegisterTaskDefinition('FocusTrackerWatcher', $d, 4, $null, $null, 3)"

echo.
echo Both tasks registered:
echo   FocusTrackerServer  -^> api_server.py  (logon, any power source)
echo   FocusTrackerWatcher -^> aw_watcher.py  (logon, any power source)
echo.
echo To manage: Win+R -^> taskschd.msc
pause
