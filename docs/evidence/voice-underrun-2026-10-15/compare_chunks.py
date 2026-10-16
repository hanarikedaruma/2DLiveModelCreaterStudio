"""Measure fixed/alternating chunk schedules with identical Tiny voice parameters."""
import copy
import json
from math import gcd
from pathlib import Path
import sys
import time
import numpy as np
import soundfile as sf
from scipy.signal import resample_poly

root=Path.cwd(); sys.path.insert(0,str(root/'tools/voice-engine'))
from backend import create_model,read_profile
from worker import Composer
from execution_lock import ExecutionLock
out=root/'.cache/voice-underrun'
base=read_profile(root/'.cache/voice-parity/fast/original-profile.json')
source,rate=sf.read(root.parent/'liverVoiceChanger/build/jvs001-sample.wav',dtype='float32',always_2d=True)
source=source.mean(axis=1); factor=gcd(rate,48000)
source=resample_poly(source,48000//factor,rate//factor).astype(np.float32)
source=source[:48000*6]
policies=[('fixed180',[180]),('alternating120_240',[120,240]),('fixed240',[240]),('alternating180_300',[180,300]),('fixed300',[300]),('fixed180_repeat',[180])]
results=[]
with ExecutionLock(r'Local\VoiceChanger-HQ-GPU-v1'):
    model=create_model(base)
    # Every shape is warmed, outside the measured voice timeline.
    for milliseconds in (120,180,240,300):
        size=round(48000*base['historySeconds'])+milliseconds*48+6144
        for _ in range(2):model.convert(np.zeros(size,np.float32))
    for name,pattern in policies:
        model.profile=copy.deepcopy(base);model.profile['hopSeconds']=pattern[0]/1000
        c=Composer(model);index=0;finish=0.;records=[]
        while c.cursor<len(source):
            c.hop=pattern[index%len(pattern)]*48
            begin=0 if c.cursor==0 else c.cursor+c.future
            count=c.hop+c.future if c.cursor==0 else c.hop
            block=np.zeros(count,np.float32);available=source[begin:begin+count];block[:len(available)]=available
            _,metrics=c.push(block)
            capture_ready=(c.cursor+c.future)/48
            finish=max(finish,capture_ready)+metrics['processingMs']
            records.append(dict(hopMs=c.hop/48,processingMs=metrics['processingMs'],
                                requiredSourceLagMs=finish-(c.cursor-c.hop)/48))
            index+=1
        result=dict(name=name,patternMs=pattern,steps=base['steps'],historySeconds=base['historySeconds'],generationHistorySeconds=base['generationHistorySeconds'],
                    calls=len(records),sourceMs=c.cursor/48,totalProcessingMs=sum(x['processingMs'] for x in records),
                    averageComputeRatio=sum(x['processingMs'] for x in records)/(c.cursor/48),
                    processingP50Ms=float(np.percentile([x['processingMs'] for x in records],50)),
                    processingP95Ms=float(np.percentile([x['processingMs'] for x in records],95)),
                    requiredSourceLagMs=max(x['requiredSourceLagMs'] for x in records),records=records)
        results.append(result);(out/'chunk-comparison.json').write_text(json.dumps(results,indent=2),encoding='utf-8')
        print(json.dumps({k:v for k,v in result.items() if k!='records'}),flush=True)
