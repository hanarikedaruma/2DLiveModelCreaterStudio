"""Public PCM alignment and frequency-response diagnostic, no device access."""
import json, sys
from pathlib import Path
import numpy as np
import soundfile as sf
from scipy.signal import resample_poly
from math import gcd
root=Path.cwd();sys.path.insert(0,str(root/'tools/voice-engine'))
from audio_processing import RNNoise, InputCleaner, ToneProcessor, default_processing
from filter_chain import FilterChain, default_chain
output=root/'.cache/voice-articulation';output.mkdir(exist_ok=True)
source,rate=sf.read(root.parent/'liverVoiceChanger/build/jvs001-sample.wav',dtype='float32',always_2d=True)
factor=gcd(rate,48000);source=resample_poly(source.mean(axis=1),48000//factor,rate//factor).astype(np.float32)
source=np.pad(source,(0,(-len(source))%480))
rn=RNNoise(default_processing()['noiseLibrary'])
wet=np.concatenate([rn.frame(source[i:i+480]) for i in range(0,len(source),480)])
records=[]
for strength in (.4,.5,.85,1.):
    cleaner=InputCleaner(dict(default_processing(),noiseReduction=strength,speechOnly=False))
    for begin in range(0,len(source),731):cleaner.push(source[begin:begin+731])
    actual=cleaner.slice(0,cleaner.end)
    expected=(strength*wet[960:]+(1-strength)*source[:-960]).astype(np.float32)
    records.append(dict(strength=strength,sourceFrames=len(source),outputFrames=cleaner.end,alignmentSamples=960,mixedMatchesCorrectlyAlignedReference=bool(np.array_equal(actual,expected)),differencePeak=float(np.max(np.abs(actual-expected)))))
tones=[]
for config in ({},{'bodyDb':3,'softnessDb':6}):
    for hz in (200,1000,3000,6000):
        x=(.1*np.sin(2*np.pi*hz*np.arange(48000)/48000)).astype(np.float32)
        tone=ToneProcessor(config).process(x);filtered=FilterChain(default_chain()).process(tone)
        rms=lambda a:float(np.sqrt(np.mean(a[4800:].astype(np.float64)**2)))
        tones.append(dict(tone=config,hz=hz,toneGainDb=float(20*np.log10(rms(tone)/rms(x))),toneAndStockFiltersGainDb=float(20*np.log10(rms(filtered)/rms(x)))))
result=dict(alignment=records,frequencyResponse=tones,notAPhonemeOrSubjectiveQualityTest=True)
(output/'processing-after.json').write_text(json.dumps(result,indent=2),encoding='utf-8')
print(json.dumps(result),flush=True)
