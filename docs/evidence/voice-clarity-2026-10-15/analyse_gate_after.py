"""Public speech only: isolate denoising/gating under slow and quiet speech."""
import json,sys,time
from pathlib import Path
from math import gcd
import numpy as np
import soundfile as sf
from scipy.signal import resample_poly
import librosa
root=Path.cwd();sys.path.insert(0,str(root/'tools/voice-engine'))
from audio_processing import InputCleaner,default_processing
source,rate=sf.read(root.parent/'liverVoiceChanger/build/jvs001-sample.wav',dtype='float32',always_2d=True)
g=gcd(rate,48000);source=resample_poly(source.mean(axis=1),48000//g,rate//g).astype(np.float32)
first=max(0,int(np.flatnonzero(np.abs(source)>.03)[0])-24000);source=source[first:first+48000*6]
waves={'normal':source,'slow':librosa.effects.time_stretch(source,rate=.65)}
records=[]
for name,voice in waves.items():
    for input_db in (0,-18):
        raw=np.concatenate([np.zeros(48000,np.float32),voice*10**(input_db/20),np.zeros(48000,np.float32)])
        for mode in ('current',):
            config=dict(default_processing(),latencyMode='lowLatency')
            if mode=='lessDenoise':config['noiseReduction']=.4
            cleaner=InputCleaner(config);probabilities=[];frame=cleaner.detector.frame
            def detected(x):
                if mode=='vadOnlyBoost':
                    rms=float(np.sqrt(np.mean(x*x)));x=x*min(4.,max(1.,.03/max(rms,1e-7)))
                p=frame(x);probabilities.append(p);return p
            cleaner.detector.frame=detected
            for pos in range(0,len(raw),11520):cleaner.push(raw[pos:pos+11520])
            mask=cleaner.mask(0,len(raw));clean=cleaner.slice(0,len(raw))
            energy=float(np.sum(raw.astype(np.float64)**2));retained=float(np.sum((raw*mask).astype(np.float64)**2))/energy
            row=dict(source=name,inputDb=input_db,mode=mode,sourceEnergyRetainedByGate=retained,
                     denoisedRmsRatio=float(np.sqrt(np.sum(clean.astype(np.float64)**2)/energy)),
                     speechMaskSeconds=float(np.sum(mask>0)/48000),probabilityP50=float(np.percentile(probabilities,50)),
                     probabilityP95=float(np.percentile(probabilities,95)))
            records.append(row);print(json.dumps(row),flush=True)
(root/'.cache/voice-clarity/gate-analysis-after.json').write_text(json.dumps(records,indent=2),encoding='utf-8')
