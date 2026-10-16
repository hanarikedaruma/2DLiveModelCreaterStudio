"""Offline content gate for audition WAVs; never runs in the live speech path.

Expected transcriptions are checked AFTER recognition, never given to the ASR.
Exact normalized alternatives avoid passing negations or unrelated extra speech
through a permissive fuzzy-match threshold. ASR is a diagnostic, not a listening test.
"""
import argparse,hashlib,json,os,time,unicodedata
from pathlib import Path

def normalized(text):
    return ''.join(c for c in unicodedata.normalize('NFKC',text).casefold() if c.isalnum())

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    for name in ('model','processor','cases','report'):parser.add_argument('--'+name,required=True)
    parser.add_argument('--language',help='Optional known language for very short clips; never an expected transcript')
    args=parser.parse_args()
    os.environ.update(HF_HUB_OFFLINE='1',TRANSFORMERS_OFFLINE='1',HF_HUB_DISABLE_TELEMETRY='1')
    import torch,numpy as np,soundfile as sf
    from scipy.signal import resample_poly
    from transformers import WhisperForConditionalGeneration,WhisperProcessor,GenerationConfig
    torch.set_num_threads(4)
    source=Path(args.cases).resolve()
    cases=json.loads(source.read_text(encoding='utf-8-sig'))
    if not isinstance(cases,list) or not cases:raise ValueError('Content cases must be a nonempty list')
    for case in cases:
        if not isinstance(case.get('expectedTranscripts'),list) or not case['expectedTranscripts'] or any(not isinstance(t,str) or not normalized(t) for t in case['expectedTranscripts']):
            raise ValueError('Each case needs explicit, nonempty expected transcript alternatives')
    processor=WhisperProcessor.from_pretrained(args.processor,local_files_only=True)
    model=WhisperForConditionalGeneration.from_pretrained(args.model,local_files_only=True,attn_implementation='sdpa').eval()
    model.generation_config=GenerationConfig.from_pretrained(args.processor,local_files_only=True)
    model.generation_config.forced_decoder_ids=None
    model.config.forced_decoder_ids=None
    report=dict(device='cpu',model=str(Path(args.model).resolve()),processor=str(Path(args.processor).resolve()),
        languageHint=args.language,
        note='No expected text or reference transcript supplied to ASR. Any language hint is recorded separately. Automatic recognition can err; matching is not proof of natural acting or identical voice.',runs=[])
    destination=Path(args.report);destination.parent.mkdir(parents=True,exist_ok=True)
    for case in cases:
        path=(source.parent/case['file']).resolve()
        wave,rate=sf.read(path,dtype='float32',always_2d=True)
        if not np.isfinite(wave).all() or not .1<=len(wave)/rate<=30:raise ValueError('Auditions must be finite and 0.1–30 seconds')
        audio=resample_poly(wave.mean(axis=1),16000,rate).astype(np.float32)
        features=processor(audio,sampling_rate=16000,return_tensors='pt',return_attention_mask=True)
        began=time.perf_counter()
        language_options={'language':args.language} if args.language else {}
        with torch.inference_mode():
            tokens=model.generate(input_features=features.input_features,attention_mask=features.attention_mask,
                task='transcribe',do_sample=False,max_new_tokens=160,return_timestamps=False,**language_options)
        transcript=processor.batch_decode(tokens,skip_special_tokens=True)[0]
        result=dict(file=case['file'],sha256=hashlib.sha256(path.read_bytes()).hexdigest(),seconds=len(audio)/16000,
            expectedTranscripts=case['expectedTranscripts'],transcript=transcript,
            contentMatch=normalized(transcript) in {normalized(text) for text in case['expectedTranscripts']},
            recognitionSeconds=time.perf_counter()-began)
        report['runs'].append(result)
        print(json.dumps(result,ensure_ascii=False),flush=True)
        report['allContentMatched']=all(run['contentMatch'] for run in report['runs'])
        destination.write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    return 0 if report['allContentMatched'] else 1

if __name__=='__main__':raise SystemExit(main())
