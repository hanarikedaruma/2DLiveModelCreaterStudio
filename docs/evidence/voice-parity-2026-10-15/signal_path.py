"""Hold each generated model window fixed to compare the complete PCM path."""
from pathlib import Path
import importlib.util
import sys, json
from math import gcd
import numpy as np
import soundfile as sf
from scipy.signal import resample_poly

root=Path.cwd(); engine=root/'tools/voice-engine'; original=root.parent/'liverVoiceChanger/quality_voice'
sys.path.insert(0,str(engine))
from host import Host
from worker import Composer
from backend import read_profile
from execution_lock import ExecutionLock

def load(name,path):
    spec=importlib.util.spec_from_file_location(name,path); module=importlib.util.module_from_spec(spec); spec.loader.exec_module(module); return module

old_backend=load('comparison_backend',original/'backend.py')
saved=sys.modules['backend'];sys.modules['backend']=old_backend
try:old_worker=load('comparison_worker',original/'worker.py')
finally:sys.modules['backend']=saved

source,rate=sf.read(root.parent/'liverVoiceChanger/build/jvs001-sample.wav',dtype='float32',always_2d=True)
source=source.mean(axis=1)[:rate*6];g=gcd(rate,48000);source=resample_poly(source,48000//g,rate//g).astype(np.float32)
directory=root/'.cache/voice-parity/signal-path';directory.mkdir(exist_ok=True)
host=Host.__new__(Host);host.data=directory;host.model_root=root.parent/'liverVoiceChanger'
results=[]
with ExecutionLock(r'Local\VoiceChanger-HQ-GPU-v1'):
  for quality in ('fast','balanced','stable'):
    baseline=read_profile(root/f'.cache/voice-parity/{quality}/original-profile.json')
    profile=dict(name=baseline['name'],backend=baseline['backend'],quality=quality,reference='builtin',outputGainDb=baseline['outputGainDb'],voiceTone=baseline['voiceTone'],inputCleanup=baseline['inputCleanup'],outputFilters=baseline['outputFilters'])
    actual=read_profile(host.normalize(profile))
    model=old_backend.create_model(baseline)
    recorded=[]
    class Recording:
      profile=baseline
      def convert(self,x):
        y,m=model.convert(x);recorded.append((x.copy(),y.copy(),dict(m)));return y,m
    first=old_worker.Composer(Recording())
    model.convert(np.zeros(first.left+first.hop+first.future,np.float32))
    padded=np.pad(source,(0,first.hop+first.future))
    inputs=[];old=[]
    for pos in range(0,len(source),first.hop):
      start=0 if pos==0 else pos+first.future;count=first.hop+first.future if pos==0 else first.hop
      block=padded[start:start+count];inputs.append(block);y,_=first.push(block);old.append(y)
    checks=[]
    class Replay:
      profile=actual
      def convert(self,x):
        reference,y,m=recorded[len(checks)];checks.append(bool(np.array_equal(reference,x)));return y.copy(),dict(m)
    second=Composer(Replay());new=[]
    for block in inputs:y,_=second.push(block);new.append(y)
    left=np.concatenate(old)[:len(source)];right=np.concatenate(new)[:len(source)]
    entry=dict(quality=quality,modelOutputReusedForComparison=True,inputWindowsIdentical=all(checks),pcmBitIdentical=bool(np.array_equal(left,right)),differencePeak=float(np.max(np.abs(left-right))),samples=len(left))
    results.append(entry);print(json.dumps(entry),flush=True)
    (directory/'result.json').write_text(json.dumps(results,indent=2))
    del model,first,second
    import gc,torch
    gc.collect();torch.cuda.empty_cache()
assert all(x['inputWindowsIdentical'] and x['pcmBitIdentical'] for x in results)
