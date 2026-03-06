Dim WShell
Set WShell = CreateObject("WScript.Shell")

' Runs the api_server silently in background, logs to server.log
WShell.Run "cmd /c """"E:\major\poc3\model_server\run_server.bat"""" hidden", 0, False
WShell.Run "cmd /c """"E:\major\poc3\model_server\run_aw_watcher.bat"""" hidden", 0, False
