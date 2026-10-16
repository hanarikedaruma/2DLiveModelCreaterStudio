# SPDX-License-Identifier: GPL-3.0-or-later
"""A short, predominantly unvoiced introductory vowel, never a whole-voice effect.

Source-filter approximation: estimate the existing vowel's spectral envelope,
broaden its resonances, and excite it with aperiodic airflow. It is a synthetic
approximation of an airy onset, not a claim to reproduce natural breath exactly.
The following pause and every sample of the body stay unchanged.
"""
import re
import unicodedata
import numpy as np
from scipy.linalg import solve_toeplitz
from scipy.ndimage import uniform_filter1d
from scipy.signal import lfilter

def onset_vowel(text,style):
    # Normalize only for detection: keep the submitted/performed text intact.
    if style!='shy':return ''
    normalized=unicodedata.normalize('NFKC',text)
    match=re.match(r'^[\s「『（(【“"]*([あぁいぃうぅえぇおぉアァイィウゥエェオォ])[っッ]?(?:[、,…。]|[.・]{2,})',normalized)
    if not match:return ''
    kana=match[1]
    if 'ァ'<=kana<='オ':kana=chr(ord(kana)-0x60)
    return dict(zip('ぁぃぅぇぉ','あいうえお')).get(kana,kana)

def eligible_onset(text,style):return bool(onset_vowel(text,style))

def needs_onset_context(audio,rate=24000):
    """Only a late/incomplete onset may need another 320 ms, at most 1280 ms.

    A complete short sound followed by 80 ms of silence needs no extra wait.
    Continuous early speech is immediately left intact, never progressively
    swallowed while waiting for a gap. Called only for the new i/u/e/o path.
    """
    if rate!=24000 or len(audio)>=round(1.28*rate):return False
    step=240;count=len(audio)//step
    if count<24:return True
    rms=np.sqrt(np.mean(np.asarray(audio[:count*step]).reshape(count,step).astype(np.float64)**2,axis=1))
    threshold=max(float(rms.max())*.06,1e-5);active=np.flatnonzero(rms>threshold)
    if not len(active):return True
    start=int(active[0])
    if start>64:return False
    for i in range(start+7,min(count-7,start+33)):
        if np.all(rms[i:i+8]<threshold):return False
    return count<start+40

