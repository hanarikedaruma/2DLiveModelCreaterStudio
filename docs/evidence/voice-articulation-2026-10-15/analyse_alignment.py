"""Measure installed RNNoise delay with public speech; no device access."""
import json, sys
from pathlib import Path
import numpy as np
import soundfile as sf
from scipy.signal import resample_poly
from math import gcd
root=Path.cwd();sys.path.insert(0,str(root/'tools/voice-engine'))
from audio_processing import RNNoise, default_processing
source,rate=sf.read(root.parent/'liverVoiceChanger/build/jvs001-sample.wav',dtype='float32',always_2d=True)
factor=gcd(rate,48000);source=resample_poly(source.mean(axis=1),48000//factor,rate//factor).astype(np.float32)
source=np.concatenate([np.zeros(48000,np.float32),source,np.zeros(48000,np.float32)])
source=np.pad(source,(0,(-len(source))%480))
rn=RNNoise(default_processing()['noiseLibrary'])
clean=np.concatenate([rn.frame(source[i:i+480]) for i in range(0,len(source),480)])
offset=48000;count=min(48000*8,len(source)-offset-1920)
scores=[]
for lag in range(0,1441):
    a=source[offset:offset+count].astype(np.float64);b=clean[offset+lag:offset+lag+count].astype(np.float64)
    scores.append(float(np.dot(a,b)/np.sqrt(np.dot(a,a)*np.dot(b,b))))
best=int(np.argmax(scores))
records=[]
for lag in (480,960):
    raw=source[:len(source)-lag];wet=clean[lag:]
    mixed=(wet*.85+raw*.15).astype(np.float32)
    # The legacy mixed output combines two different source times. These
    # correlations are delay diagnostics, not intelligibility scores.
    records.append(dict(alignmentSamples=lag,correlation=scores[lag],mixRms=float(np.sqrt(np.mean(mixed.astype(np.float64)**2)))))
result=dict(source='Public JVS sample',bestDelaySamples=best,bestDelayMs=best/48,bestCorrelation=scores[best],comparisons=records)
output=root/'.cache/voice-articulation';output.mkdir(exist_ok=True)
(output/'alignment-before.json').write_text(json.dumps(result,indent=2),encoding='utf-8')
print(json.dumps(result),flush=True)
