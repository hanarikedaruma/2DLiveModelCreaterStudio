from pathlib import Path
import sys, json
import numpy as np
import soundfile as sf
from scipy.signal import resample_poly
from math import gcd
root = Path.cwd()
sys.path.insert(0, str(root / 'tools/voice-engine'))
from validate_parity import render
model_root = root.parent / 'liverVoiceChanger'
source, rate = sf.read(model_root / 'build/jvs001-sample.wav', dtype='float32', always_2d=True)
source = source.mean(axis=1)[:rate * 6]
g = gcd(rate, 48000)
source = resample_poly(source, 48000//g, rate//g).astype(np.float32)
directory = root / '.cache/voice-parity/original-repeat'
directory.mkdir(exist_ok=True)
before, _ = sf.read(root / '.cache/voice-parity/fast/quality_voice.wav', dtype='float32')
after, ready, _ = render(model_root / 'quality_voice/worker.py', root / '.cache/voice-parity/fast/original-profile.json', source, directory)
delta = after.astype(np.float64) - before
value = dict(originalAgainstOriginal=True, bitIdentical=bool(np.array_equal(before, after)), differenceRms=float(np.sqrt(np.mean(delta**2))), differencePeak=float(np.max(np.abs(delta))), ready=ready)
(directory / 'result.json').write_text(json.dumps(value, indent=2))
print(json.dumps(value))
