# SPDX-License-Identifier: GPL-3.0-or-later
"""Ordered, optional output filters. Registry entries also describe their UI.

Add a FilterSpec and processor to REGISTRY to add a built-in filter. Profiles
contain data only; they cannot import Python modules or load external plug-ins.
"""
from __future__ import annotations
from dataclasses import dataclass
import uuid
import numpy as np
from scipy.signal import butter, iirpeak, lfilter, sosfilt, tf2sos

RATE=48000
MAX_FILTERS=8

@dataclass(frozen=True)
class Parameter:
    key: str
    label: str
    minimum: float
    maximum: float
    default: float
    unit: str

@dataclass(frozen=True)
class FilterSpec:
    title: str
    description: str
    parameters: tuple[Parameter,...]
    processor: type

class Biquad:
    def __init__(self,sos):
        self.sos=np.asarray(sos,dtype=np.float64)
        self.state=np.zeros((len(self.sos),2))
    def process(self,audio):
        output,self.state=sosfilt(self.sos,audio,zi=self.state)
        return output

class Envelope:
    def __init__(self,seconds):
        self.pole=np.exp(-1/(RATE*seconds));self.state=np.zeros(1)
    def process(self,audio):
        result,self.state=lfilter([1-self.pole],[1,-self.pole],audio,zi=self.state)
        return result

class Resonance:
    def __init__(self,p):
        b,a=iirpeak(p["frequencyHz"],p["q"],fs=RATE)
        self.band=Biquad(tf2sos(b,a))
        self.full_level=Envelope(.008);self.band_level=Envelope(.008);self.reduction=Envelope(.010)
        self.maximum=1-10**(-9*p["strength"]/100/20)
        self.threshold=.65-.006*p["sensitivity"]
    def process(self,audio):
        band=self.band.process(audio)
        full=np.sqrt(np.maximum(self.full_level.process(audio**2),0))
        level=np.sqrt(np.maximum(self.band_level.process(band**2),0))
        activation=np.clip((level/np.maximum(full,1e-7)-self.threshold)/.4,0,1)
        reduction=self.reduction.process(self.maximum*activation)
        return audio-reduction*band

class DeEsser:
    def __init__(self,p):
        # A first-order complementary crossover avoids a phase-reversed
        # high band when mixing the attenuated band back into the voice.
        self.low=Biquad(butter(1,p["frequencyHz"],fs=RATE,output="sos"))
        self.full_level=Envelope(.006);self.high_level=Envelope(.006);self.reduction=Envelope(.012)
        self.maximum=1-10**(-12*p["strength"]/100/20)
        self.threshold=p["thresholdDb"]
    def process(self,audio):
        low=self.low.process(audio);high=audio-low
        full=np.sqrt(np.maximum(self.full_level.process(audio**2),0))
        level=np.sqrt(np.maximum(self.high_level.process(high**2),0))
        above=np.clip((20*np.log10(np.maximum(level,1e-8))-self.threshold)/12,0,1)
        high_ratio=np.clip((level/np.maximum(full,1e-7)-.55)/.65,0,1)
        reduction=self.reduction.process(self.maximum*above*high_ratio)
        return audio-reduction*high

class LowPass(Biquad):
    def __init__(self,p):super().__init__(butter(2,p["frequencyHz"],fs=RATE,output="sos"))

class Equalizer(Biquad):
    def __init__(self,p):
        a=10**(p["gainDb"]/40);w=2*np.pi*p["frequencyHz"]/RATE;alpha=np.sin(w)/(2*p["q"])
        b=[1+alpha*a,-2*np.cos(w),1-alpha*a]
        d=[1+alpha/a,-2*np.cos(w),1-alpha/a]
        super().__init__([np.array(b+d)/d[0]])

class Gain:
    def __init__(self,p):self.gain=10**(p["gainDb"]/20)
    def process(self,audio):return audio*self.gain

