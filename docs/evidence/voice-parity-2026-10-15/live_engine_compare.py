"""Short sequential muted original/installed WASAPI comparison; no PCM is saved."""
import json
import os
from pathlib import Path
import subprocess
import sys
import time

root = Path.cwd()
quality = os.environ.get('VOICE_COMPARE_QUALITY', 'fast')
if len(sys.argv) == 1:
    directory = root / f'.cache/voice-parity/live-engine-{quality}'
    directory.mkdir(exist_ok=True)
    engines = {
        'original': root.parent / 'liverVoiceChanger/quality_voice',
        'installed': Path(os.environ['LOCALAPPDATA']) / 'Programs/2D Live Model Creator Studio/voice-engine',
    }
    for name, path in engines.items():
        child = subprocess.run([sys.executable, str(Path(__file__).resolve()), name, str(path)],
                               capture_output=True, text=True, encoding='utf-8',
                               creationflags=subprocess.CREATE_NO_WINDOW)
        print(child.stdout, flush=True)
        print(child.stderr, file=sys.stderr, flush=True)
        child.check_returncode()
    raise SystemExit()

name, path = sys.argv[1:]
sys.path.insert(0, path)
from live import LiveEngine, devices
inputs, outputs, _ = devices()
input_device = next(i for i, d in inputs if 'Razer Seiren' in d['name'])
output_device = next(i for i, d in outputs if 'Sound Blaster' in d['name'])
directory = root / f'.cache/voice-parity/live-engine-{quality}'
engine = LiveEngine()
engine.mute = True
started = time.perf_counter()
engine.start(root / f'.cache/voice-parity/{quality}/original-profile.json', input_device, output_device, directory / f'{name}.model.log')
running = None
try:
    while True:
        now = time.perf_counter()
        if engine.state == 'error' or engine.error:
            break
        if engine.primed and running is None:
            running = now
        if running is None and now - started > 120:
            raise TimeoutError('Model readiness')
        if running and now - running >= 10:
            break
        time.sleep(.01)
    result = dict(engine=name, quality=quality, muted=True, requestedSeconds=10, seconds=time.perf_counter() - (running or started),
                  state=engine.state, error=engine.error, metrics=dict(engine.stats))
    (directory / f'{name}.json').write_text(json.dumps(result, indent=2), encoding='utf-8')
    print(json.dumps(result), flush=True)
finally:
    engine.stop()
    if not engine.wait(20):
        raise RuntimeError('Owned audio engine did not stop')
