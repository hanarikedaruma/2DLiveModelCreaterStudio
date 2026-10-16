# SPDX-License-Identifier: GPL-3.0-or-later
"""Bounded mono WSOLA: slower timing without resampling the speaker's pitch.

Decisions use fixed source windows, independent of incoming packet boundaries.
Only an overlap and the next search window are retained during streaming.
"""
import numpy as np

SHY_TEMPO=.88

class SpeechTempo:
    def __init__(self,ratio=SHY_TEMPO,rate=24000):
        if rate!=24000 or not .75<=ratio<=1.:raise ValueError('発話テンポが不正です')
        self.ratio=ratio;self.hop=480;self.window=960;self.search=144
        self.buffer=np.empty(0,np.float32);self.base=0;self.received=0
        self.index=0;self.written=0;self.tail=None;self.ended=False
        self.fade=np.sin(np.linspace(0,np.pi/2,self.hop))**2

    def feed(self,audio):
        if self.ended:raise RuntimeError('終了したテンポ処理です')
        audio=np.asarray(audio,dtype=np.float32)
        if audio.ndim!=1 or not np.isfinite(audio).all():raise ValueError('テンポ音声の形式が不正です')
        self.received+=len(audio);self.buffer=np.r_[self.buffer,audio]
        return self._drain()

    def _drain(self,target=None):
        output=[]
        while target is None or self.written<target:
            if self.tail is None:
                if len(self.buffer)<self.window:break
                frame=self.buffer[:self.window].copy();piece=frame[:self.hop]
            else:
                center=round(self.index*self.hop*self.ratio)
                lo=max(0,center-self.search);hi=center+self.search
                if hi+self.window>self.base+len(self.buffer):break
                segment=self.buffer[lo-self.base:hi-self.base+self.hop].astype(np.float64)
                reference=self.tail.astype(np.float64)
                dots=np.correlate(segment,reference,'valid')
                squared=np.r_[0.,np.cumsum(segment*segment)]
                energy=squared[self.hop:]-squared[:-self.hop]
                score=dots/np.sqrt(np.maximum(energy*np.dot(reference,reference),1e-20))
                positions=np.arange(lo,hi+1)
                score-=.005*np.abs(positions-center)/self.search
                position=int(positions[int(np.argmax(score))])
                frame=self.buffer[position-self.base:position-self.base+self.window].copy()
                coherence=float(np.clip(np.dot(reference,frame[:self.hop])/
                    max(np.linalg.norm(reference)*np.linalg.norm(frame[:self.hop]),1e-10),0.,1.))
                normalization=np.sqrt((1-self.fade)**2+self.fade**2+2*coherence*self.fade*(1-self.fade))
                piece=((self.tail*(1-self.fade)+frame[:self.hop]*self.fade)/normalization).astype(np.float32)
            self.tail=frame[self.hop:].copy();self.index+=1
            if target is not None:piece=piece[:target-self.written]
            output.append(piece);self.written+=len(piece)
            keep=max(0,round(self.index*self.hop*self.ratio)-self.search)
            remove=max(0,keep-self.base)
            self.buffer=self.buffer[remove:];self.base+=remove
        return np.concatenate(output) if output else np.empty(0,np.float32)

    def finish(self):
        if self.ended:return np.empty(0,np.float32)
        self.ended=True;target=round(self.received/self.ratio)
        self.buffer=np.r_[self.buffer,np.zeros(self.window+self.search+self.hop*3,np.float32)]
        output=self._drain(target)
        if self.written!=target:raise RuntimeError('テンポ処理の音声長が不正です')
        self.buffer=np.empty(0,np.float32);self.tail=None
        return output
