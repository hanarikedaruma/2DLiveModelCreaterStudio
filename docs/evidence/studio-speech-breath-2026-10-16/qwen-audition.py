import sys,json,threading,time,types
from pathlib import Path
root=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(root/'tools/voice-engine'))
from execution_lock import ExecutionLock
from speech_config import validate_request
from speech_stream_backend import generate_stream
from speech_worker import Generator

folder=root/'.cache/speech-breath/qwen';folder.mkdir(parents=True,exist_ok=True)
instruction='Speak fluent Japanese as the reference speaker. Shy, embarrassed confession to someone you love. A small involuntary caught "ah", then hesitant tender speech, the ends of phrases trail off weakly into airy breath. Take short audible breaths in the ellipses, gently restart the voice, with a soft trailing vowel at the end. Not mechanical stuttering or rhythmic pausing. Do not lower the habitual pitch. Keep the same speaker, timbre and age. Read only the supplied text.'
runs=[]
with ExecutionLock('Local\\VoiceChanger-HQ-GPU-v1'):
    g=Generator(root/'.cache/speech-models')
    old=g.synthesize
    generate_stream(g,validate_request(dict(schemaVersion=1,text='こんにちは。',preferences={})),lambda *a:None,threading.Event())
    for name,text in [('old','あなたのことが大好きです'),('phonetic','ぁっ……あなたのことがぁ……だっ……だいすきぃ'),('faithful','ぁっ……あなたのことがぁ……だっ……大好きですぅ')]:
        request=validate_request(dict(schemaVersion=1,text=text,preferences=dict(style='shy')))
        if name=='old':g.synthesize=old
        else:
            def perform(self,req):
                self.prepare_speaker(req)
                self.performance_metrics={}
                return self.model.generate_voice_clone(text=req['text'],language='Japanese',voice_clone_prompt=self.prompt,
                    instruct_ids=self.model._tokenize_texts([self.model._build_instruct_text(instruction)]),non_streaming_mode=True,max_new_tokens=1536)
            g.synthesize=types.MethodType(perform,g)
        waves=[]
        meta=generate_stream(g,request,lambda wave,*a:waves.append(wave.copy()),threading.Event())
        g.sf.write(folder/(name+'.wav'),g.np.concatenate(waves),24000,subtype='PCM_24')
        run=dict(name=name,text=text,meta=meta);runs.append(run);print(json.dumps(run,ensure_ascii=False),flush=True)
(folder/'report.json').write_text(json.dumps(runs,ensure_ascii=False,indent=2),encoding='utf-8')
