@echo off
set PYTHONIOENCODING=utf-8
if "%~1"=="hidden" goto loop
start /b wscript.exe //nologo "%~dp0hide_runner.vbs" "%~f0"
exit /b

:loop
"C:\Users\tosh9\AppData\Local\Programs\Python\Python313\python.exe" "E:\major\poc3\model_server\api_server.py" >> "E:\major\poc3\model_server\server.log" 2>&1
ping 127.0.0.1 -n 6 > nul
goto loop
