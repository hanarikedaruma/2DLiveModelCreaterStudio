"""Explicit synthetic/public-input, muted WASAPI validation; no microphone recording."""
import argparse
import copy
import json
from pathlib import Path
import queue
import time
import numpy as np
import soundfile as sf
from scipy.signal import resample_poly
from math import gcd
from host import Host
from live import LiveEngine,devices
from filter_chain import default_chain,new_filter

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--model-root',required=True);parser.add_argument('--source',required=True);parser.add_argument('--seconds',type=int,default=75);parser.add_argument('--report',required=True)
    parser.add_argument('--quality',choices=('fast','balanced','stable'),default='fast')
    parser.add_argument('--input-gain-db',type=float,default=0.)
    parser.add_argument('--body-db',type=float,default=0.)
    parser.add_argument('--softness-db',type=float,default=0.)
    args=parser.parse_args()
    if not 1<=args.seconds<=3600:raise ValueError('seconds must be 1..3600')
    if not -24<=args.input_gain_db<=24 or not -3<=args.body_db<=3 or not 0<=args.softness_db<=6:raise ValueError('Validation controls out of range')
    report=Path(args.report).resolve();report.parent.mkdir(parents=True,exist_ok=True)
    host=Host.__new__(Host);host.data=report.parent/'live';host.data.mkdir(exist_ok=True);host.model_root=Path(args.model_root).resolve()
    tone=dict(bodyDb=args.body_db,softnessDb=args.softness_db)
    profile=dict(name='Muted validation',backend='seed-xlsr-tiny',quality=args.quality,reference='builtin',outputGainDb=-3,voiceTone=tone,inputCleanup=dict(noiseReduction=.85,speechOnly=True,speechSensitivity=40),outputFilters=default_chain())
    path=host.normalize(profile)
    source,rate=sf.read(args.source,dtype='float32',always_2d=True);source=source.mean(axis=1);g=gcd(rate,48000);source=resample_poly(source,48000//g,rate//g).astype(np.float32)
    # A speech/noise/silence cycle is fed on the REAL capture device clock.
    cycle=np.concatenate([np.zeros(48000*2,np.float32),source,np.random.default_rng(54).normal(0,.001,48000).astype(np.float32)])
    engine=LiveEngine();engine.mute=True;original=engine.input_callback;cursor=0
    engine.input_gain_db=args.input_gain_db
    def input_callback(indata,frames,times,status):
        nonlocal cursor
        samples=cycle[(cursor+np.arange(frames))%len(cycle)];cursor+=frames
        original(samples[:,None],frames,times,status)
    engine.input_callback=input_callback
    ins,outs,_=devices();input_device=next((i for i,d in ins if 'Razer Seiren' in d['name']),ins[0][0]);output_device=next((i for i,d in outs if 'Sound Blaster' in d['name']),outs[0][0])
    engine.start(path,input_device,output_device,report.with_suffix('.model.log'))
    started=time.perf_counter();running=None;records=[];last=0;changes=0;frames=0;clock_errors=[]
    try:
        while True:
            now=time.perf_counter()
            if engine.state=='error':raise RuntimeError(engine.error)
            if running is None and engine.state=='running':running=now
            if running is None and now-started>120:raise TimeoutError('Model preparation exceeded 120 seconds')
            while True:
                try:seq,sample,dac,pcm=engine.playback.get_nowait()
                except queue.Empty:break
                frames+=1
                if np.any(pcm):raise RuntimeError('Mute emitted nonzero output')
                clock_errors.append(max(0,now*1000-dac))
            if running and int((now-running)//10)>changes:
                changes=int((now-running)//10)
                chain=default_chain()
                if changes%4==1:chain['enabled']=False
                elif changes%4==2:chain['items']=[new_filter(t) for t in ('gain','equalizer','deesser','lowpass','resonance','gain','equalizer','lowpass')]
                elif changes%4==3:chain['items'].reverse()
                engine.filter_config=chain
                engine.voice_tone={'brightnessDb':float(changes%3),'bodyDb':args.body_db,'softnessDb':max(args.softness_db,float(changes%4))}
            if now-last>=30:
                elapsed=0 if running is None else now-running
                record=dict(elapsedSeconds=elapsed,state=engine.state,**engine.stats)
                records.append(record);print(json.dumps({k:record.get(k) for k in ('elapsedSeconds','state','underruns','overflows','estimatedMs','vramMiB')}) ,flush=True);last=now
                report.write_text(json.dumps(dict(passed=False,inProgress=True,records=records),indent=2),encoding='utf-8')
            if running and now-running>=args.seconds:break
            time.sleep(.01)
        for key in ('underruns','overflows','inputStatus','outputStatus'):
            if engine.stats[key]:raise RuntimeError(key+' was nonzero')
        result=dict(passed=True,quality=args.quality,inputGainDb=args.input_gain_db,voiceTone=tone,seconds=time.perf_counter()-running,frames=frames,changes=changes,metrics=dict(engine.stats),ipcNotMeasured=True,callbackReceiptP95Ms=float(np.percentile(clock_errors,95)),records=records)
        report.write_text(json.dumps(result,indent=2),encoding='utf-8');print(json.dumps({k:result[k] for k in ('passed','seconds','frames','changes')}),flush=True)
    except Exception as error:
        report.write_text(json.dumps(dict(passed=False,error=str(error),metrics=dict(engine.stats),records=records),indent=2),encoding='utf-8');raise
    finally:
        engine.stop()
        if not engine.wait(20):raise RuntimeError('Audio thread did not stop')

if __name__=='__main__':main()
