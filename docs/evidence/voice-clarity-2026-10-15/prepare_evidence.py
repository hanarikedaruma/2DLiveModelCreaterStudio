"""Synthetic/public test data; no microphone capture or audible playback."""
import json, sys
from pathlib import Path
from math import gcd
import numpy as np
import soundfile as sf
from scipy.signal import resample_poly
import librosa
root = Path.cwd()
sys.path.insert(0, str(root/'tools/voice-engine'))
from audio_processing import PeakGuard
output = root/'.cache/voice-clarity'
source, rate = sf.read(root.parent/'liverVoiceChanger/build/jvs001-sample.wav', dtype='float32', always_2d=True)
factor = gcd(rate, 48000)
source = resample_poly(source.mean(axis=1), 48000//factor, rate//factor).astype(np.float32)
first = max(0, int(np.flatnonzero(np.abs(source) > .03)[0])-24000)
slow = librosa.effects.time_stretch(source[first:first+48000*6], rate=.65)*10**(-18/20)
sf.write(output/'slow-quiet.wav', np.concatenate([slow, np.zeros(48000, np.float32)]), 48000, subtype='FLOAT')
signal = (2*np.sin(2*np.pi*180*np.arange(48000)/48000)).astype(np.float32)
guard = PeakGuard()
limited = guard.process(signal)
clipped = np.clip(signal, -guard.ceiling, guard.ceiling)
flat = lambda wave: int(np.count_nonzero(np.abs(wave) >= guard.ceiling-1e-6))
tail = slice(4800, None)
gain = float(np.dot(limited[tail].astype(np.float64), signal[tail])/np.dot(signal[tail].astype(np.float64), signal[tail]))
residual = float(np.linalg.norm(limited[tail]-signal[tail]*gain)/np.linalg.norm(limited[tail]))
report = dict(source='Synthetic 180Hz sine, amplitude 2, 1 second at 48kHz', oldHardClipFlatSamples=flat(clipped), newGuardFlatSamples=flat(limited), steadyShapeRelativeResidual=residual, outputPeak=float(np.max(np.abs(limited))), attenuationDb=guard.reduction_db, extraBufferedSamples=0, actualVoiceListeningNotMeasured=True)
(output/'peak-analysis.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
print(json.dumps(report))
