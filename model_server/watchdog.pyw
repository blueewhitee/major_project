import subprocess
import time
import os
import sys

# Move to the script's directory
os.chdir(os.path.dirname(os.path.abspath(__file__)))

PYTHON = r"C:\Users\tosh9\AppData\Local\Programs\Python\Python313\python.exe"
CREATE_NO_WINDOW = 0x08000000

def start_process(script, log_file):
    out_f = open(log_file, "a", encoding="utf-8")
    proc = subprocess.Popen(
        [PYTHON, script],
        stdout=out_f,
        stderr=subprocess.STDOUT,
        creationflags=CREATE_NO_WINDOW
    )
    return proc, out_f

server_proc, log_s = start_process("api_server.py", "server.log")
watcher_proc, log_w = start_process("aw_watcher.py", "aw_watcher.log")

try:
    while True:
        if server_proc.poll() is not None:
            log_s.close()
            time.sleep(5)
            server_proc, log_s = start_process("api_server.py", "server.log")
            
        if watcher_proc.poll() is not None:
            log_w.close()
            time.sleep(5)
            watcher_proc, log_w = start_process("aw_watcher.py", "aw_watcher.log")
            
        time.sleep(2)
        
except KeyboardInterrupt:
    server_proc.kill()
    watcher_proc.kill()
    log_s.close()
    log_w.close()
