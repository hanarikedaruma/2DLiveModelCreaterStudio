"""Manual CUDA producer trace, identical-PCM old/new playback and delivery samples.

No microphone or sound output is opened. WAV files and a JSON report are saved.
"""
import argparse,json,queue,sys,threading,time
from collections import deque
from pathlib import Path
from types import SimpleNamespace
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import numpy as np
try:import sounddevice as sd
except ModuleNotFoundError:
    # The synthesis venv omits device I/O. Reuse the configured host module
    # for callback exception types; no stream is opened by this check.
    runtime=json.loads(Path(__file__).resolve().parents[1].joinpath('runtime.json').read_text(encoding='utf-8-sig'))
    sys.path.append(str(Path(runtime['python']).parents[1]/'Lib'/'site-packages'))
    import sounddevice as sd
import soundfile as sf
from execution_lock import ExecutionLock
from speech import SpeechStreamPlayer
from speech_buffering import SpeechBufferPlan
from speech_config import validate_request
from speech_stream_audio import SpeechStreamProcessor
from speech_stream_backend import generate_stream
from speech_worker import Generator

TEXT='今日は、みんなに大切なことを伝えたいです。いつもそばにいてくれて、ありがとう。みんなのことがすきです。'
SCENE='大切な気持ちをまっすぐ伝える。息で押さず、お腹で支えるような芯と自然な響きを意識し、重要な言葉は少し丁寧に、ゆっくり置く。声量は会話のまま。参照音声の声質と普段の高さを保つ。怒鳴ったり、低い声を作ったりしない。'

def replay(trace,text,adaptive):
    p=SpeechStreamPlayer.__new__(SpeechStreamPlayer)
    p.ring=np.zeros(48000*8,np.float32);p.read=p.write=p.available=0
    p.ring_lock=threading.Lock();p.ended=False;p.priming=True;p.rebuffers=0;p.continuity=1.
    p.position=0;p.mix=1.;p.muted=lambda:False;p.unlock=threading.Event()
    p.playback=queue.Queue(maxsize=1);p.sequence=0;p.error='';p.first_audio_dac_ms=None
    plan=SpeechBufferPlan(text);pending=deque();source=iter(trace);next_chunk=next(source,None)
    began=None;first_audio=None;t=0.;render=[];times=SimpleNamespace(currentTime=0.,outputBufferDacTime=.04)
    while t<trace[-1][0]+125:
        while next_chunk and next_chunk[0]<=t:
            produced,audio,ended=next_chunk;plan.observe(len(audio),None if ended else produced)
            pending.append((audio,ended));next_chunk=next(source,None)
            if began is None and (not adaptive or plan.ready() or ended):began=t
        if began is not None:
            while pending:
                audio,ended=pending[0]
                if not p.append(audio,ended=ended):break
                pending.popleft()
            out=np.empty((480,1),np.float32)
            complete=False;available=p.available
            try:p.callback(out,480,times,False)
            except sd.CallbackStop:complete=True
            if p.available<available and first_audio is None:first_audio=t+.04
            render.append(out[:,0].copy())
            if complete:break
        t+=.01
    if p.available or pending or next_chunk:raise RuntimeError('Playback lost its final samples')
    pcm=np.concatenate(render)
    return pcm,dict(rebuffers=p.rebuffers,startSeconds=first_audio,deviceCreatedSeconds=began,outputSeconds=len(pcm)/48000,
                    sourceFrames=sum(len(c[1]) for c in trace))

def replay_saved(folder):
    path=folder/'continuity.json';report=json.loads(path.read_text(encoding='utf-8'))
    for run in report['runs']:
        pcm,rate=sf.read(folder/(run['name']+'.wav'),dtype='float32');assert rate==48000
        times=run['producerSeconds'];codec=run['meta']['codecFrames'];trace=[];offset=0
        for i,produced in enumerate(times[:-1]):
            frames=min(8,codec-i*8)*3840-(260 if i==0 else 0)
            trace.append((produced,pcm[offset:offset+frames],False));offset+=frames
        assert len(pcm)-offset==260
        trace.append((times[-1],pcm[offset:],True))
        for adaptive,name in [(False,'old'),(True,'new')]:
            rendered,run[name]=replay(trace,report['text'],adaptive)
            sf.write(folder/(run['name']+('-adaptive-buffer.wav' if adaptive else '-fixed-buffer.wav')),rendered,48000,subtype='PCM_24')
        print(json.dumps(dict(name=run['name'],old=run['old'],new=run['new'])),flush=True)
    report['playbackReplayedFromPcm24']=True
    path.write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    if any(run['new']['rebuffers'] for run in report['runs']):raise RuntimeError('Adaptive reserve still starves')

def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--cache');parser.add_argument('--output',required=True);parser.add_argument('--replay',action='store_true')
    args=parser.parse_args();folder=Path(args.output);folder.mkdir(parents=True,exist_ok=True)
    if args.replay:return replay_saved(folder)
    if not args.cache:parser.error('--cache is required for CUDA synthesis')
    report=dict(text=TEXT,runs=[])
    with ExecutionLock('Local\\VoiceChanger-HQ-GPU-v1'):
        generator=Generator(args.cache)
        generate_stream(generator,validate_request(dict(schemaVersion=1,text='こんにちは。',preferences={})),lambda *args:None,threading.Event())
        for name,scene in [('natural',''),('supported',SCENE)]:
            request=validate_request(dict(schemaVersion=1,text=TEXT,preferences=dict(scene=scene)))
            processor=SpeechStreamProcessor(dict(outputGainDb=-3),False);trace=[];began=time.perf_counter()
            def emit(audio,rate,start):trace.append((time.perf_counter()-began,processor.feed(audio),False))
            meta=generate_stream(generator,request,emit,threading.Event())
            trace.append((time.perf_counter()-began,processor.finish(),True))
            pcm=np.concatenate([chunk[1] for chunk in trace]);sf.write(folder/(name+'.wav'),pcm,48000,subtype='PCM_24')
            before,old=replay(trace,TEXT,False);after,new=replay(trace,TEXT,True)
            sf.write(folder/(name+'-fixed-buffer.wav'),before,48000,subtype='PCM_24')
            sf.write(folder/(name+'-adaptive-buffer.wav'),after,48000,subtype='PCM_24')
            result=dict(name=name,scene=scene,meta=meta,producerSeconds=[c[0] for c in trace],old=old,new=new,
                        rms=float(np.sqrt(np.mean(pcm**2))),peak=float(np.max(np.abs(pcm))),sourceFrames=len(pcm))
            report['runs'].append(result);print(json.dumps(result,ensure_ascii=False),flush=True)
    (folder/'continuity.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    if any(run['new']['rebuffers'] for run in report['runs']):raise RuntimeError('Adaptive reserve still starves on the measured producer trace')

if __name__=='__main__':main()
