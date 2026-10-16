# SPDX-License-Identifier: GPL-3.0-or-later
"""Offline conversion and bounded streaming worker. PCM never leaves this PC."""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import struct
import sys
import time

import numpy as np
from backend import create_model, read_profile, REALTIME_BACKEND
from audio_processing import InputCleaner, ToneProcessor, PeakGuard
from filter_chain import FilterChain


class Composer:
    def __init__(self, model):
        self.model = model
        p = model.profile
        self.hop = round(p["hopSeconds"] * 48000)
        self.cleaner = InputCleaner(p.get("inputCleanup", {}))
        self.tone = ToneProcessor(p.get("voiceTone"))
        self.filters = FilterChain(p.get("outputFilters"))
        self.peak_guard = PeakGuard()
        self.future = max(round(p["lookaheadSeconds"] * 48000), self.cleaner.lookahead)
        self.left = round(p["historySeconds"] * 48000)
        self.overlap = min(1920, self.future // 2)
        self.history = np.zeros(self.left, np.float32)
        self.pending = np.zeros(0, np.float32)
        self.tail = None
        self.cursor = 0
        self.fade = np.sin(np.linspace(0, np.pi/2, self.overlap, dtype=np.float32)) ** 2

    def push(self, audio):
        started = time.perf_counter()
        expected = self.hop + self.future if self.cursor == 0 else self.hop
        if len(audio) != expected:
            raise ValueError(f"音声区間の長さ不一致: {len(audio)} != {expected}")
        self.cleaner.push(audio)
        window = self.cleaner.slice(self.cursor-self.left, self.cursor+self.hop+self.future)
        mask = self.cleaner.mask(self.cursor, self.hop)
        window *= self.cleaner.mask(self.cursor-self.left, len(window))
        empty = bool(not np.any(mask) or np.sqrt(np.mean(window**2)) < 2e-5)
        # Keep the tiny realtime GPU path warm through silence. After long idle,
        # its first voiced inference can miss a subsecond playback deadline.
        # The final speech mask still guarantees exact silence for nonspeech.
        skipped = empty and self.model.profile.get("backend") != REALTIME_BACKEND
        if skipped:
            generated = np.zeros(len(window), np.float32)
            metrics = {"processingMs": 0., "vramMiB": 0.}
        else: generated, metrics = self.model.convert(window)
        start = self.left
        # Compare regenerated common audio, bounded to +/- 5ms. Skip silence.
        if self.tail is not None and np.mean(self.tail**2) > 1e-7 and start >= 240:
            from scipy.signal import correlate
            search = generated[start-240:start+self.overlap+240]
            numerator = correlate(search, self.tail, mode="valid", method="direct")
            energy = np.convolve(search**2, np.ones(self.overlap), mode="valid")
            score = numerator / np.sqrt(np.maximum(energy * np.sum(self.tail**2), 1e-12))
            if score.max() > .25:
                start += int(score.argmax()) - 240
        output = generated[start:start+self.hop].copy()
        if len(output) != self.hop:
            raise RuntimeError("変換音声の長さが不足しています")
        if self.tail is not None:
            output[:self.overlap] = self.tail * (1-self.fade) + output[:self.overlap] * self.fade
        self.tail = generated[start+self.hop:start+self.hop+self.overlap].copy()
        if len(self.tail) != self.overlap:
            raise RuntimeError("境界の先読み音声が不足しています")
        output = self.filters.process(self.tone.process(output)) * mask
        self.tail *= self.cleaner.mask(self.cursor+self.hop, self.overlap)
        output *= 10 ** (self.model.profile["outputGainDb"] / 20)
        limited = int(np.count_nonzero(np.abs(output) > .89125094))
        output = self.peak_guard.process(output)
        metrics["processingMs"] = (time.perf_counter()-started)*1000
        metrics.update(sourceStartSample=self.cursor, frames=self.hop,
            speechProbability=self.cleaner.probability, speechFraction=float(np.mean(mask)), inferenceSkipped=skipped,
            streamRtf=metrics["processingMs"] / (self.hop/48), limitedSamples=limited,
            outputGainReductionDb=self.peak_guard.reduction_db)
        self.cursor += self.hop
        self.cleaner.discard(max(0, self.cursor-self.left-12288))
        return output, metrics


def create_composer(model):
    return Composer(model)


def read_exact(stream, count):
    parts = bytearray()
    while len(parts) < count:
        part = stream.read(count - len(parts))
        if not part:
            raise EOFError("推論プロセスへの音声が途中で終了しました")
        parts.extend(part)
    return bytes(parts)


def emit(meta, audio=None):
    data = sys.stdout.buffer
    packet = (json.dumps(meta, ensure_ascii=False) + "\n").encode("utf-8")
    if audio is not None:
        packet += np.asarray(audio, dtype="<f4").tobytes()
    view = memoryview(packet)
    # -u uses raw FileIO. A single pipe write need not consume the full PCM.
    while view:
        written = data.write(view)
        if not written: raise BrokenPipeError("推論音声の送信が終了しました")
        view = view[written:]
    data.flush()


def apply_control(composer, value):
    if not isinstance(value, dict): raise ValueError("調整データが不正です")
    if "filters" in value:
        if set(value) != {"filters"}: raise ValueError("未対応の調整データです")
        composer.filters.update(value["filters"])
    else:
        # Retain compatibility with the existing flat tone messages.
        composer.tone.update(value)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--profile", required=True)
    parser.add_argument("--download", action="store_true")
    parser.add_argument("--prefetch", action="store_true")
    parser.add_argument("--stream", action="store_true")
    parser.add_argument("--source")
    parser.add_argument("--output")
    parser.add_argument("--simulate", action="store_true")
    args = parser.parse_args()
    # Model loader uses the upstream repository as its working directory.
    # Resolve caller paths before that change, including overwrite protection.
    args.profile=str(Path(args.profile).resolve())
    if args.source:args.source=str(Path(args.source).resolve())
    if args.output:args.output=str(Path(args.output).resolve())
    profile = read_profile(args.profile)
    if args.source: print("WAV: loading AI model", file=sys.stderr, flush=True)
    start = time.perf_counter()
    model = create_model(profile, allow_download=args.download)
    if args.source: print("WAV: model ready", file=sys.stderr, flush=True)
    if args.prefetch:
        emit({"ready":True, "nativeRate":model.sr, "loadSeconds":time.perf_counter()-start,
              "referenceHash":model.reference_hash})
        return
    if args.stream:
        from realtime_graph import enable_realtime_graph
        acceleration = enable_realtime_graph(model)
        composer = create_composer(model)
        # Warm kernels before starting the microphone.
        model.convert(np.zeros(composer.left+composer.hop+composer.future, np.float32))
        emit({"ready":True,"hopFrames":composer.hop,"lookaheadFrames":composer.future,
              "loadSeconds":time.perf_counter()-start,"nativeRate":model.sr,
              "backend":profile["backend"], "textDecoded":False,
              "cudaGraph":bool(acceleration and acceleration.active),
              "minimumCaptureFrames":2*composer.hop+composer.future+(1920 if profile["backend"]==REALTIME_BACKEND else 0),
              "jitterSeconds":.04 if profile["backend"]==REALTIME_BACKEND else 1.0})
        sequence = 0
        while True:
            header = read_exact(sys.stdin.buffer, 8)
            seq, count = struct.unpack("<II", header)
            if seq == 0xffffffff:
                if not 1 <= count <= 8192: raise ValueError("調整データのサイズが不正です")
                apply_control(composer, json.loads(read_exact(sys.stdin.buffer, count).decode("utf-8")))
                emit({"control": True})
                continue
            if count == 0:
                return
            if seq != sequence or count > 48000*4:
                raise ValueError("音声の順序またはサイズが不正です")
            audio = np.frombuffer(read_exact(sys.stdin.buffer, count*4), dtype="<f4").copy()
            output, metrics = composer.push(audio)
            emit({"sequence":sequence, **metrics}, output)
            sequence += 1
    elif args.source and args.output:
        import soundfile as sf
        from scipy.signal import resample_poly
        from math import gcd
        source = Path(args.source).resolve()
        output = Path(args.output).resolve()
        protected = [source, Path(args.profile).resolve()]
        if profile.get("reference"): protected.append(Path(profile["reference"]))
        if output in protected:
            raise ValueError("入力・声設定・参照音声を上書きできません")
        info=sf.info(source)
        if info.duration>600 or info.channels>2 or info.samplerate>192000 or source.stat().st_size>256*1024*1024:
            raise ValueError("入力WAVは10分・256MB以内、mono/stereo、192kHz以下にしてください")
        x, rate = sf.read(source, dtype="float32", always_2d=True)
        x = x.mean(axis=1)
        if not len(x) or not np.isfinite(x).all():
            raise ValueError("入力WAVが空または不正です")
        if rate != 48000:
            g = gcd(rate, 48000)
            x = resample_poly(x,48000//g,rate//g).astype(np.float32)
        results, stats = [], []
        # Use the live pipeline for WAV too, including stateful cleanup and gating.
        composed = True
        if composed:
            composer = create_composer(model)
            padded = np.pad(x,(0,composer.hop+composer.future))
            first, pos = True, 0
            while pos < len(x):
                count = composer.hop + composer.future if first else composer.hop
                input_start = 0 if first else pos + composer.future
                y, metrics = composer.push(padded[input_start:input_start+count])
                results.append(y); stats.append(metrics)
                first=False; pos += composer.hop
                if len(stats)==1 or len(stats)%25==0:
                    print(f"WAV: {min(pos,len(x))}/{len(x)} samples",file=sys.stderr,flush=True)
        else:
            # Long files use bounded blocks; every block contains past/future context.
            previous_tail=None
            overlap=1920
            fade=np.sin(np.linspace(0,np.pi/2,overlap,dtype=np.float32))**2
            for pos in range(0,len(x),48000*20):
                core=min(48000*20,len(x)-pos)
                left=min(48000,pos)
                right=min(48000,len(x)-pos-core)
                y, metrics=model.convert(x[pos-left:pos+core+right])
                committed=y[left:left+core].copy()
                if previous_tail is not None and len(committed)>=overlap:
                    committed[:overlap]=previous_tail*(1-fade)+committed[:overlap]*fade
                previous_tail=y[left+core:left+core+overlap].copy() if right>=overlap else None
                results.append(committed);stats.append(metrics)
        y=np.concatenate(results)[:len(x)]
        if not composed:
            y *= 10 ** (profile["outputGainDb"]/20)
            np.clip(y,-.89125094,.89125094,out=y)
        output.parent.mkdir(parents=True,exist_ok=True)
        sf.write(output,y,48000,subtype="PCM_24")
        report={"source":str(source),"output":str(output),"frames":len(y),
            "backend":profile["backend"], "textDecoded":False,
            "reference":profile.get("reference"),"referenceHash":model.reference_hash,
            "profile":profile,"simulate":args.simulate,"blocks":stats}
        output.with_suffix(".metrics.json").write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding="utf-8")
        emit({"output":str(output),"seconds":len(y)/48000,"blocks":stats})
    else:
        raise ValueError("--stream または --source / --output を指定してください")

if __name__ == "__main__":
    try:
        from execution_lock import ExecutionLock
        with ExecutionLock("Local\\VoiceChanger-HQ-GPU-v1"):
            main()
    except Exception as error:
        import traceback
        traceback.print_exc(file=sys.stderr)
        emit({"error":str(error)})
        sys.exit(1)
