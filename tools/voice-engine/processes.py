"""Terminate only descendants of the subprocess launched by this application."""
import psutil

def stop_owned_process(process):
    children=[]
    if process.poll() is None:
        try:
            owner=psutil.Process(process.pid)
            children=owner.children(recursive=True)
            # Windows venv python.exe is a launcher with a real Python child.
            # Killing just the launcher leaves GPU work and inherited pipes alive.
            for child in reversed(children):
                try:child.kill()
                except psutil.NoSuchProcess:pass
        except psutil.NoSuchProcess:pass
        try:process.kill()
        except ProcessLookupError:pass
    return children
