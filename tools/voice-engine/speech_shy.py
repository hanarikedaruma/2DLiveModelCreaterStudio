# SPDX-License-Identifier: GPL-3.0-or-later
"""Actual shy delivery: two airy attempts, a pause, slower rhythm and airy ends.

All operations are local and bounded. The cloned speaker/pitch are not changed.
The body attack is at most 120 ms and must resemble the introductory vowel;
consonants and the following word are not turned into a whole-word whisper.
"""
import re,unicodedata
import numpy as np
from speech_onset import airy_region
from speech_tempo import SpeechTempo,SHY_TEMPO as TEMPO

RATE=24000
STEP=240
MIN_GAP=15600  # 650 ms before tempo adjustment

def _profile(wave):
    width=600
    if len(wave)!=width:return None
    frequency=np.fft.rfftfreq(width,1/RATE);bands=[200,500,900,1400,2200,3500,5500,10000]
    power=abs(np.fft.rfft(wave*np.hanning(width)))**2
    vector=np.sqrt([power[(frequency>=lo)&(frequency<hi)].sum() for lo,hi in zip(bands[:-1],bands[1:])])
    return vector/max(float(np.linalg.norm(vector)),1e-10)

def _word_candidate(text,vowel):
    normalized=unicodedata.normalize('NFKC',text)
    match=re.match(r'^[\s「『（(【“"]*[あぁいぃうぅえぇおぉアァイィウゥエェオォ][っッ]?(?:[、,…。.・]+)\s*(.*)',normalized,re.S)
    if not match or not match[1]:return False
    first=match[1][0]
    if 'ァ'<=first<='ヶ':first=chr(ord(first)-0x60)
    first=dict(zip('ぁぃぅぇぉ','あいうえお')).get(first,first)
    if 'ぁ'<=first<='ゖ':return first==vowel
    # An unknown kanji reading must also pass the acoustic vowel match.
    return '\u3400'<=first<='\u9fff'

def _restart_anchor(raw,text):
    """Locate a written, isolated non-vowel restart for pause timing only."""
    normalized=unicodedata.normalize('NFKC',text)
    if not re.match(r'^[\s「『（(【“"]*(?:[ぁ-ゖァ-ヺ]{1,2}(?:[、,…。]|[.・]{2,})|あの[、…]|えっと[、…]|その[、…])',normalized):return 0
    prefix=raw[:15360];count=len(prefix)//STEP
    if count<24:return 0
    levels=np.sqrt(np.mean(prefix[:count*STEP].reshape(count,STEP).astype(float)**2,axis=1))
    threshold=max(float(levels.max())*.06,.0007);active=np.flatnonzero(levels>threshold)
    if not len(active) or active[0]>30:return 0
    start=int(active[0])
    for end in range(start+7,min(count-7,start+41)):
        if np.all(levels[end:end+8]<threshold):return (end+2)*STEP
    return 0

