"""Manual real-CUDA A/B check; no audio device or network is used.

python tests/benchmark_speech_latency.py --cache <model cache> --output <report.json>
"""
import argparse
import hashlib
import json
from pathlib import Path
import statistics
import sys
import threading
import time

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from execution_lock import ExecutionLock
from speech_config import validate_request
from speech_stream_backend import generate_stream
from speech_worker import Generator


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--cache', required=True)
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    with ExecutionLock('Local\\VoiceChanger-HQ-GPU-v1'):
        generator = Generator(args.cache)
        predictor = generator.model.model.talker.code_predictor
        adapter = generator.predictor_graph
        if adapter is None:
            raise RuntimeError('CUDA Graphが無効になっています')
        request = validate_request(dict(schemaVersion=1, text='こんにちは。今日もよろしくね。', preferences=dict(style='gentle')))
        generate_stream(generator, request, lambda *unused: None, threading.Event())
        if not adapter.verified:
            raise RuntimeError('CUDA Graphの準備に失敗しました: ' + adapter.disabled_reason)
        result = dict(text=request['text'], offloadMiB=generator.text_offload_mib, graphVerified=True, runs=[])
        try:
            for mode in ['original', 'graph', 'original', 'graph']:
                predictor.generate = adapter.original if mode == 'original' else adapter
                chunks, times = [], []
                started = time.perf_counter()

                def emit(audio, rate, position):
                    chunks.append(audio.copy())
                    times.append(time.perf_counter() - started)

                metadata = generate_stream(generator, request, emit, threading.Event())
                pcm = generator.np.concatenate(chunks)
                metadata.update(mode=mode, chunkSeconds=times, pcmFloat32Sha256=hashlib.sha256(pcm.tobytes()).hexdigest())
                result['runs'].append(metadata)
                print(json.dumps(metadata, ensure_ascii=False), flush=True)
        finally:
            predictor.generate = adapter
        result['pcmIdentical'] = len({run['pcmFloat32Sha256'] for run in result['runs']}) == 1
        for name, field in [('medianGenerationSeconds', 'generationSeconds'), ('medianFirstPcmSeconds', 'firstPcmSeconds')]:
            result[name] = {mode: statistics.median(run[field] for run in result['runs'] if run['mode'] == mode)
                            for mode in ['original', 'graph']}
        Path(args.output).write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
        if not result['pcmIdentical']:
            raise RuntimeError('最適化前後の生成PCMが一致しません。出力レポートを確認してください')


if __name__ == '__main__':
    main()