def soften_onset(audio,rate=24000,seed=31415,*,extended=False):
    """Return same-length PCM and metrics; abstain if no isolated short onset.

    Normally inspect the first 640 ms, matching the first normal codec packet.
    For i/u/e/o, allow a late onset up to 640 ms and at most 1280 ms of context,
    in 320 ms increments, exactly matching the streaming packet accumulation. A
    silence of at least 80 ms must delimit a 70–320 ms sound before conversion.
    Ambiguous/continuous speech is left intact; the first word is never cut out.
    """
    original=np.asarray(audio,dtype=np.float32)
    meta=dict(breathyOnset=0,breathyOnsetStartMs=0.,breathyOnsetEndMs=0.)
    if rate!=24000 or original.ndim!=1 or not np.isfinite(original).all():raise ValueError('冒頭音声の形式が不正です')
    limit=min(len(original),round(.64*rate))
    if extended:
        while limit<len(original) and needs_onset_context(original[:limit],rate):
            limit=min(len(original),limit+round(.32*rate))
    prefix=original[:limit]
    step=round(.01*rate);count=len(prefix)//step
    if count<24:return original,meta
    rms=np.sqrt(np.mean(prefix[:count*step].reshape(count,step).astype(np.float64)**2,axis=1))
    threshold=max(float(rms.max())*.06,1e-5)
    active=np.flatnonzero(rms>threshold)
    if not len(active):return original,meta
    start=int(active[0])
    if start>(64 if extended else 18):return original,meta
    end=None
    for i in range(start+7,min(count-7,start+33)):
        if np.all(rms[i:i+8]<threshold):end=i;break
    if end is None or end-start>32:return original,meta
    levels=rms[start:end];peak=float(levels.max())
    loud=np.flatnonzero(levels>=peak*.5)
    if len(loud):
        for i in range(int(loud[0])+1,len(levels)-1):
            if levels[i]<peak*.35 and np.any(levels[i+1:]>peak*.5):return original,meta
    # Reject changing articulation (e.g. a swallowed interjection followed by a
    # whole word). A short, isolated vowel has a comparatively stationary tract.
    core=original[(start+1)*step:(end-2)*step].astype(np.float64)
    width=round(.03*rate);bands=[200,500,900,1400,2200,3500,5500,10000]
    frequency=np.fft.rfftfreq(width,1/rate);features=[]
    core_level=float(np.sqrt(np.mean(core*core))) if len(core) else 0.
    for position in range(0,len(core)-width,step):
        frame=core[position:position+width]
        if np.sqrt(np.mean(frame*frame))<(peak if extended else core_level)*.55:continue
        power=np.abs(np.fft.rfft(frame*np.hanning(width)))**2
        feature=np.sqrt([power[(frequency>=lo)&(frequency<hi)].sum() for lo,hi in zip(bands[:-1],bands[1:])])
        features.append(feature/max(float(np.linalg.norm(feature)),1e-12))
    if len(features)>2:
        center=np.median(features,axis=0);center/=max(float(np.linalg.norm(center)),1e-12)
        if np.min(np.asarray(features)@center)<.90:return original,meta
    lo=max(0,(start-2)*step);hi=min(len(prefix),(end+2)*step)
    vowel=original[lo:hi].astype(np.float64)
    replacement=airy_region(vowel,rate,seed)
    if replacement is None:return original,meta
    result=original.copy();result[lo:hi]=replacement
    meta.update(breathyOnset=1,breathyOnsetStartMs=lo/rate*1000,breathyOnsetEndMs=hi/rate*1000)
    return result,meta

def airy_region(vowel,rate=24000,seed=31415):
    """Same speaker's local tract envelope with predominantly aperiodic airflow.

    Returns only a replacement for the supplied region; callers own the bounds.
    Keeping this calculation unchanged preserves the approved introductory sound.
    """
    vowel=np.asarray(vowel,dtype=np.float64)
    if len(vowel)<round(.025*rate) or not np.isfinite(vowel).all():return None
    # Emphasize the tract envelope over the periodic glottal spectral tilt.
    shaped=lfilter([1.,-.94],[1.],vowel)*np.hanning(len(vowel))
    order=28
    correlation=np.array([np.dot(shaped[:len(shaped)-lag],shaped[lag:]) for lag in range(order+1)])
    if correlation[0]<1e-12:return None
    correlation[0]*=1.003
    try:coefficients=np.r_[1.,solve_toeplitz(correlation[:-1],-correlation[1:])]
    except (ValueError,np.linalg.LinAlgError):return None
    # Bandwidth expansion prevents a narrow, vowel-like ringing excitation.
    coefficients*=.98**np.arange(order+1)
    noise=np.random.default_rng(seed^0x6a31).standard_normal(len(vowel)+1024)
    airy=lfilter([1.],coefficients,noise)[1024:]
    window=round(.025*rate)
    envelope=np.sqrt(np.maximum(uniform_filter1d(vowel*vowel,window,mode='constant'),0))
    energy=np.sqrt(np.maximum(uniform_filter1d(airy*airy,window,mode='nearest'),1e-10))
    airy=airy/energy*envelope*.25+vowel*.015
    ramp=min(round(.012*rate),len(vowel)//3)
    fade=np.ones(len(vowel));fade[:ramp]=np.sin(np.linspace(0,np.pi/2,ramp))**2;fade[-ramp:]=fade[:ramp][::-1]
    replacement=(airy*fade+vowel*(1-fade)).astype(np.float32)
    if not np.isfinite(replacement).all() or np.max(np.abs(replacement))>max(float(np.max(np.abs(vowel))),.01):return None
    return replacement