class _WordAttack:
    def __init__(self,raw,meta,vowel,text,seed,metrics,protected):
        self.seed=seed;self.metrics=metrics;self.protected=protected
        self.buffer=np.empty(0,np.float32);self.base=0;self.received=0
        self.first_end=round(meta.get('breathyOnsetEndMs',0)*24) or _restart_anchor(raw,text)
        self.done=self.first_end<=0
        self.candidate=bool(meta.get('breathyOnset')) and _word_candidate(text,vowel)
        self.reference=None
        lo=round(meta.get('breathyOnsetStartMs',0)*24)+480;hi=self.first_end-480
        features=[_profile(raw[i:i+600]) for i in range(lo,hi-600,120)]
        if features:
            self.reference=np.median(features,axis=0);self.reference/=max(float(np.linalg.norm(self.reference)),1e-10)
        prefix=raw[:self.first_end if self.first_end else min(len(raw),15360)]
        prefix=prefix[:len(prefix)//STEP*STEP]
        levels=np.sqrt(np.mean(prefix.reshape(-1,STEP).astype(float)**2,axis=1)) if len(prefix) else np.array([0.])
        self.floor=max(float(levels.max())*.12,.0007)
        self.metrics.update(breathyWordOnset=0,breathyWordOnsetStartMs=0.,breathyWordOnsetEndMs=0.,
            shyGapAddedMs=0.,shyIntroGapMs=0.,shyRestartGapEligible=int(self.first_end>0))

    @property
    def waiting(self):return not self.done

    def feed(self,audio,final=False):
        if self.done:return audio
        self.received+=len(audio);self.buffer=np.r_[self.buffer,audio];output=[]
        if self.base<self.first_end:
            count=min(len(self.buffer),self.first_end-self.base)
            output.append(self.buffer[:count]);self.buffer=self.buffer[count:];self.base+=count
        count=len(self.buffer)//STEP
        levels=np.sqrt(np.mean(self.buffer[:count*STEP].reshape(count,STEP).astype(float)**2,axis=1)) if count else np.array([])
        active=np.array([i for i in np.flatnonzero(levels>self.floor) if np.sum(levels[i:i+3]>self.floor)>=2],dtype=int)
        if not len(active):
            keep=0 if final else min(len(self.buffer),4*STEP)
            release=len(self.buffer)-keep
            if not final:release=release//STEP*STEP
            output.append(self.buffer[:release]);self.buffer=self.buffer[release:];self.base+=release
            if final or self.base>self.first_end+2*RATE:
                output.append(self.buffer);self.buffer=np.empty(0,np.float32);self.done=True
        else:
            start=int(active[0])*STEP
            # Fixed 160 ms decision window, independent of packet size.
            if len(self.buffer)<start+3840 and not final:
                release=max(0,start-STEP)
                output.append(self.buffer[:release]);self.buffer=self.buffer[release:];self.base+=release
            else:
                lo=max(0,start-STEP);hi=start
                if self.candidate and self.reference is not None:
                    initial=[]
                    for offset in range(0,min(720,len(self.buffer)-start-600)+1,120):
                        initial.append(float(_profile(self.buffer[start+offset:start+offset+600])@self.reference))
                    if initial and max(initial)>=.90:
                        peak=float(np.max(levels[start//STEP:start//STEP+3]))
                        for offset in range(0,min(2880,len(self.buffer)-start-600+1),STEP):
                            level=float(np.sqrt(np.mean(self.buffer[start+offset:start+offset+STEP].astype(float)**2)))
                            similarity=float(_profile(self.buffer[start+offset:start+offset+600])@self.reference)
                            if offset>=720 and (level<peak*.35 or similarity<.90):break
                            hi=start+offset+STEP
                added=max(0,MIN_GAP-(self.base+start-self.first_end))
                added=round(added/STEP)*STEP
                self.metrics.update(shyGapAddedMs=added/24,shyIntroGapMs=(self.base+start+added-self.first_end)/24)
                if hi-start>=720:
                    airy=airy_region(self.buffer[lo:hi],RATE,self.seed^0x105)
                    if airy is not None:
                        self.buffer=self.buffer.copy();self.buffer[lo:hi]=airy
                        bounds=((self.base+lo+added),(self.base+hi+added));self.protected.append(bounds)
                        self.metrics.update(breathyWordOnset=1,breathyWordOnsetStartMs=bounds[0]/24,breathyWordOnsetEndMs=bounds[1]/24)
                output.extend([self.buffer[:lo],np.zeros(added,np.float32),self.buffer[lo:]])
                self.buffer=np.empty(0,np.float32);self.done=True
        return np.concatenate(output) if output else np.empty(0,np.float32)

class _AiryEnds:
    def __init__(self,floor,seed,metrics,protected):
        self.floor=floor;self.seed=seed;self.metrics=metrics;self.protected=protected
        self.partial=np.empty(0,np.float32);self.buffer=np.empty(0,np.float32)
        self.position=0;self.base=0;self.last_active=0;self.quiet=0;self.has_active=False
        self.metrics.update(shyTailBreaths=0,shyTailStartMs=0.,shyTailEndMs=0.)

    def _end(self):
        end=self.last_active-self.base;lo=max(0,end-4320)
        # Already airy attacks must not be attenuated a second time.
        for start,stop in self.protected:
            if start<self.last_active and stop>self.base+lo:lo=max(lo,min(end,stop-self.base))
        if end-lo>=960:
            region=self.buffer[lo:end];airy=airy_region(region,RATE,self.seed^0x5a17^self.metrics['shyTailBreaths'])
            if airy is not None:
                progress=np.linspace(0,1,len(region));blend=np.sin(progress*np.pi/2)**2
                softened=(region*(1-blend)+airy*blend)*np.exp(-.8*progress**2)
                # Start exactly at the original PCM; finish where TTS already decays.
                self.buffer=self.buffer.copy();self.buffer[lo:end]=softened.astype(np.float32)
                bridge=min(720,len(self.buffer)-end)
                if bridge:self.buffer[end:end+bridge]*=np.linspace(np.exp(-.8),1.,bridge).astype(np.float32)
                self.metrics.update(shyTailBreaths=self.metrics['shyTailBreaths']+1,
                    shyTailStartMs=(self.base+lo)/24,shyTailEndMs=self.last_active/24)
        result=self.buffer;self.base=self.position;self.buffer=np.empty(0,np.float32);self.has_active=False
        return result

    def feed(self,audio,final=False):
        self.partial=np.r_[self.partial,audio];output=[]
        while len(self.partial)>=STEP or (final and len(self.partial)):
            count=min(STEP,len(self.partial));frame=self.partial[:count];self.partial=self.partial[count:]
            self.buffer=np.r_[self.buffer,frame];self.position+=count
            active=float(np.sqrt(np.mean(frame.astype(float)**2)))>self.floor
            if active:
                self.last_active=self.position;self.quiet=0;self.has_active=True
                protected=any(start<self.position<=stop for start,stop in self.protected)
                release=len(self.buffer) if protected else max(0,len(self.buffer)-4320)
                if release:
                    output.append(self.buffer[:release]);self.buffer=self.buffer[release:];self.base+=release
                if protected:self.has_active=False
            else:
                self.quiet+=count
                if not self.has_active:
                    output.append(self.buffer);self.buffer=np.empty(0,np.float32);self.base=self.position
                elif self.quiet>=9600:output.append(self._end())
        if final and len(self.buffer):output.append(self._end())
        return np.concatenate(output) if output else np.empty(0,np.float32)

class ShyRenderer:
    def __init__(self,raw,meta,vowel,text,seed):
        self.metrics=dict(shyDelivery=1,shyTempoRatio=TEMPO)
        self.protected=[]
        if meta.get('breathyOnset'):
            self.protected.append((round(meta['breathyOnsetStartMs']*24),round(meta['breathyOnsetEndMs']*24)))
        self.word=_WordAttack(raw,meta,vowel,text,seed,self.metrics,self.protected)
        self.ends=_AiryEnds(max(self.word.floor*.5,.0007),seed,self.metrics,self.protected)
        self.tempo=SpeechTempo(TEMPO);self.ended=False

    @property
    def waiting_for_word(self):return self.word.waiting

    def feed(self,audio):
        if self.ended:raise RuntimeError('終了した読み方です')
        return self.tempo.feed(self.ends.feed(self.word.feed(audio)))

    def finish(self):
        if self.ended:return np.empty(0,np.float32)
        self.ended=True
        tail=self.word.feed(np.empty(0,np.float32),final=True)
        result=self.tempo.feed(self.ends.feed(tail,final=True))
        return np.r_[result,self.tempo.finish()]
