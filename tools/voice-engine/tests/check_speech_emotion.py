"""Manual CUDA fixed-speaker A/B for shy restarts; save WAV and latency, no output device."""
import argparse,json,sys,threading,time
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from execution_lock import ExecutionLock
from speech_config import validate_request
from speech_delivery import prepare_performance
from speech_stream_backend import generate_stream
from speech_worker import Generator

def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--cache',required=True);parser.add_argument('--output',required=True)
    args=parser.parse_args();folder=Path(args.output);folder.mkdir(parents=True,exist_ok=True)
    texts=['あなたのことが大好きです','みんなのことが大好きです']
    report=dict(runs=[])
    with ExecutionLock('Local\\VoiceChanger-HQ-GPU-v1'):
        generator=Generator(args.cache)
        generate_stream(generator,validate_request(dict(schemaVersion=1,text='こんにちは。',preferences={})),lambda *unused:None,threading.Event())
        for i,text in enumerate(texts):
            for style in ('cheerful','shy'):
                request=validate_request(dict(schemaVersion=1,text=text,preferences=dict(style=style)))
                waves=[];began=time.perf_counter();performance=prepare_performance(text,style);plan_ms=(time.perf_counter()-began)*1000
                meta=generate_stream(generator,request,lambda wave,*unused:waves.append(wave.copy()),threading.Event())
                audio=generator.np.concatenate(waves);filename=f'{i}-{style}.wav'
                generator.sf.write(folder/filename,audio,24000,subtype='PCM_24')
                result=dict(text=text,style=style,performanceText=performance.text,planningMs=plan_ms,wav=filename,meta=meta)
                report['runs'].append(result);print(json.dumps(result,ensure_ascii=False),flush=True)
    (folder/'emotion.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    if len({run['meta']['speakerKey'] for run in report['runs']})!=1:raise RuntimeError('Reference speaker changed')

if __name__=='__main__':main()
