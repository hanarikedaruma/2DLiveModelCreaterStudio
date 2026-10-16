# SPDX-License-Identifier: GPL-3.0-or-later
"""Stateful CPU input cleanup and gentle output tone controls, outside callbacks."""
from __future__ import annotations
import ctypes
from collections import deque
from pathlib import Path
import numpy as np
from scipy.signal import firwin, lfilter, sosfilt


def default_processing():
    directory = Path(__file__).resolve().parent
    dll = directory / "voice-noise.dll"
    vad = directory / "models" / "silero_vad.onnx"
    if not dll.is_file(): dll = directory.parent / "build" / "Release" / "voice-noise.dll"
    if not vad.is_file(): vad = directory.parent / "external" / "noise-models" / "silero_vad.onnx"
    return {"noiseReduction": .85, "speechOnly": True, "speechSensitivity": 40.,
            "noiseLibrary": str(dll), "vadModel": str(vad)}


class RNNoise:
    # The bundled revision synthesizes delayed_X, in addition to its 10ms
    # analysis/synthesis overlap: measured total delay is two 480-sample frames.
    delay_samples = 960

    def __init__(self, library):
        self.dll = ctypes.CDLL(str(library))
        pointer = ctypes.POINTER(ctypes.c_float)
        self.dll.rnnoise_create.argtypes = [ctypes.c_void_p]
        self.dll.rnnoise_create.restype = ctypes.c_void_p
        self.dll.rnnoise_destroy.argtypes = [ctypes.c_void_p]
        self.dll.rnnoise_process_frame.argtypes = [ctypes.c_void_p, pointer, pointer]
        self.dll.rnnoise_process_frame.restype = ctypes.c_float
        self.state = self.dll.rnnoise_create(None)
        if not self.state: raise RuntimeError("雑音除去モデルを準備できません")

    def frame(self, audio):
        source = np.ascontiguousarray(audio * 32768, dtype=np.float32)
        output = np.empty(480, np.float32)
        pointer = ctypes.POINTER(ctypes.c_float)
        self.dll.rnnoise_process_frame(self.state, output.ctypes.data_as(pointer), source.ctypes.data_as(pointer))
        return output / 32768

    def __del__(self):
        if getattr(self, "state", None):
            self.dll.rnnoise_destroy(self.state)
            self.state = None


class SpeechDetector:
    def __init__(self, model):
        import onnxruntime as ort
        options = ort.SessionOptions()
        options.intra_op_num_threads = options.inter_op_num_threads = 1
        self.session = ort.InferenceSession(str(model), options, providers=["CPUExecutionProvider"])
        self.state = np.zeros((2, 1, 128), np.float32)
        self.context = np.zeros((1, 64), np.float32)
        self.session.run(None, {"input":np.zeros((1,576),np.float32),"state":self.state,"sr":np.array(16000,np.int64)})
        self.filter = firwin(63, 7500, fs=48000).astype(np.float32)
        self.filter_state = np.zeros(62, np.float32)

    def frame(self, audio):
        filtered, self.filter_state = lfilter(self.filter, [1.], audio, zi=self.filter_state)
        samples = filtered[::3].astype(np.float32).reshape(1, 512)
        # Sensitivity to quiet/slow speech must not require making the actual
        # microphone signal louder. This bounded gain is used by VAD only.
        rms = float(np.sqrt(np.mean(samples.astype(np.float64)**2)))
        gain = min(4., max(1., .03/max(rms, 1e-7)))
        samples = samples * gain
        probability, self.state = self.session.run(None, {
            "input": np.concatenate([self.context, samples], axis=1),
            "state": self.state, "sr": np.array(16000, dtype=np.int64)})
        self.context = samples[:, -64:].copy()
        return float(probability.item())


