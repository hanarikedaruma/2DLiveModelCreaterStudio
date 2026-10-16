"""Two plain-text diagnostic paths, no breath tags; never modify the app."""
import sys,os,io,time,json,threading
from pathlib import Path
root=Path(__file__).resolve().parents[1];base=root/'.cache/cosyvoice-breath';source=base/'source';folder=base/'model'
sys.path[:0]=[str(root/'tools/voice-engine'),str(source),str(source/'third_party/Matcha-TTS')]
os.environ.update(HF_HUB_OFFLINE='1',TRANSFORMERS_OFFLINE='1',HF_HUB_DISABLE_TELEMETRY='1')
from execution_lock import ExecutionLock
def timeout():print('Diagnostic timeout',flush=True);os._exit(2)
timer=threading.Timer(180,timeout);timer.daemon=True;timer.start()
out=Path(os.environ.get('STUDIO_SPEECH_PROBE_DIR',str(root/'.cache/speech-content-check/cosy-probe'))).resolve();out.mkdir(parents=True,exist_ok=True)
with ExecutionLock('Local\\VoiceChanger-HQ-GPU-v1'):
    import torch,numpy as np,soundfile as sf,random
    from hyperpyyaml import load_hyperpyyaml
    from ruamel.yaml import YAML
    from cosyvoice.cli.frontend import CosyVoiceFrontEnd
    from cosyvoice.cli.model import CosyVoice3Model
    torch.set_num_threads(4)
    yaml=YAML();config=yaml.load((folder/'cosyvoice3.yaml').read_text(encoding='utf-8'))
    keep={'sample_rate','llm_input_size','llm_output_size','spk_embed_dim','qwen_pretrain_path','token_frame_rate','token_mel_ratio','chunk_size','num_decoding_left_chunks','llm','flow','hift','get_tokenizer','allowed_special','feat_extractor'}
    stream=io.StringIO();yaml.dump({key:value for key,value in config.items() if key in keep},stream)
    configs=load_hyperpyyaml(stream.getvalue(),overrides={'qwen_pretrain_path':str(folder/'CosyVoice-BlankEN')})
    front=CosyVoiceFrontEnd(configs['get_tokenizer'],configs['feat_extractor'],str(folder/'campplus.onnx'),str(folder/'speech_tokenizer_v3.onnx'),allowed_special='all')
    model=CosyVoice3Model(configs['llm'],configs['flow'],configs['hift'],fp16=False)
    model.load(str(folder/'llm.pt'),str(folder/'flow.pt'),str(folder/'hift.pt'))
    reference=root/'tools/voice-engine/voices/original-soft-girl.wav'
    short=root/'.cache/speech-breath/cosyvoice/reference-first-six-seconds.wav'
    transcript=json.loads(reference.with_suffix('.json').read_text(encoding='utf-8'))['text']
    report=[]
    cases=[('fp32-instruct-whole','あなたのことが大好きです。'),('fp32-icl-whole','あ、あなたのことが、だ、大好きです。')]
    for name,text in cases:
        torch.manual_seed(31415);np.random.seed(31415);random.seed(31415)
        if name=='fp32-instruct-whole':
            inputs=front.frontend_instruct2(text,'You are a helpful assistant.<|endofprompt|>',str(short),24000,'')
            inputs['llm_embedding']=inputs['flow_embedding']=front._extract_spk_embedding(str(reference))
        else:inputs=front.frontend_zero_shot(text,'You are a helpful assistant.<|endofprompt|>'+transcript,str(reference),24000,'')
        # Verify that UTF-8/input tokenization still contains exactly our Japanese.
        decoded=front.tokenizer.tokenizer.decode(inputs['text'][0].tolist(),skip_special_tokens=False)
        if decoded!=text:raise RuntimeError('Tokenizer round trip changed text: '+repr(decoded))
        print('Starting',name,'text',repr(decoded),flush=True)
        waves=[];began=time.perf_counter()
        with torch.inference_mode():
            for result in model.tts(**inputs,stream=False):waves.append(result['tts_speech'].float().numpy().reshape(-1))
        wave=np.concatenate(waves);sf.write(out/(name+'.wav'),wave,24000,subtype='PCM_24')
        from importlib.metadata import version
        row=dict(file=name+'.wav',text=text,tokenizerRoundTrip=decoded,precision='fp32',stream=False,transformers=version('transformers'),tokenizers=version('tokenizers'),
            generationSeconds=time.perf_counter()-began,seconds=len(wave)/24000)
        report.append(row);print(json.dumps(row,ensure_ascii=False),flush=True)
        (out/'generation.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
timer.cancel()
