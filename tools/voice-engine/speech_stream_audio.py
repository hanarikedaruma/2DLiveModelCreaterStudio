# SPDX-License-Identifier: GPL-3.0-or-later
"""Stateful 24kHz -> 48kHz processing, with fades only at utterance ends."""
import numpy as np
from scipy.signal import firwin,lfilter
from audio_processing import ToneProcessor,PeakGuard
from filter_chain import FilterChain

class SpeechStreamProcessor:
    def __init__(self,profile,apply_filters):
        self.coefficients=(2*firwin(41,.5,window=('kaiser',5.))).astype(np.float64)
        self.filter_state=np.zeros(40)
        self.skip=20;self.input_frames=0;self.output_frames=0
        self.tone=ToneProcessor(profile.get('voiceTone')) if apply_filters else None
        self.filters=FilterChain(profile.get('outputFilters')) if apply_filters else None
        self.guard=PeakGuard();self.gain=10**(profile.get('outputGainDb',-3)/20)
        self.tail=np.empty(0,np.float32);self.position=0;self.finished=False
    def _resample(self,audio):
        filtered,self.filter_state=lfilter(self.coefficients,[1.],audio,zi=self.filter_state)
        n=min(self.skip,len(filtered));self.skip-=n
        return filtered[n:].astype(np.float32)
    def _process(self,audio):
        if len(audio)==0:return np.empty(0,np.float32)
        if self.tone:audio=self.filters.process(self.tone.process(audio))
        audio=self.guard.process(audio*self.gain)
        ramp=np.minimum((self.position+np.arange(len(audio)))/239,1).astype(np.float32)
        audio=audio*ramp;self.position+=len(audio)
        joined=np.concatenate((self.tail,audio))
        n=max(0,len(joined)-240)
        self.tail=joined[n:].copy()
        self.output_frames+=n
        return joined[:n]
    def feed(self,audio,rate=24000):
        audio=np.asarray(audio,dtype=np.float32)
        if self.finished or rate!=24000 or audio.ndim!=1 or not np.isfinite(audio).all():raise ValueError('逐次音声が不正です')
        self.input_frames+=len(audio)
        up=np.zeros(len(audio)*2,np.float32);up[::2]=audio
        return self._process(self._resample(up))
    def finish(self):
        if self.finished:raise ValueError('音声の終端は一度だけ処理します')
        self.finished=True
        out=self._process(self._resample(np.zeros(20,np.float32)))
        self.tail*=np.linspace(1,0,len(self.tail),dtype=np.float32)
        self.output_frames+=len(self.tail)
        out=np.concatenate((out,self.tail));self.tail=np.empty(0,np.float32)
        return out
