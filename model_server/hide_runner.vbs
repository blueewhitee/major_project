If WScript.Arguments.Count >= 1 Then
    Dim objShell
    Set objShell = WScript.CreateObject("WScript.Shell")
    objShell.Run "cmd.exe /c """ & WScript.Arguments(0) & """ hidden", 0, False
End If
