"""Manual CUDA verification of full SHY delivery, not neutral onset-only samples.

Use a new output folder per audition. Files already presented to a listener must
not be overwritten. Hooks record decoded input and the normal shy renderer;
model, text, speaker prompt and seed remain the production values. The saved
result includes shy emotion, both airy attacks, timing and phrase-end effects.
"""
import argparse,hashlib,json,sys,threading
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import speech_onset
import speech_shy
from execution_lock import ExecutionLock
from speech_config import validate_request
from speech_delivery import prepare_performance
from speech_stream_backend import generate_stream
from speech_worker import Generator

CASES=[('i','い、行きます。'),('u','う、うん。'),('e','え、ええんですか。'),('o','お、おっきい。')]

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--cache',required=True);parser.add_argument('--output',required=True)
    args=parser.parse_args();folder=Path(args.output)
    folder.mkdir(parents=True,exist_ok=False)
    report=dict(runs=[])
    effect=speech_onset.soften_onset
    with ExecutionLock('Local\\VoiceChanger-HQ-GPU-v1'):
        generator=Generator(args.cache)
        generate_stream(generator,validate_request(dict(schemaVersion=1,text='こんにちは。',preferences={})),lambda *unused:None,threading.Event())
        for name,text in CASES:
            request=validate_request(dict(schemaVersion=1,text=text,preferences=dict(style='shy')))
            chunks=[];raw_prefix=[];before_style=[]
            original_renderer=speech_shy.ShyRenderer
            class RecordingRenderer(original_renderer):
                def feed(self,audio):
                    before_style.append(audio.copy())
                    return super().feed(audio)
            def capture(audio,rate,seed,**options):
                raw_prefix.append(audio.copy())
                return effect(audio,rate,seed,**options)
            with patch.object(speech_onset,'soften_onset',capture),patch.object(speech_shy,'ShyRenderer',RecordingRenderer):
                meta=generate_stream(generator,request,lambda wave,*unused:chunks.append(wave.copy()),threading.Event())
            if len(raw_prefix)!=1:raise RuntimeError('Expected exactly one initial packet')
            audio=generator.np.concatenate(chunks)
            prior=generator.np.concatenate(before_style)
            raw=generator.np.concatenate([raw_prefix[0],prior[len(raw_prefix[0]):]])
            initial,first_meta=effect(raw,24000,request['seed'],extended=True)
            planned=prepare_performance(text,'shy').text
            renderer=original_renderer(raw,first_meta,speech_onset.onset_vowel(planned,'shy'),planned,request['seed'])
            whole=generator.np.r_[renderer.feed(initial),renderer.finish()]
            hi=round(meta['breathyOnsetEndMs']*24)
            rms=generator.np.sqrt(generator.np.mean(raw[:len(raw)//240*240].reshape(-1,240).astype(float)**2,axis=1))
            body_active_ms=int((rms[(hi+239)//240:]>max(float(rms.max())*.06,1e-5)).sum())*10
            whole_equal=bool(generator.np.array_equal(whole,audio))
            hashes={}
            for label,wave in [('raw',raw),('shy',audio)]:
                path=folder/f'{name}-{label}-01.wav'
                generator.sf.write(path,wave,24000,subtype='PCM_24')
                hashes[label]=hashlib.sha256(path.read_bytes()).hexdigest()
            result=dict(vowel=name,text=text,performanceText=prepare_performance(text,'shy').text,
                style='shy',rawWav=f'{name}-raw-01.wav',wav=f'{name}-shy-01.wav',sha256=hashes,
                bodyActiveMs=body_active_ms,
                wholeAndStreamIdentical=whole_equal,meta=meta)
            report['runs'].append(result)
            (folder/'vowels.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
            print(json.dumps(result,ensure_ascii=False),flush=True)
    if len({run['meta']['speakerKey'] for run in report['runs']})!=1:raise RuntimeError('Reference speaker changed')
    if not all(run['meta']['breathyOnset']==1 and run['meta']['breathyWordOnset']==1 and run['meta']['shyTailBreaths']>=1 and run['bodyActiveMs']>=60 and run['wholeAndStreamIdentical'] for run in report['runs']):
        raise RuntimeError('Review onset abstention or PCM changes in vowels.json')

if __name__=='__main__':main()
