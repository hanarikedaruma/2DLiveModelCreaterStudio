"""Manual CUDA regression for the reported mid-utterance register drop.

python tests/check_speech_decoder.py --cache <model cache> --output <folder>
The fixture holds codec tokens, so synthesis randomness cannot hide the defect.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import sys
import threading
import time
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from execution_lock import ExecutionLock
from speech_config import CLONE_MODEL_ID, CLONE_MODEL_REVISION
from speech_decoder import prepare_decoder
from speech_stream_backend import verify_stream_backend


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--cache', required=True)
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    os.environ.update(HF_HUB_OFFLINE='1', TRANSFORMERS_OFFLINE='1', HF_HUB_DISABLE_TELEMETRY='1')
    import librosa
    import numpy as np
    import soundfile as sf
    import torch
    from huggingface_hub import snapshot_download
    from qwen_tts import Qwen3TTSTokenizer
    torch.set_num_threads(4)
    verify_stream_backend()
    folder = Path(args.output)
    folder.mkdir(parents=True, exist_ok=True)
    fixture = json.loads(Path(__file__).with_name('fixtures').joinpath('speech-pitch-codes.json').read_text(encoding='utf-8'))

    def pitch(wave):
        y = librosa.resample(wave, orig_sr=24000, target_sr=16000)
        f0, voiced, probability = librosa.pyin(y, fmin=55, fmax=600, sr=16000, frame_length=1024, hop_length=160)
        rms = librosa.feature.rms(y=y, frame_length=1024, hop_length=160)[0]
        valid = voiced & (probability > .25) & (rms > .007) & np.isfinite(f0)
        return dict(medianHz=float(np.median(f0[valid])), minHz=float(f0[valid].min()),
                    below140Ms=int(np.sum(valid & (f0 < 140)))*10,
                    f0Hz=[float(value) if ok else None for value, ok in zip(f0, valid)])

    with ExecutionLock('Local\\VoiceChanger-HQ-GPU-v1'), torch.inference_mode():
        path = snapshot_download(CLONE_MODEL_ID, revision=CLONE_MODEL_REVISION,
                                 local_files_only=True, cache_dir=args.cache)
        tokenizer = Qwen3TTSTokenizer.from_pretrained(str(Path(path)/'speech_tokenizer'),
                        device_map='cuda:0', dtype=torch.bfloat16, attn_implementation='sdpa')
        decoder = tokenizer.model.decoder
        reference = torch.tensor(fixture['referenceCodes'], device='cuda', dtype=torch.long)
        generated = torch.tensor(fixture['generatedCodes'], device='cuda', dtype=torch.long)
        generator = SimpleNamespace(torch=torch, model=SimpleNamespace(model=SimpleNamespace(speech_tokenizer=tokenizer)),
                                    prompt=[SimpleNamespace(ref_code=reference)], speaker_key=fixture['speakerKey'])
        expected = decoder(torch.cat((reference, generated)).T.unsqueeze(0)).flatten()[len(reference)*1920:].float().cpu().numpy()
        # Reproduce the previous short-lookback path from the same tokens.
        history, old = reference[-25:], []
        for begin in range(0, len(generated), 8):
            current = generated[begin:begin+8]
            old.append(decoder(torch.cat((history, current)).T.unsqueeze(0)).flatten()[len(history)*1920:].float().cpu().numpy())
            history = torch.cat((history, current))[-25:]
        original = np.concatenate(old)
        started = time.perf_counter()
        session = prepare_decoder(generator, threading.Event())
        prepare_seconds = time.perf_counter()-started

        def run(sizes):
            parts, begin = [], 0
            with prepare_decoder(generator, threading.Event()) as active:
                for count in sizes:
                    end = min(len(generated), begin+count)
                    if end > begin:
                        parts.append(active.feed(generated[begin:end].T.unsqueeze(0)).flatten().float().cpu().numpy())
                        begin = end
                attention_frames = max(layer.keys.shape[-2] for layer in active.state.attention.layers)
                assert attention_frames <= decoder.config.sliding_window
            assert begin == len(generated)
            return np.concatenate(parts), attention_frames

        actual, attention_frames = run([8]*8)
        repeated, _ = run([8]*8)
        irregular, _ = run([1, 3, 11, 2, 7, 20])
        # Cancellation must neither change the reference snapshot nor keep patches.
        try:
            with prepare_decoder(generator, threading.Event()) as interrupted:
                interrupted.feed(generated[:8].T.unsqueeze(0))
                raise InterruptedError()
        except InterruptedError:
            pass
        after_cancel, _ = run([8]*8)
        assert np.array_equal(actual, repeated) and np.array_equal(actual, after_cancel)
        result = dict(text=fixture['text'], speakerKey=fixture['speakerKey'], referenceFrames=len(reference),
                      generatedFrames=len(generated), attentionFrames=attention_frames,
                      referencePrepareSeconds=prepare_seconds, repeatedIdentical=True, afterCancelIdentical=True)
        for name, wave in [('before', original), ('whole', expected), ('after', actual), ('irregular', irregular)]:
            result[name] = dict(pitch=pitch(wave), pcmSha256=hashlib.sha256(wave.tobytes()).hexdigest())
            if name not in ('before', 'whole'):
                result[name].update(correlation=float(np.corrcoef(wave, expected)[0, 1]),
                                   rmsError=float(np.sqrt(np.mean((wave-expected)**2))))
                assert result[name]['correlation'] > .999 and result[name]['rmsError'] < .002
                assert result[name]['pitch']['below140Ms'] == 0
            sf.write(folder/(name+'.wav'), wave, 24000, subtype='FLOAT')
        assert result['before']['pitch']['below140Ms'] > 0
        folder.joinpath('decoder.json').write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
        print(json.dumps({key: value if key not in ('before', 'whole', 'after', 'irregular') else
                         {**value, 'pitch': {k: v for k, v in value['pitch'].items() if k != 'f0Hz'}}
                         for key, value in result.items()}, ensure_ascii=False), flush=True)


if __name__ == '__main__':
    main()