REGISTRY={
    "resonance":FilterSpec("電子感・金属音の抑制","指定した帯域が目立つときだけ弱めます。低いうなりは低め、キンキンした響きは高めの周波数で探します。",(
        Parameter("strength","抑制の強さ",0,100,35,"%"),
        Parameter("frequencyHz","中心周波数",150,8000,1800,"Hz"),
        Parameter("q","帯域の狭さ（Q）",.4,6,1.2,""),
        Parameter("sensitivity","反応のしやすさ",0,100,75,"%")),Resonance),
    "deesser":FilterSpec("高音のザラつき・歯擦音の抑制","高音が強いときだけ丸めます。サ行や息遣いを残すため、弱めから調整してください。",(
        Parameter("strength","抑制の強さ",0,100,30,"%"),
        Parameter("frequencyHz","対象の高音",3500,9000,5800,"Hz"),
        Parameter("thresholdDb","反応する音量",-50,-12,-40,"dB")),DeEsser),
    "lowpass":FilterSpec("高音を丸める（ローパス）","設定より上の高音をなだらかに減らします。下げすぎると声がこもります。",(
        Parameter("frequencyHz","高音を残す上限",3000,14000,9000,"Hz"),),LowPass),
    "equalizer":FilterSpec("特定の帯域を調整（EQ）","周波数を選んで、響きを増減します。金属音の帯域探しにも使えます。",(
        Parameter("frequencyHz","中心周波数",100,10000,3000,"Hz"),
        Parameter("gainDb","強調・抑制",-12,12,-3,"dB"),
        Parameter("q","帯域の狭さ（Q）",.4,8,1.2,"")),Equalizer),
    "gain":FilterSpec("音量（ゲイン）","フィルタで音量が変わった場合に調整します。上げすぎた分は最後の出力保護で制限されます。",(
        Parameter("gainDb","音量",-12,12,0,"dB"),),Gain),
}

def new_filter(type_id):
    spec=REGISTRY[type_id]
    return {"id":uuid.uuid4().hex,"type":type_id,"name":spec.title,"enabled":True,
            "params":{p.key:p.default for p in spec.parameters}}

def default_chain():
    items=[new_filter(kind) for kind in ("resonance","deesser","lowpass")]
    # Stable stock IDs keep settings identical across installs and backend switches.
    for item in items:item["id"]="default-"+item["type"]
    return {"schemaVersion":1,"enabled":True,"items":items}

def validate_chain(value=None):
    if value is None:return {"schemaVersion":1,"enabled":False,"items":[]}
    if not isinstance(value,dict) or value.get("schemaVersion")!=1 or not isinstance(value.get("enabled"),bool):raise ValueError("未対応のフィルタ設定です")
    items=value.get("items")
    if not isinstance(items,list) or len(items)>MAX_FILTERS:raise ValueError(f"フィルタは最大{MAX_FILTERS}個です")
    result=[];seen=set()
    for item in items:
        if not isinstance(item,dict) or not isinstance(item.get("type"),str) or item["type"] not in REGISTRY:raise ValueError("未対応のフィルタ種類です")
        identity=item.get("id");name=item.get("name");enabled=item.get("enabled");params=item.get("params")
        if not isinstance(identity,str) or not 1<=len(identity)<=64 or identity in seen:raise ValueError("フィルタのIDが不正です")
        if not isinstance(name,str) or not 1<=len(name.strip())<=100 or not isinstance(enabled,bool) or not isinstance(params,dict):raise ValueError("フィルタの名前・状態が不正です")
        spec=REGISTRY[item["type"]];keys={p.key for p in spec.parameters}
        if set(params)-keys:raise ValueError("未対応のフィルタパラメータです")
        clean={}
        for p in spec.parameters:
            number=params.get(p.key,p.default)
            if isinstance(number,bool) or not isinstance(number,(int,float)) or not np.isfinite(number) or not p.minimum<=number<=p.maximum:raise ValueError(f"フィルタの値が不正です: {p.key}")
            clean[p.key]=float(number)
        seen.add(identity);result.append(dict(id=identity,type=item["type"],name=name.strip(),enabled=enabled,params=clean))
    return {"schemaVersion":1,"enabled":value["enabled"],"items":result}

class Pipeline:
    def __init__(self,config):
        self.processors=[REGISTRY[item["type"]].processor(item["params"]) for item in config["items"] if config["enabled"] and item["enabled"]]
    def process(self,audio):
        result=np.asarray(audio,dtype=np.float64)
        for processor in self.processors:result=processor.process(result)
        return result

class FilterChain:
    """Continuous filter state, no added block buffering; 30ms edit crossfades."""
    def __init__(self,config=None):
        self.config=validate_chain(config);self.current=Pipeline(self.config)
        self.previous=None;self.fade_position=0;self.history=np.zeros(0,np.float32)
    def update(self,config):
        clean=validate_chain(config)
        if clean==self.config:return
        replacement=Pipeline(clean)
        if len(self.history):replacement.process(self.history)
        self.previous=self.current;self.current=replacement;self.config=clean;self.fade_position=0
    def process(self,audio):
        source=np.asarray(audio,dtype=np.float32)
        output=self.current.process(source)
        if self.previous is not None:
            old=self.previous.process(source)
            position=(self.fade_position+np.arange(len(source)))/1440
            fade=np.sin(np.minimum(position,1)*np.pi/2)**2
            output=old*(1-fade)+output*fade
            self.fade_position+=len(source)
            if self.fade_position>=1440:self.previous=None
        self.history=np.concatenate([self.history,source])[-4800:].copy()
        output=np.asarray(output,dtype=np.float32)
        if not np.isfinite(output).all():raise RuntimeError("フィルタが不正な音声を出力しました")
        return output
