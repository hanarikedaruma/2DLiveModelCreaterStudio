"""Compare original and integrated AI workers on the same public/synthetic PCM.

No microphone is opened and no sound is played. The original app stays untouched.
This is a STRICT independent-waveform diagnostic, not a perceptual quality test.
Tiny also varies between two original worker restarts; a failed waveform threshold
alone does not establish an integration regression. See the recorded A/A control
and fixed-model-output signal-path comparison in docs/evidence/voice-parity-2026-10-15.
"""
import argparse
import ast
import copy
import hashlib
import json
from math import gcd
from pathlib import Path
import time

import numpy as np
import soundfile as sf
from scipy.signal import resample_poly
from host import Host, QUALITY
from live import WorkerClient

ROOT = Path(__file__).resolve().parent


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def class_tree(path, name):
    tree = ast.parse(Path(path).read_text(encoding="utf-8"))
    node = next(n for n in tree.body if isinstance(n, ast.ClassDef) and n.name == name)
    return ast.dump(node, include_attributes=False)


def render(worker, profile, source, directory, initialization_seed=None):
    script = worker
    if initialization_seed is not None:
        script = directory / (worker.parent.name + "-controlled.py")
        script.write_text(
            "import random, sys, runpy\nimport numpy as np\nimport torch\n"
            f"random.seed({initialization_seed})\nnp.random.seed({initialization_seed})\ntorch.manual_seed({initialization_seed})\n"
            f"sys.path.insert(0, {str(worker.parent)!r})\nrunpy.run_path({str(worker)!r}, run_name='__main__')\n",
            encoding="utf-8")
    client = WorkerClient(profile, directory / (worker.parent.name + ".log"), worker_script=script)
    try:
        ready = client.ready()
        hop, future = ready["hopFrames"], ready["lookaheadFrames"]
        padded = np.pad(source, (0, hop + future))
        output, processing = [], []
        for pos in range(0, len(source), hop):
            begin = 0 if pos == 0 else pos + future
            count = hop + future if pos == 0 else hop
            pcm, metrics = client.convert(padded[begin:begin + count])
            output.append(pcm)
            processing.append(metrics["processingMs"])
        result = np.concatenate(output)[:len(source)]
        sf.write(directory / (worker.parent.name + ".wav"), result, 48000, subtype="FLOAT")
        return result, {key: ready[key] for key in ("hopFrames", "lookaheadFrames", "minimumCaptureFrames", "jitterSeconds")}, max(processing)
    finally:
        client.close()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model-root", required=True)
    parser.add_argument("--source", required=True)
    parser.add_argument("--seconds", type=float, default=6)
    parser.add_argument("--qualities", default="fast,balanced,stable,hq,hqQuality")
    parser.add_argument("--report", required=True)
    parser.add_argument("--initialization-seed", type=int)
    args = parser.parse_args()
    if not 1 <= args.seconds <= 30:
        raise ValueError("seconds must be 1..30")
    original = Path(args.model_root).resolve() / "quality_voice"
    report = Path(args.report).resolve()
    report.parent.mkdir(parents=True, exist_ok=True)
    manifest = json.loads((ROOT / "upstream.json").read_text())
    result = {"passed": False, "sourceSeconds": args.seconds, "initializationSeedForComparisonOnly": args.initialization_seed, "checks": {}, "comparisons": []}
    for file, name in (("backend.py", "SeedModel"), ("worker.py", "Composer")):
        result["checks"][name] = class_tree(original / file, name) == class_tree(ROOT / file, name)
    for name in ("audio_processing.py", "filter_chain.py"):
        result["checks"][name] = digest(original / name) == digest(ROOT / name)
    for entry in manifest["files"]:
        result["checks"][entry["path"]] = digest(Path(args.model_root) / entry["path"]) == entry["sha256"]
    if not all(result["checks"].values()):
        raise ValueError("Original source or AI processing differs from the recorded source")
    source, rate = sf.read(args.source, dtype="float32", always_2d=True)
    source = source.mean(axis=1)[:round(rate * args.seconds)]
    factor = gcd(rate, 48000)
    source = resample_poly(source, 48000 // factor, rate // factor).astype(np.float32)
    if not len(source) or not np.isfinite(source).all() or np.max(np.abs(source)) < .001:
        raise ValueError("A non-silent finite test source is required")
    host = Host.__new__(Host)
    host.model_root = Path(args.model_root).resolve()
    host.data = report.parent / "profiles"
    host.data.mkdir(exist_ok=True)
    try:
        for choice in args.qualities.split(","):
            quality = "hq" if choice == "hqQuality" else choice
            if quality not in QUALITY:
                raise ValueError("Unknown quality")
            name = "Original Soft Girl HQ.json" if quality == "hq" else "Original Soft Girl Realtime.json"
            baseline_path = original / "profiles" / name
            baseline = json.loads(baseline_path.read_text(encoding="utf-8-sig"))
            baseline.setdefault("seed", 1729)
            baseline.update(manifest["qualityPresets"][quality])
            if choice == "hqQuality":
                baseline["steps"] = 30
            for key in ("sourceRepo", "cacheDirectory", "reference"):
                baseline[key] = str((baseline_path.parent / baseline[key]).resolve())
            for key in ("noiseLibrary", "vadModel"):
                baseline["inputCleanup"][key] = str((baseline_path.parent / baseline["inputCleanup"][key]).resolve())
            directory = report.parent / choice
            directory.mkdir(exist_ok=True)
            original_profile = directory / "original-profile.json"
            original_profile.write_text(json.dumps(baseline), encoding="utf-8")
            profile = dict(name=baseline["name"], backend=baseline["backend"], quality=quality, reference="builtin",
                           outputGainDb=baseline["outputGainDb"], voiceTone=baseline["voiceTone"],
                           inputCleanup={key: baseline["inputCleanup"][key] for key in ("noiseReduction", "speechOnly", "speechSensitivity")},
                           outputFilters=copy.deepcopy(baseline["outputFilters"]))
            if choice == "hqQuality":
                profile["advanced"] = {"steps": 30}
            integrated_path = host.normalize(profile)
            integrated = json.loads(integrated_path.read_text())
            keys = [*manifest["qualityPresets"][quality], "seed", "outputGainDb", "voiceTone", "outputFilters"]
            if any(baseline.get(key) != integrated.get(key) for key in keys):
                raise ValueError("Preset differs: " + choice)
            for key in ("reference",):
                if digest(baseline[key]) != digest(integrated[key]):
                    raise ValueError("Reference differs")
            for key in ("noiseLibrary", "vadModel"):
                if digest(baseline["inputCleanup"][key]) != digest(integrated["inputCleanup"][key]):
                    raise ValueError("Cleanup asset differs")
            print("Comparing " + choice, flush=True)
            old, old_ready, old_max = render(original / "worker.py", original_profile, source, directory, args.initialization_seed)
            new, new_ready, new_max = render(ROOT / "worker.py", integrated_path, source, directory, args.initialization_seed)
            delta = new.astype(np.float64) - old
            rms = float(np.sqrt(np.mean(delta ** 2)))
            peak = float(np.max(np.abs(delta)))
            entry = dict(quality=choice, samples=len(old), originalReady=old_ready, integratedReady=new_ready,
                         bitIdentical=bool(np.array_equal(old, new)), differenceRms=rms, differencePeak=peak,
                         originalMaxProcessingMs=old_max, integratedMaxProcessingMs=new_max,
                         outputPeak=float(np.max(np.abs(new))))
            entry["passed"] = old_ready == new_ready and rms <= 1e-5 and peak <= 1e-3 and entry["outputPeak"] > .001
            result["comparisons"].append(entry)
            report.write_text(json.dumps(result, indent=2), encoding="utf-8")
            print(json.dumps(entry), flush=True)
        result["passed"] = all(entry["passed"] for entry in result["comparisons"])
    except Exception as error:
        result["error"] = str(error)
        raise
    finally:
        report.write_text(json.dumps(result, indent=2), encoding="utf-8")
    if not result["passed"]:
        raise RuntimeError("Strict independent-waveform comparison failed; compare the original/original control before interpreting Tiny differences")


if __name__ == "__main__":
    main()
