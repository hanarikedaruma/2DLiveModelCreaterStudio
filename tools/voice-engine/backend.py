# SPDX-License-Identifier: GPL-3.0-or-later
"""AI-only backend dispatch and the official Seed-VC inference adapter.

Upstream: Plachtaa/seed-vc, 51383efd921027683c89e5348211d93ff12ac2a8.
Seed-VC uses no ASR text decoding, external pitch shifter, or dry-voice mixture.
The studio integration accepts only the two Seed-VC AI backends.
"""
from __future__ import annotations

import contextlib
import hashlib
import json
import os
from pathlib import Path
import sys
import time
from types import SimpleNamespace

import numpy as np

SEED_BACKEND = "seed-whisper-large"
REALTIME_BACKEND = "seed-xlsr-tiny"
BACKEND_LABELS = {
    REALTIME_BACKEND: "AIリアルタイム（Seed-VC Tiny）",
    SEED_BACKEND: "AIで波形を再構成（Seed-VC）",
}


def create_model(profile, allow_download=False):
    if profile["backend"] in (SEED_BACKEND, REALTIME_BACKEND):
        return SeedModel(profile, allow_download=allow_download)
    raise ValueError("未対応の変換方式です")


def read_profile(path: str | Path, *, check_assets=True) -> dict:
    path = Path(path).resolve()
    if path.stat().st_size > 65536:
        raise ValueError("声設定が大きすぎます")
    p = json.loads(path.read_text(encoding="utf-8-sig"))
    if p.get("schemaVersion") != 1 or p.get("backend") not in BACKEND_LABELS:
        raise ValueError("未対応の声設定または変換方式です")
    if not isinstance(p.get("name"), str) or not 1 <= len(p["name"].strip()) <= 100:
        raise ValueError("声の名前は1〜100文字にしてください")
    gain = p.get("outputGainDb")
    if isinstance(gain, bool) or not isinstance(gain, (int, float)) or not np.isfinite(gain) or not -18 <= gain <= 12:
        raise ValueError("不正な声設定: outputGainDb")
    from audio_processing import validate_tone
    from filter_chain import validate_chain
    p["voiceTone"] = validate_tone(p.get("voiceTone", {}))
    p["outputFilters"] = validate_chain(p.get("outputFilters"))
    cleanup = dict(p.get("inputCleanup", {}))
    for key, lo, hi in (("noiseReduction", 0, 1), ("speechSensitivity", 0, 100)):
        value = cleanup.get(key, 0 if key == "noiseReduction" else 40)
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not np.isfinite(value) or not lo <= value <= hi:
            raise ValueError(f"不正な雑音設定: {key}")
        cleanup[key] = float(value)
    if not isinstance(cleanup.get("speechOnly", False), bool): raise ValueError("不正な雑音設定: speechOnly")
    if cleanup.get("latencyMode","natural") not in ("natural","lowLatency"):raise ValueError("不正な雑音設定: latencyMode")
    for key, enabled in (("noiseLibrary", cleanup["noiseReduction"] > 0), ("vadModel", cleanup.get("speechOnly", False))):
        if enabled:
            if not isinstance(cleanup.get(key), str): raise ValueError(f"雑音モデルが未設定です: {key}")
            cleanup[key] = str((path.parent / cleanup[key]).resolve())
            if check_assets and not Path(cleanup[key]).is_file(): raise ValueError(f"雑音モデルが見つかりません: {key}")
    p["inputCleanup"] = cleanup
    for key in ("sourceRepo", "reference", "cacheDirectory"):
        p[key] = str((path.parent / p[key]).resolve())
    for key, lo, hi in (("steps", 4, 50), ("hopSeconds", .12 if p["backend"]==REALTIME_BACKEND else .16, 3),
                        ("lookaheadSeconds", .04, 1), ("historySeconds", 0, 4),
                        ("referenceSeconds", 1, 12), ("outputGainDb", -18, 12)):
        value = p.get(key)
        if not isinstance(value, (float, int)) or not np.isfinite(value) or not lo <= value <= hi:
            raise ValueError(f"不正な声設定: {key}")
    cfg=p.get("cfgRate",.7)
    if not isinstance(cfg,(int,float)) or not np.isfinite(cfg) or not 0<=cfg<=2:
        raise ValueError("不正な声設定: cfgRate")
    if p["hopSeconds"] + p["lookaheadSeconds"] + p["historySeconds"] > 8:
        raise ValueError("変換窓が長すぎます")
    if check_assets and not Path(p["reference"]).is_file():
        raise ValueError("参照音声が見つかりません")
    if check_assets and not (Path(p["sourceRepo"]) / "inference.py").is_file():
        raise ValueError("Seed-VCのソースが見つかりません")
    if p["backend"] == REALTIME_BACKEND:
        value=p.get("generationHistorySeconds",.5)
        if isinstance(value,bool) or not isinstance(value,(int,float)) or not np.isfinite(value) or not .2<=value<=p["historySeconds"]:
            raise ValueError("不正な声設定: generationHistorySeconds")
        p["generationHistorySeconds"]=float(value)
    return p


