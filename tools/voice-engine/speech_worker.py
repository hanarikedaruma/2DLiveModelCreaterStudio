# SPDX-License-Identifier: GPL-3.0-or-later
"""One bounded local utterance; no network, downloads, or microphone input."""
import argparse,contextlib,json,os,sys,time,hashlib
import queue,threading
from pathlib import Path
from speech_config import CLONE_MODEL_ID as MODEL_ID,CLONE_MODEL_REVISION as MODEL_REVISION,validate_request,build_delivery_instruction
from speech_delivery import prepare_performance
from speech_onset import onset_vowel,soften_onset

def read_request(source,output):
    source=Path(source).resolve();output=Path(output).resolve()
    if source.stat().st_size>32768:raise ValueError("読み上げデータが大きすぎます")
    request=validate_request(json.loads(source.read_text(encoding="utf-8-sig")))
    if output==source or output.suffix.lower()!=".wav":raise ValueError("出力先が不正です")
    return request,output

class Generator:
    def __init__(self,cache):
        os.environ.update(HF_HOME=str(Path(cache).resolve()),HF_HUB_OFFLINE="1",TRANSFORMERS_OFFLINE="1",HF_HUB_DISABLE_TELEMETRY="1")
        started=time.perf_counter()
        import numpy as np
        import torch
        import soundfile as sf
        from huggingface_hub import snapshot_download
        from qwen_tts import Qwen3TTSModel
        torch.set_num_threads(4)
        if not torch.cuda.is_available():raise RuntimeError("読み上げにはCUDA対応GPUが必要です")
        path=snapshot_download(MODEL_ID,revision=MODEL_REVISION,local_files_only=True,cache_dir=str(Path(cache).resolve()))
        self.model=Qwen3TTSModel.from_pretrained(path,device_map="cuda:0",dtype=torch.bfloat16,attn_implementation="sdpa")
        self.torch=torch;self.np=np;self.sf=sf;self.calls=0;self.load_seconds=time.perf_counter()-started
        self.speaker_key=None;self.prompt=None
        self.performance_metrics={}
        from speech_memory import offload_text_embedding
        from speech_predictor_graph import enable_predictor_graph
        self.text_offload_mib=offload_text_embedding(self)
        self.predictor_graph=enable_predictor_graph(self)
        self.load_seconds=time.perf_counter()-started
    def prepare_speaker(self,request):
        reference=Path(request.get('speaker',{}).get('reference',Path(__file__).parent/'voices'/'original-soft-girl.wav')).resolve()
        if not reference.is_file() or reference.stat().st_size>32*1024*1024:raise ValueError('話者の参照音声が不正です')
        raw=reference.read_bytes();key=hashlib.sha256(raw).hexdigest()
        if request.get('speaker',{}).get('sha256',key)!=key:raise ValueError('参照音声が変更されました。入力を更新して再試行してください')
        if key==self.speaker_key:return
        audio,rate=self.sf.read(reference,dtype='float32',always_2d=True)
        if not 1<=len(audio)/rate<=90 or not self.np.isfinite(audio).all():raise ValueError('話者の参照音声が不正です')
        transcript=None
        try:
            path=reference.with_suffix('.json')
            if path.stat().st_size<=16000:
                metadata=json.loads(path.read_text(encoding='utf-8-sig'))
                if metadata.get('model')=='Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign':transcript=metadata.get('text')
        except (OSError,ValueError):pass
        if not isinstance(transcript,str) or not 1<=len(transcript)<=2000:transcript=None
        self.prompt=self.model.create_voice_clone_prompt(ref_audio=(audio.mean(axis=1),rate),ref_text=transcript,x_vector_only_mode=transcript is None)
        self.speaker_key=key
    def synthesize(self,request):
        self.prepare_speaker(request)
        began=time.perf_counter();performance=prepare_performance(request['text'],request['preferences']['style'])
        self.breathy_onset_vowel=onset_vowel(performance.text,request['preferences']['style'])
        self.breathy_onset=bool(self.breathy_onset_vowel)
        self.performance_text=performance.text
        self.performance_metrics=dict(performanceMs=(time.perf_counter()-began)*1000,hesitations=performance.hesitations,
            breathyOnsetEligible=int(self.breathy_onset),breathyOnset=0,shyDelivery=0)
        instruction=build_delivery_instruction(request)
        instruct_ids=self.model._tokenize_texts([self.model._build_instruct_text(instruction)])
        return self.model.generate_voice_clone(text=performance.text,language='Japanese',voice_clone_prompt=self.prompt,
            instruct_ids=instruct_ids,non_streaming_mode=True,max_new_tokens=1536)
    def generate(self,request,output):
        torch=self.torch;np=self.np;sf=self.sf;torch.manual_seed(request["seed"])
        started=time.perf_counter()
        # Whole-text conditioning preserves phrasing across punctuation. The
        # reference-building model also accepts semantic delivery directions.
        waves,rate=self.synthesize(request)
        audio=np.asarray(waves[0],dtype=np.float32)
        if audio.ndim!=1 or not np.isfinite(audio).all() or not .1<=len(audio)/rate<120:raise RuntimeError("生成音声が空・長すぎる・不正です。文章を短くして再試行してください")
        if np.max(np.abs(audio))<1e-5:raise RuntimeError("生成音声が無音です")
        raw=audio
        if self.breathy_onset:
            began=time.perf_counter();audio,meta=soften_onset(audio,rate,request['seed'],extended=self.breathy_onset_vowel!='あ')
            self.performance_metrics.update(meta,breathyOnsetMs=(time.perf_counter()-began)*1000)
        if request['preferences']['style']=='shy':
            from speech_shy import ShyRenderer
            began=time.perf_counter();renderer=ShyRenderer(raw,self.performance_metrics,self.breathy_onset_vowel,self.performance_text,request['seed'])
            audio=np.r_[renderer.feed(audio),renderer.finish()]
            self.performance_metrics.update(renderer.metrics,shyProcessingMs=(time.perf_counter()-began)*1000)
        if len(audio)/rate>=120:raise RuntimeError('発話が長すぎます。文章を短くしてください')
        output.parent.mkdir(parents=True,exist_ok=True)
        temporary=output.with_suffix(".tmp.wav")
        sf.write(temporary,audio,rate,subtype="PCM_24");temporary.replace(output)
        self.calls+=1
        return {"output":str(output),"rate":rate,"frames":len(audio),"seconds":len(audio)/rate,
            "loadSeconds":self.load_seconds if self.calls==1 else 0.,"generationSeconds":time.perf_counter()-started,
            "vramMiB":torch.cuda.max_memory_allocated()/1048576,"model":MODEL_ID,"speakerKey":self.speaker_key,"contextTurns":len(request["history"]),"reusedModel":self.calls>1,**self.performance_metrics}

