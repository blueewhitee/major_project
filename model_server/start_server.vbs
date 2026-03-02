Dim WShell
Set WShell = CreateObject("WScript.Shell")

' Runs the api_server silently in background, logs to server.log
WShell.Run "cmd /c ""C:\focus_tracker\model_server\run_server.bat""", 0, False
WShell.Run "cmd /c ""C:\focus_tracker\model_server\run_aw_watcher.bat""", 0, False
