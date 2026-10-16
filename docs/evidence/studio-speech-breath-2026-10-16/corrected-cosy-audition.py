"""Isolated, fixed-reference audition. No app updates, microphone or output device."""
import os,sys,time,json,threading,io,hashlib
from pathlib import Path
root=next(parent for parent in Path(__file__).resolve().parents if (parent/'tools/voice-engine/speech_config.py').is_file())
from importlib.metadata import version
if version('transformers')!='4.51.3' or version('tokenizers')!='0.21.4':
    raise RuntimeError('CosyVoice audition requires its isolated transformers 4.51.3 / tokenizers 0.21.4 environment; do not reuse the Qwen runtime.')
folder=root/'.cache/cosyvoice-breath'
source=folder/'source';model_dir=folder/'model';out=Path(os.environ.get('STUDIO_SPEECH_AUDITION_DIR',str(root/'.cache/speech-breath/cosyvoice'))).resolve()
out.mkdir(parents=True,exist_ok=True)
os.environ.update(HF_HUB_OFFLINE='1',TRANSFORMERS_OFFLINE='1',HF_HUB_DISABLE_TELEMETRY='1')
sys.path[:0]=[str(root/'tools/voice-engine'),str(source),str(source/'third_party/Matcha-TTS')]
from execution_lock import ExecutionLock
def timeout():
    print('Audition timeout',file=sys.stderr,flush=True);os._exit(2)
timer=threading.Timer(180,timeout);timer.daemon=True;timer.start()
with ExecutionLock('Local\\VoiceChanger-HQ-GPU-v1'):
    import torch,numpy as np,soundfile as sf
    from hyperpyyaml import load_hyperpyyaml
    from ruamel.yaml import YAML
    from cosyvoice.cli.frontend import CosyVoiceFrontEnd
    from cosyvoice.cli.model import CosyVoice3Model
    torch.set_num_threads(4)
    began=time.perf_counter()
    # Keep the exact inference configuration; omit training-only discriminators,
    # data pipelines and optimizers so no training datasets/dependencies load.
    yaml=YAML();config=yaml.load((model_dir/'cosyvoice3.yaml').read_text(encoding='utf-8'))
    keep={'sample_rate','llm_input_size','llm_output_size','spk_embed_dim','qwen_pretrain_path','token_frame_rate','token_mel_ratio',
          'chunk_size','num_decoding_left_chunks','llm','flow','hift','get_tokenizer','allowed_special','feat_extractor'}
    reduced={key:value for key,value in config.items() if key in keep}
    stream=io.StringIO();yaml.dump(reduced,stream)
    configs=load_hyperpyyaml(stream.getvalue(),overrides={'qwen_pretrain_path':str(model_dir/'CosyVoice-BlankEN')})
    frontend=CosyVoiceFrontEnd(configs['get_tokenizer'],configs['feat_extractor'],str(model_dir/'campplus.onnx'),
        str(model_dir/'speech_tokenizer_v3.onnx'),allowed_special=configs['allowed_special'])
    model=CosyVoice3Model(configs['llm'],configs['flow'],configs['hift'],fp16=True)
    model.load(str(model_dir/'llm.pt'),str(model_dir/'flow.pt'),str(model_dir/'hift.pt'))
    model.llm.half();model.flow.half();torch.cuda.empty_cache()
    print('Loaded',time.perf_counter()-began,flush=True)
    reference=root/'tools/voice-engine/voices/original-soft-girl.wav'
    speaker_key=hashlib.sha256(reference.read_bytes()).hexdigest()
    audio,rate=sf.read(reference,dtype='float32')
    prompt_file=out/'reference-first-six-seconds.wav'
    sf.write(prompt_file,audio[:6*rate],rate,subtype='PCM_24')
    # Cache exactly one speaker's reference features for all comparison runs.
    prompt=frontend.frontend_zero_shot('', 'You are a helpful assistant.<|endofprompt|>',str(prompt_file),24000,'')
    prompt['llm_embedding']=prompt['flow_embedding']=frontend._extract_spk_embedding(str(reference))
    del prompt['text'];del prompt['text_len'];frontend.spk2info['fixed']=prompt
    runs=[]
    cases=[('neutral','あなたのことが大好きです。','You are a helpful assistant.<|endofprompt|>'),
        ('breath','[breath]あなたのことがぁ…[breath]だっ…[quick_breath]だいすきぃ…[breath]',
         'You are a helpful assistant. Please say a sentence in a very soft voice. Speak Japanese, shy and embarrassed, with tender breathy hesitation, phrase endings fading weakly into breath.<|endofprompt|>'),
        ('faithful','[breath]あなたのことがぁ…[breath]だっ…[quick_breath]大好きですぅ…[breath]',
         'You are a helpful assistant. Please say a sentence in a very soft voice.<|endofprompt|>')]
    for name,text,instruction in cases:
        # Upstream grows this shared field during a stream. Each new utterance
        # must start at its configured initial hop rather than the previous tail.
        model.token_hop_len=25
        torch.manual_seed(31415);np.random.seed(31415)
        import random;random.seed(31415)
        if instruction:
            inputs=frontend.frontend_instruct2(text,instruction,str(reference),24000,'fixed')
        else:inputs=frontend.frontend_zero_shot(text,'',str(reference),24000,'fixed')
        waves=[];first=None;began=time.perf_counter()
        with torch.inference_mode():
            for output in model.tts(**inputs,stream=True):
                if first is None:first=time.perf_counter()-began
                waves.append(output['tts_speech'].float().numpy().reshape(-1))
                print(name,'chunk',len(waves),'seconds',sum(len(wave) for wave in waves)/24000,'wall',time.perf_counter()-began,flush=True)
        audio=np.concatenate(waves);elapsed=time.perf_counter()-began
        if not np.isfinite(audio).all() or not .1<len(audio)/24000<120:raise RuntimeError('Invalid audition')
        sf.write(out/(name+'.wav'),audio,24000,subtype='PCM_24')
        from importlib.metadata import version
        run=dict(name=name,text=text,instruction=instruction,transformers=version('transformers'),tokenizers=version('tokenizers'),generationSeconds=elapsed,seconds=len(audio)/24000,
            firstPcmSeconds=first,vramMiB=torch.cuda.max_memory_allocated()/1048576,speakerKey=speaker_key)
        runs.append(run);print(json.dumps(run,ensure_ascii=False),flush=True)
        (out/'report.json').write_text(json.dumps(runs,ensure_ascii=False,indent=2),encoding='utf-8')
timer.cancel()