def main():
    parser=argparse.ArgumentParser();parser.add_argument("--request")
    parser.add_argument("--cache",required=True);parser.add_argument("--output");parser.add_argument("--serve",action="store_true")
    parser.add_argument('--stream-serve',action='store_true')
    args=parser.parse_args();generator=None
    if args.stream_serve:return serve_stream(args.cache)
    while True:
        if args.serve:
            packet=sys.stdin.buffer.readline(8193)
            if not packet:return
            if len(packet)>8192:raise ValueError("読み上げ要求が大きすぎます")
            command=json.loads(packet.decode("utf-8"));source=command["request"];output=command["output"]
        else:source=args.request;output=args.output
        request,output=read_request(source,output)
        with contextlib.redirect_stdout(sys.stderr):
            if generator is None:generator=Generator(args.cache)
            result=generator.generate(request,output)
        print(json.dumps(result),flush=True)
        if not args.serve:return

def serve_stream(cache):
    from speech_stream_protocol import write_packet,command_lines
    from speech_stream_backend import generate_stream,SpeechCancelled
    output=sys.stdout.buffer;write_lock=threading.Lock()
    requests=queue.Queue(maxsize=1);active={};closed=threading.Event()
    def send(value,audio=None):
        with write_lock:write_packet(output,value,audio)
    def read_commands():
        try:
            for line in command_lines(sys.stdin.buffer,closed):
                value=json.loads(line.decode('utf-8'))
                if value.get('action')=='cancel':
                    if value.get('id')==active.get('id'):active['cancel'].set()
                elif value.get('action')=='generate':
                    if active.get('id'):raise ValueError('読み上げを重複して要求できません')
                    active.update(id=value['id'],cancel=threading.Event())
                    requests.put_nowait((value,active['cancel']))
                else:raise ValueError('未対応の読み上げ操作です')
        except Exception as error:
            print(str(error),file=sys.stderr,flush=True)
        finally:
            closed.set()
            if active.get('cancel'):active['cancel'].set()
            try:requests.put_nowait(None)
            except queue.Full:pass
    # Initial cold loading precedes the command reader. The reader also uses
    # nonblocking pipe reads so first-use native libraries cannot deadlock on stdin.
    with contextlib.redirect_stdout(sys.stderr):generator=Generator(cache)
    threading.Thread(target=read_commands,daemon=True).start()
    while not closed.is_set():
        item=requests.get()
        if item is None:return
        value,cancelled=item;identity=value['id']
        try:
            request,destination=read_request(value['request'],value['output'])
            with contextlib.redirect_stdout(sys.stderr):
                if cancelled.is_set():raise SpeechCancelled()
                if request['preferences']['delivery']=='stream':
                    sequence=0
                    def emit(audio,rate,start):
                        nonlocal sequence
                        send(dict(event='pcm',id=identity,sequence=sequence,startSample=start,sampleRate=rate,producedAt=time.perf_counter()),audio)
                        sequence+=1
                    meta=generate_stream(generator,request,emit,cancelled)
                    meta['loadSeconds']=generator.load_seconds if generator.calls==0 else 0.
                    generator.calls+=1
                else:meta=generator.generate(request,destination)
            # 次要求を受けられる状態にしてから完了を通知する。
            active.clear()
            send(dict(event='complete',id=identity,meta=meta))
        except SpeechCancelled:
            active.clear();send(dict(event='cancelled',id=identity))
        except Exception as error:
            active.clear();send(dict(event='error',id=identity,error=str(error)))

if __name__=="__main__":
    try:
        from execution_lock import ExecutionLock
        with ExecutionLock("Local\\VoiceChanger-HQ-GPU-v1"):main()
    except Exception as error:
        message=str(error)
        if "out of memory" in message.lower():message="GPUメモリが不足しています。GPUを使うアプリを減らして再試行してください"
        print(json.dumps({"error":message},ensure_ascii=False),flush=True);sys.exit(1)