class PeakGuard:
    """Attenuation only, instantaneous peak catch and a 120ms gain release.

    Gain persists across packets so a loud onset does not repeatedly flatten
    every waveform peak. No normalization, makeup gain, or extra buffering.
    """
    def __init__(self, ceiling=.89125094, release_seconds=.12):
        self.ceiling = float(ceiling)
        self.release_samples = 48000*release_seconds
        self.gain = 1.
        self.reduction_db = 0.

    def process(self, audio):
        source = np.asarray(audio, dtype=np.float32)
        if not len(source):
            return source.copy()
        if not np.isfinite(source).all():
            raise ValueError("音声に不正な値があります")
        magnitude = np.abs(source.astype(np.float64))
        target = np.minimum(1., self.ceiling/np.maximum(magnitude, 1e-12))
        # deficit[n] = max(1-target[n], deficit[n-1]*release). Vectorizing
        # in bounded segments avoids a Python sample loop and exp overflow.
        result = np.empty_like(source)
        minimum_gain = 1.
        for begin in range(0, len(source), 48000):
            end = min(begin+48000, len(source))
            weights = np.exp(np.arange(1, end-begin+1)/self.release_samples)
            deficit = np.maximum.accumulate(np.maximum((1-target[begin:end])*weights, 1-self.gain))/weights
            gains = np.clip(1-deficit, 0., 1.)
            result[begin:end] = source[begin:end]*gains
            self.gain = float(gains[-1])
            minimum_gain = min(minimum_gain, float(np.min(gains)))
        self.reduction_db = -20*np.log10(max(minimum_gain, 1e-12))
        # Rounding protection only; overload attenuation is carried by gain.
        np.clip(result, -self.ceiling, self.ceiling, out=result)
        return result


class InputCleaner:
    """Push each newly captured sample once; read overlapping windows by source time.

    RNNoise output belongs to the frame captured 20ms earlier. Drop both startup
    frames, retain matching dry PCM for strength mixing, and provide future context
    for VAD confirmation and onset padding. Buffers/runs are pruned after commits.
    """
    def __init__(self, config):
        self.strength = float(config.get("noiseReduction", 0))
        self.gate = config.get("speechOnly", False)
        self.enabled = bool(self.strength or self.gate)
        self.low_latency=config.get("latencyMode")=="lowLatency"
        self.lookahead = (6144 if self.low_latency else 12288) if self.gate else (RNNoise.delay_samples if self.strength else 0)
        self.rn = RNNoise(config["noiseLibrary"]) if self.strength else None
        self.detector = SpeechDetector(config["vadModel"]) if self.gate else None
        self.threshold = .75 - .005 * float(config.get("speechSensitivity", 40))
        self.raw_pending = np.zeros(0, np.float32)
        self.dry_frames = deque()
        self.buffer = np.zeros(0, np.float32)
        self.base = self.end = self.vad_cursor = 0
        self.runs = []
        self.high_count = 0
        self.last_voice_end = None
        self.probability = 0.

    def push(self, audio):
        audio = np.asarray(audio, dtype=np.float32)
        if not np.isfinite(audio).all(): raise ValueError("マイク入力が不正です")
        if self.rn:
            self.raw_pending = np.concatenate([self.raw_pending, audio])
            blocks = []
            count = len(self.raw_pending)//480
            for offset in range(count):
                frame = self.raw_pending[offset*480:(offset+1)*480]
                clean = self.rn.frame(frame)
                self.dry_frames.append(frame.copy())
                if len(self.dry_frames) > RNNoise.delay_samples//480:
                    dry = self.dry_frames.popleft()
                    blocks.append(self.strength*clean + (1-self.strength)*dry)
            self.raw_pending = self.raw_pending[count*480:].copy()
            clean = np.concatenate(blocks) if blocks else np.zeros(0, np.float32)
        else: clean = audio.copy()
        self.buffer = np.concatenate([self.buffer, clean])
        self.end += len(clean)
        if self.detector:
            while self.vad_cursor+1536 <= self.end:
                begin = self.vad_cursor
                p = self.detector.frame(self.slice(begin, begin+1536))
                self.probability = p
                self.high_count = self.high_count+1 if p >= self.threshold else 0
                active = self.last_voice_end is not None and begin < self.last_voice_end+11520
                if self.high_count >= 2 or (self.low_latency and p >= .9) or (active and p >= max(.2, self.threshold-.15)):
                    if not active:
                        onset = max(0, begin-1536-5760)
                        if self.runs and onset <= self.runs[-1][1]: self.runs[-1][1] = begin+1536+11520
                        else: self.runs.append([onset, begin+1536+11520])
                    else: self.runs[-1][1] = begin+1536+11520
                    self.last_voice_end = begin+1536
                self.vad_cursor += 1536

    def slice(self, begin, end):
        result = np.zeros(end-begin, np.float32)
        left, right = max(begin, self.base, 0), min(end, self.end)
        if right > left: result[left-begin:right-begin] = self.buffer[left-self.base:right-self.base]
        return result

    def mask(self, begin, count):
        if not self.gate: return np.ones(count, np.float32)
        mask = np.zeros(count, np.float32)
        fade = 768
        for start, end in self.runs:
            left, right = max(begin, start), min(begin+count, end)
            if right <= left: continue
            samples = np.arange(left, right)
            level = np.minimum(np.clip((samples-start)/fade, 0, 1), np.clip((end-samples)/fade, 0, 1))
            mask[left-begin:right-begin] = np.maximum(mask[left-begin:right-begin], level)
        return mask

    def discard(self, before):
        before = max(self.base, min(before, self.vad_cursor if self.gate else self.end))
        self.buffer = self.buffer[before-self.base:].copy()
        self.base = before
        self.runs = [run for run in self.runs if run[1] > before]


