"""Graceful stop followed by a bounded kill, without inspecting credentials."""
import os,re,signal,threading,time
from pathlib import Path
KILL_SIGNAL=getattr(signal,"SIGKILL",9)

def request_stop(runtime,force=False,log_path='/tmp/glide-launch.log',grace=20):
    runtime=Path(runtime);(runtime/'stop').touch()
    if force:(runtime/'force-stop').touch()
    log=Path(log_path)
    text=log.read_text(errors='replace') if log.exists() else ''
    values=re.findall(r'MINECRAFT_PID=(\d+)',text)
    if not values:return
    pid=int(values[-1])
    try:os.kill(pid,KILL_SIGNAL if force else signal.SIGTERM)
    except ProcessLookupError:return
    if force:return
    def escalate():
        time.sleep(grace)
        if (runtime/'finished').exists():return
        try:os.kill(pid,KILL_SIGNAL)
        except ProcessLookupError:pass
    threading.Thread(target=escalate,daemon=True).start()