class SeedModel:
    def __init__(self, profile: dict, allow_download=False):
        self.profile = profile
        cache = Path(profile["cacheDirectory"])
        cache.mkdir(parents=True, exist_ok=True)
        os.environ["HF_HOME"] = str(cache)
        os.environ["HF_HUB_CACHE"] = str(cache / "hub")
        os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"
        if not allow_download:
            os.environ["HF_HUB_OFFLINE"] = "1"
        os.environ["OMP_NUM_THREADS"] = "4"
        import soundfile as sf
        reference=Path(profile["reference"])
        info=sf.info(reference)
        if not 1<=info.duration<=120 or info.channels>2 or info.samplerate>192000 or reference.stat().st_size>256*1024*1024:
            raise ValueError("参照音声は1〜120秒、mono/stereo、192kHz以下、256MB以内にしてください")
        # Upstream inference changes HF_HUB_CACHE before importing the Hub.
        # Freeze our explicit local cache first, including Transformers' default.
        import huggingface_hub.constants
        import transformers.utils.hub
        os.chdir(profile["sourceRepo"])
        sys.path.insert(0, profile["sourceRepo"])
        import torch
        import torchaudio
        # Upstream prints checkpoint information: keep stdout for our IPC protocol.
        with contextlib.redirect_stdout(sys.stderr):
            import inference
            os.environ["HF_HUB_CACHE"] = str(cache / "hub")
            torch.set_num_threads(4)
            if not torch.cuda.is_available():
                raise RuntimeError("CUDA GPUを利用できません。高音質版は対応GPUが必要です")
            self.device = torch.device("cuda")
            inference.device = self.device
            self.realtime=profile["backend"]==REALTIME_BACKEND
            if self.realtime:
                torch.backends.cuda.matmul.allow_tf32=True
                torch.backends.cudnn.benchmark=True
            checkpoint=config=None
            if self.realtime:
                snapshot=Path(profile["sourceRepo"])/"checkpoints"/"models--Plachta--Seed-VC"/"snapshots"/"257283f9f41585055e8f858fba4fd044e5caed6e"
                checkpoint=str(snapshot/"DiT_uvit_tat_xlsr_ema.pth")
                config=str(snapshot/"config_dit_mel_seed_uvit_xlsr_tiny.yml")
            args = SimpleNamespace(fp16=True, f0_condition=False, checkpoint=checkpoint, config=config)
            loaded = inference.load_models(args)
        (self.model, self.semantic, _, self.vocoder, self.speaker,
         self.mel, self.mel_args) = loaded
        if self.realtime:
            import modules.flow_matching
            modules.flow_matching.tqdm=lambda items, **kwargs: items
        self.torch = torch
        self.sr = self.mel_args["sampling_rate"]
        self.hop = self.mel_args["hop_size"]
        self.to_native = torchaudio.transforms.Resample(48000, self.sr).to(self.device)
        self.to_content = torchaudio.transforms.Resample(self.sr, 16000).to(self.device)
        self.to_output = torchaudio.transforms.Resample(self.sr, 48000).to(self.device)
        ref, ref_sr = sf.read(profile["reference"], dtype="float32", always_2d=True)
        if len(ref) / ref_sr < 1 or len(ref) / ref_sr > 120:
            raise ValueError("参照音声は1〜120秒にしてください")
        ref = ref.mean(axis=1)
        if not np.isfinite(ref).all() or np.sqrt(np.mean(ref**2)) < .001:
            raise ValueError("参照音声が無音または不正です")
        ref = ref[:int(ref_sr * profile["referenceSeconds"])]
        with torch.inference_mode(), contextlib.redirect_stdout(sys.stderr):
            r = torch.from_numpy(ref.copy()).unsqueeze(0).to(self.device)
            if ref_sr != self.sr:
                r = torchaudio.functional.resample(r, ref_sr, self.sr)
            r16 = self.to_content(r)
            content = self.semantic(r16)
            self.ref_mel = self.mel(r.float())
            lengths = torch.tensor([self.ref_mel.shape[2]], device=self.device)
            self.ref_condition = self.model.length_regulator(content, ylens=lengths, n_quantizers=3, f0=None)[0]
            features = torchaudio.compliance.kaldi.fbank(r16, num_mel_bins=80, dither=0, sample_frequency=16000)
            self.style = self.speaker((features - features.mean(dim=0, keepdim=True)).unsqueeze(0))
        self.reference_hash = hashlib.sha256(Path(profile["reference"]).read_bytes()).hexdigest()
        self.calls = 0

    def convert(self, audio48: np.ndarray, steps: int | None = None) -> tuple[np.ndarray, dict]:
        t = self.torch
        audio48 = np.asarray(audio48, dtype=np.float32)
        if audio48.ndim != 1 or len(audio48) < 4800 or len(audio48) > 48000 * 25:
            raise ValueError("1区間の変換は0.1〜25秒に対応します")
        if not np.isfinite(audio48).all():
            raise ValueError("入力音声に不正値があります")
        t.cuda.synchronize()
        start = time.perf_counter()
        # Stable seed makes repeated references/conditions reproducible.
        t.manual_seed(int(self.profile.get("seed", 1729)))
        with t.inference_mode(), contextlib.redirect_stdout(sys.stderr):
            x = t.from_numpy(audio48.copy()).unsqueeze(0).to(self.device)
            x = self.to_native(x)
            content = self.semantic(self.to_content(x))
            trim_seconds=max(0.,self.profile["historySeconds"]-self.profile.get("generationHistorySeconds",.5)) if self.realtime else 0.
            trim_samples=round(trim_seconds*48000)
            if trim_seconds:
                content=content[:,round(trim_seconds*50):]
                x=x[:,round(trim_seconds*self.sr):]
            mel = self.mel(x.float())
            lengths = t.tensor([mel.shape[2]], device=self.device)
            condition = self.model.length_regulator(content, ylens=lengths, n_quantizers=3, f0=None)[0]
            combined = t.cat([self.ref_condition, condition], dim=1)
            with t.autocast(device_type="cuda", dtype=t.float16):
                generated = self.model.cfm.inference(
                    combined, t.tensor([combined.shape[1]], device=self.device),
                    self.ref_mel, self.style, None, n_timesteps=steps or int(self.profile["steps"]),
                    inference_cfg_rate=float(self.profile.get("cfgRate", .7)))
            generated = generated[:, :, self.ref_mel.shape[2]:]
            # BigVGAN stays float32; official realtime HiFT uses mixed precision.
            with t.autocast(device_type="cuda", dtype=t.float16, enabled=self.realtime):
                native = self.vocoder(generated.float()).reshape(1, -1)
            result = self.to_output(native.float()).reshape(-1).cpu().numpy()
            if trim_samples: result=np.pad(result,(trim_samples,0))
        t.cuda.synchronize()
        seconds = time.perf_counter() - start
        # Native mel hops round down by <1 hop; retain duration without stretching.
        if len(result) < len(audio48):
            result = np.pad(result, (0, len(audio48) - len(result)))
        result = np.asarray(result[:len(audio48)], dtype=np.float32)
        if not np.isfinite(result).all():
            raise RuntimeError("モデルが不正な出力を生成しました")
        self.calls += 1
        return result, {"processingMs": seconds * 1000, "rtf": seconds / (len(audio48)/48000),
                        "peak": float(np.max(np.abs(result))),
                        "vramMiB": t.cuda.max_memory_allocated()/1048576,
                        "nativeRate": self.sr, "calls": self.calls}
