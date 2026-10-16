"""Compare every Tiny estimator replay to the original on identical inputs.

No audio devices are opened. Public/synthetic input is supplied explicitly.
Verification runs both paths and therefore is not a performance benchmark.
"""
import argparse
import gc
import json
from math import gcd
from pathlib import Path

import numpy as np
import soundfile as sf
from scipy.signal import resample_poly

from backend import create_model, read_profile
from execution_lock import ExecutionLock
from host import Host
from realtime_graph import enable_realtime_graph
from worker import Composer


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model-root", required=True)
    parser.add_argument("--source", required=True)
    parser.add_argument("--seconds", type=float, default=3)
    parser.add_argument("--report", required=True)
    args = parser.parse_args()
    if not 1 <= args.seconds <= 30:
        raise ValueError("seconds must be 1..30")
    report = Path(args.report).resolve()
    report.parent.mkdir(parents=True, exist_ok=True)
    host = Host.__new__(Host)
    host.data = report.parent / "graph-profiles"
    host.data.mkdir(exist_ok=True)
    host.model_root = Path(args.model_root).resolve()
    baseline = json.loads((Path(__file__).parent / "profiles/Original Soft Girl Realtime.json").read_text())
    audio, rate = sf.read(args.source, dtype="float32", always_2d=True)
    factor = gcd(rate, 48000)
    audio = resample_poly(audio.mean(axis=1)[:round(rate * args.seconds)], 48000 // factor, rate // factor).astype(np.float32)
    if not len(audio) or not np.isfinite(audio).all() or np.max(np.abs(audio)) < .001:
        raise ValueError("A finite non-silent source is required")
    results = []
    with ExecutionLock(r"Local\VoiceChanger-HQ-GPU-v1"):
        for quality in ("fast", "balanced", "stable"):
            profile = dict(name="GPU replay validation", backend="seed-xlsr-tiny", quality=quality, reference="builtin",
                           outputGainDb=baseline["outputGainDb"], voiceTone=baseline["voiceTone"],
                           inputCleanup={key: baseline["inputCleanup"][key] for key in ("noiseReduction", "speechOnly", "speechSensitivity")},
                           outputFilters=baseline["outputFilters"])
            model = create_model(read_profile(host.normalize(profile)))
            adapter = enable_realtime_graph(model, verify_replays=True)
            if adapter is None:
                raise RuntimeError("Graph acceleration was not enabled")
            composer = Composer(model)
            import modules.diffusion_transformer as module
            original_mask = module.sequence_mask
            model.convert(np.zeros(composer.left + composer.hop + composer.future, np.float32))
            peaks = []
            for position in range(0, len(audio), composer.hop):
                begin = 0 if position == 0 else position + composer.future
                count = composer.hop + composer.future if position == 0 else composer.hop
                block = np.zeros(count, np.float32)
                available = audio[begin:begin + count]
                block[:len(available)] = available
                output, _ = composer.push(block)
                if not np.isfinite(output).all():
                    raise RuntimeError("Nonfinite output")
                peaks.append(float(np.max(np.abs(output))))
            if module.sequence_mask is not original_mask:
                raise RuntimeError("The original mask function was not restored")
            result = dict(quality=quality, passed=adapter.active and adapter.verified_calls > 0,
                          estimatorReplaysBitIdentical=adapter.verified_calls,
                          cpuThreads=model.torch.get_num_threads(), outputPeak=max(peaks),
                          disabledReason=adapter.disabled_reason)
            results.append(result)
            report.write_text(json.dumps(results, indent=2), encoding="utf-8")
            print(json.dumps(result), flush=True)
            if not result["passed"]:
                raise RuntimeError("Graph replay verification failed")
            torch = model.torch
            del composer, adapter, model
            gc.collect()
            torch.cuda.empty_cache()


if __name__ == "__main__":
    main()