TONE_LIMITS = {"brightnessDb": (-4., 4.), "bodyDb": (-3., 3.), "softnessDb": (0., 6.)}

def validate_tone(values):
    if not isinstance(values, dict) or set(values)-set(TONE_LIMITS): raise ValueError("不正な声質調整です")
    result = {}
    for key, (lo, hi) in TONE_LIMITS.items():
        value = values.get(key, 0.)
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not np.isfinite(value) or not lo <= value <= hi:
            raise ValueError(f"不正な声質調整: {key}")
        result[key] = float(value)
    return result


def shelf(frequency, gain, high):
    a = 10**(gain/40); w = 2*np.pi*frequency/48000
    c = np.cos(w); s = np.sin(w); beta = s*np.sqrt(2*a)
    if high:
        b = [a*((a+1)+(a-1)*c+beta), -2*a*((a-1)+(a+1)*c), a*((a+1)+(a-1)*c-beta)]
        d = [(a+1)-(a-1)*c+beta, 2*((a-1)-(a+1)*c), (a+1)-(a-1)*c-beta]
    else:
        b = [a*((a+1)-(a-1)*c+beta), 2*a*((a-1)-(a+1)*c), a*((a+1)-(a-1)*c-beta)]
        d = [(a+1)+(a-1)*c+beta, -2*((a-1)+(a+1)*c), (a+1)+(a-1)*c-beta]
    return np.array(b+d)/d[0]


class ToneProcessor:
    def __init__(self, values=None):
        self.values = validate_tone(values or {})
        self.state = np.zeros((3, 2))
        self.sos = self.coefficients(self.values)
        self.headroom = 10**(-max(0., self.values["brightnessDb"], self.values["bodyDb"])/20)

    @staticmethod
    def coefficients(v):
        return np.array([shelf(2200, v["brightnessDb"], True), shelf(300, v["bodyDb"], False), shelf(6500, -v["softnessDb"], True)])

    def update(self, values):
        self.values = validate_tone(values)

    def process(self, audio):
        updated = self.coefficients(self.values)
        old, old_state = sosfilt(self.sos, audio, zi=self.state)
        if not np.array_equal(updated, self.sos):
            new, state = sosfilt(updated, audio, zi=self.state)
            fade = np.minimum(np.arange(len(audio))/max(1, min(1440, len(audio)-1)), 1.)
            output = old*(1-fade)+new*fade
            self.state = state; self.sos = updated
        else: output = old; self.state = old_state
        # Reserve headroom for positive shelves instead of relying on clipping.
        target = 10**(-max(0., self.values["brightnessDb"], self.values["bodyDb"])/20)
        ramp = np.minimum(np.arange(len(audio))/max(1, min(1440, len(audio)-1)), 1.)
        output *= self.headroom*(1-ramp)+target*ramp
        self.headroom = target
        return output.astype(np.float32)
