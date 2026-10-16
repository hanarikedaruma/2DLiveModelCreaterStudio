# SPDX-License-Identifier: GPL-3.0-or-later
"""Plan a bounded startup reserve from producer time, without altering speech PCM."""
import math
from collections import deque
from statistics import median

RATE=48000

def text_units(text):
    # Only a duration estimate: the original text is always sent unchanged.
    return max(1.,sum(0 if c.isspace() else .4 if c.isascii() and c.isalnum() else 1.5 if c in '、。，．！？!?…' else 1. for c in text))

class SpeechBufferPlan:
    def __init__(self,text,seconds_per_unit=None):
        self.units=text_units(text)
        pace=seconds_per_unit if seconds_per_unit is not None else (.22 if self.units<25 else .18)
        self.duration=min(120.,self.units*pace)
        self.frames=0;self.last=None;self.ratios=deque(maxlen=6)

    def observe(self,frames,produced_at=None):
        self.frames+=frames
        if type(produced_at) not in (int,float) or not math.isfinite(produced_at):return
        if self.last is not None and frames>0:
            elapsed=produced_at-self.last
            if elapsed>0:self.ratios.append(elapsed/(frames/RATE))
        self.last=produced_at

    @property
    def rtf(self):
        # Startup/prefill is excluded. Allow a modest margin for GPU jitter.
        return (median(self.ratios) if self.ratios else 1.)*1.10

    @property
    def target(self):
        duration=max(self.duration,self.frames/RATE)
        # Leave room for the last codec frame, EOS and the host's final tail.
        return math.ceil(min(120.,max(1.,duration*max(0.,1-1/self.rtf)+.45))*RATE)

    def ready(self):return self.frames>=self.target

    def metrics(self):
        return dict(startupBufferMs=self.frames/48,bufferTargetMs=self.target/48,
                    estimatedRtf=self.rtf,estimatedAudioSeconds=self.duration)
