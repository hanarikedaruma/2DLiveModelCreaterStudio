# SPDX-License-Identifier: GPL-3.0-or-later
"""Pinned Qwen adapter: whole-text conditioning with incremental codec output.

The outer model still constructs its original prompt. Only this worker's bound
Talker.generate call is scoped; no upstream installation is changed. A forward
hook observes complete RVQ frames rather than the first-codebook text streamer.
"""
import hashlib
import json
from pathlib import Path
import time


class SpeechCancelled(Exception):
    pass


class _GenerationComplete(Exception):
    pass


def verify_stream_backend():
    import qwen_tts
    from importlib.metadata import version
    if version('qwen-tts') != '0.1.1' or version('transformers') != '4.57.3':
        raise RuntimeError('逐次再生に対応する音声エンジンの版が異なります。全文生成後の再生を選んでください')
    audit=json.loads(Path(__file__).with_name('speech-stream-source.json').read_text(encoding='utf-8-sig'))
    root=Path(qwen_tts.__file__).resolve().parent.parent
    for item in audit['modules']:
        if hashlib.sha256((root/item['path']).read_bytes()).hexdigest()!=item['sha256']:
            raise RuntimeError('音声エンジンの内容が変わっています。全文生成後の再生を選んでください')


def generate_stream(generator, request, emit, cancelled, *, first_frames=8, chunk_frames=8):
    verify_stream_backend()
    generator.prepare_speaker(request)
    t=generator.torch
    model=generator.model
    talker=model.model.talker
    tokenizer=model.model.speech_tokenizer
    rate=int(tokenizer.get_output_sample_rate())
    upsample=int(tokenizer.model.get_decode_upsample_rate())
    if rate!=24000 or talker.config.num_code_groups!=16:
        raise RuntimeError('このモデルは逐次再生に対応していません')
    pending=[]
    onset_audio=[]
    renderer=None
    initial_processed=False
    sent=0;frames=0;first_pcm=None
    started=time.perf_counter()
    accelerator=getattr(generator,'predictor_graph',None)
    previous_replays=accelerator.replays if accelerator else 0
    eos=int(talker.config.codec_eos_token_id)
    original=talker.generate
    had_local='generate' in talker.__dict__
    previous=talker.__dict__.get('generate')
    session=None
    def check():
        if cancelled.is_set():raise SpeechCancelled()
    def emit_audio(audio):
        nonlocal sent,first_pcm
        if not len(audio):return
        if sent+len(audio)>=120*rate:raise RuntimeError('発話が長すぎます。文章を短くしてください')
        check()
        if first_pcm is None:first_pcm=time.perf_counter()-started
        for offset in range(0,len(audio),round(.64*rate)):
            check();piece=audio[offset:offset+round(.64*rate)]
            emit(piece,rate,sent);sent+=len(piece)
    def flush(final=False):
        nonlocal pending,onset_audio,renderer,initial_processed
        if not pending and not (final and onset_audio):return
        check()
        if pending:
            codes=t.stack(pending,dim=-1)
            wave=session.feed(codes).reshape(-1)
            if wave.numel()!=len(pending)*upsample:raise RuntimeError('復号した音声の長さが不正です')
            audio=wave.to(t.float32).detach().cpu().numpy()
            pending=[]
        else:audio=generator.np.empty(0,dtype=generator.np.float32)
        if not generator.np.isfinite(audio).all():raise RuntimeError('生成音声に不正な値があります')
        raw=audio
        if not initial_processed and getattr(generator,'breathy_onset',False):
            from speech_onset import needs_onset_context,soften_onset
            extended=getattr(generator,'breathy_onset_vowel','あ')!='あ'
            onset_audio.append(audio)
            audio=generator.np.concatenate(onset_audio)
            if extended and not final and needs_onset_context(audio,rate):return
            onset_audio=[]
            raw=audio
            began=time.perf_counter();audio,meta=soften_onset(audio,rate,request['seed'],extended=extended)
            generator.performance_metrics.update(meta,breathyOnsetMs=(time.perf_counter()-began)*1000,
                breathyOnsetContextMs=len(audio)/rate*1000)
        initial_processed=True
        if request.get('preferences',{}).get('style')=='shy':
            if renderer is None:
                from speech_shy import ShyRenderer
                renderer=ShyRenderer(raw,generator.performance_metrics,getattr(generator,'breathy_onset_vowel',''),
                    generator.performance_text,request['seed'])
            began=time.perf_counter();audio=renderer.feed(audio)
            elapsed=(time.perf_counter()-began)*1000
            generator.performance_metrics.update(renderer.metrics,shyProcessingMs=generator.performance_metrics.get('shyProcessingMs',0)+elapsed)
        emit_audio(audio)
    def frame_hook(_module,_inputs,output):
        nonlocal frames
        check()
        codes=output.hidden_states[1]
        if codes is None:return  # prefillには音声コードがない。
        if codes.shape!=(1,16):raise RuntimeError('音声コードの形状が変わっています')
        if int(codes[0,0].item())==eos:return
        pending.append(codes.detach().clone())
        frames+=1
        threshold=4 if onset_audio or (renderer and renderer.waiting_for_word) else first_frames if sent==0 else chunk_frames
        if len(pending)>=threshold:flush()
    def stream_generate(*args,**kwargs):
        # 各層の全発話hidden statesを保持しない。forward hookの完全な
        # 音声フレームを使い、上位APIによる全波形の再復号も行わない。
        kwargs['output_hidden_states']=False
        result=original(*args,**kwargs)
        check()
        if int(result.sequences[0,-1].item())!=eos:
            raise RuntimeError('音声が生成上限に達しました。文章を短くしてください')
        raise _GenerationComplete()
    hook=talker.register_forward_hook(frame_hook)
    talker.generate=stream_generate
    try:
        with t.inference_mode():
            from speech_decoder import prepare_decoder
            session=prepare_decoder(generator,cancelled)
            t.manual_seed(request['seed'])
            with session:
                try:
                    generator.synthesize(request)
                except _GenerationComplete:pass
                flush(final=True)
                if renderer is not None:
                    began=time.perf_counter();emit_audio(renderer.finish())
                    generator.performance_metrics.update(renderer.metrics,shyProcessingMs=generator.performance_metrics.get('shyProcessingMs',0)+(time.perf_counter()-began)*1000)
    finally:
        hook.remove()
        if had_local:talker.generate=previous
        else:del talker.generate
    elapsed=time.perf_counter()-started
    if sent==0:raise RuntimeError('生成音声がありません')
    return dict(rate=rate,frames=sent,seconds=sent/rate,generationSeconds=elapsed,
        firstPcmSeconds=first_pcm,rtf=elapsed/(sent/rate),codecFrames=frames,
        vramMiB=t.cuda.max_memory_allocated()/1048576,delivery='stream',speakerKey=generator.speaker_key,
        cudaGraph=int(bool(accelerator and accelerator.verified and accelerator.replays>previous_replays)),
        predictorGraphReplays=accelerator.replays-previous_replays if accelerator else 0,
        textEmbeddingOffloadMiB=getattr(generator,'text_offload_mib',0),statefulDecoder=1,
        **getattr(generator,'performance_metrics',{}))
