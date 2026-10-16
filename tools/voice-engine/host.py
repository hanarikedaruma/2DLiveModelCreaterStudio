# SPDX-License-Identifier: GPL-3.0-or-later
"""Studio-owned AI audio host. Newline RPC on stdin; bounded events on stdout."""
from __future__ import annotations
import argparse
import base64
from dataclasses import asdict
import hashlib
import io
import json
import os
from pathlib import Path
import queue
import shutil
import subprocess
import sys
import threading
import time
import uuid
from functools import lru_cache

import numpy as np
import soundfile as sf
from backend import read_profile, REALTIME_BACKEND, SEED_BACKEND
from filter_chain import REGISTRY, validate_chain
from audio_processing import validate_tone
from live import LiveEngine, devices
from processes import stop_owned_process
from studio_speech import StudioSpeech
from speech_config import locate_runtime, voice_description

ROOT=Path(__file__).resolve().parent
AI_BACKENDS=(REALTIME_BACKEND,SEED_BACKEND)
QUALITY={
    # Same presets as liverVoiceChanger 0.8.0 current_profile().
    "fast":dict(steps=4,cfgRate=0.,hopSeconds=.18,lookaheadSeconds=.08,historySeconds=1.5,generationHistorySeconds=.4,referenceSeconds=2),
    "balanced":dict(steps=6,cfgRate=.7,hopSeconds=.24,lookaheadSeconds=.08,historySeconds=2.5,generationHistorySeconds=.5,referenceSeconds=3),
    "stable":dict(steps=8,cfgRate=.7,hopSeconds=.30,lookaheadSeconds=.08,historySeconds=2.5,generationHistorySeconds=.5,referenceSeconds=3),
    "hq":dict(steps=20,cfgRate=.7,hopSeconds=3.,lookaheadSeconds=.2,historySeconds=.6,referenceSeconds=5),
}

@lru_cache(maxsize=1)
def verify_assets():
    manifest=json.loads((ROOT/"assets.json").read_text(encoding="utf-8-sig"))
    for asset in manifest["assets"]:
        path=ROOT/asset["path"]
        if not path.is_file() or path.stat().st_size!=asset["bytes"] or hashlib.sha256(path.read_bytes()).hexdigest()!=asset["sha256"]:
            raise ValueError("音声エンジンの素材が見つからないか、内容が異なります: "+asset["path"])


def finite_number(value, low, high):
    if isinstance(value,bool) or not isinstance(value,(int,float)) or not np.isfinite(value) or not low<=value<=high:
        raise ValueError("音声設定の数値が範囲外です")
    return float(value)


def reference_file(path):
    path=Path(path).resolve()
    if not path.is_file() or path.stat().st_size>256*1024*1024:
        raise ValueError("参照WAVが見つからないか、256MBを超えています")
    info=sf.info(path)
    if info.format not in ("WAV","WAVEX") or not 1<=info.duration<=120 or info.channels>2 or info.samplerate>192000:
        raise ValueError("参照音声は1〜120秒、mono/stereo、192kHz以下のWAVにしてください")
    return path


class Host:
    def __init__(self,data,model_root):
        self.data=Path(data).resolve();self.data.mkdir(parents=True,exist_ok=True)
        self.model_root=Path(model_root).resolve() if model_root else None
        self.engine=LiveEngine();self.session="";self.project_dir=None
        self.lock=threading.Lock();self.closed=threading.Event()
        self.job=None;self.job_thread=None
        self.job_cancel=threading.Event()
        self.speech=StudioSpeech(self.data);self.source="microphone"
        self.monitor=threading.Thread(target=self.events,daemon=True);self.monitor.start()

    def emit(self,value):
        payload=(json.dumps(value,ensure_ascii=False,allow_nan=False,separators=(",",":"))+"\n").encode("utf-8")
        with self.lock:
            view=memoryview(payload)
            while view:
                written=sys.stdout.buffer.write(view)
                if not written:raise BrokenPipeError("音声ホストの送信が終了しました")
                view=view[written:]
            sys.stdout.buffer.flush()

    def idle(self):
        if self.engine.thread and self.engine.thread.is_alive():
            raise RuntimeError("音声を停止してから変更してください")
        if self.job_thread and self.job_thread.is_alive():
            raise RuntimeError("WAVの変換が実行中です。完了または中断してから操作してください")
        if hasattr(self,"speech") and self.speech.busy():
            raise RuntimeError("読み上げを停止してから操作してください")

    def device_list(self):
        ins,outs,_=devices()
        def item(pair):
            i,d=pair
            return dict(id=f"{d['hostapi']}:{d['name']}",index=i,label=d["name"])
        return dict(inputs=[item(x) for x in ins],outputs=[item(x) for x in outs])

    def device(self,identity,kind):
        candidates=self.device_list()[kind]
        matches=[d for d in candidates if d["id"]==identity]
        if len(matches)!=1:raise ValueError("入出力の機器が見つからないか、同じ名前の機器が複数あります。選び直してください")
        return matches[0]["index"]

    def reference(self,key,project_dir=None):
        if key=="builtin":return ROOT/"voices"/"original-soft-girl.wav"
        if not isinstance(key,str) or not key.startswith("voice/references/") or Path(key).name!=key.split("/")[-1]:
            raise ValueError("未対応の参照音声です。参照WAVを取り込んでください")
        filename=key.removeprefix("voice/references/")
        if len(filename)!=68 or not filename.endswith(".wav") or any(c not in "0123456789abcdef" for c in filename[:-4]):
            raise ValueError("参照音声の名前が不正です")
        candidates=[]
        if project_dir:candidates.append(Path(project_dir).resolve()/key)
        candidates.append(self.data/"references"/filename)
        for candidate in candidates:
            if candidate.is_file():
                if hashlib.sha256(candidate.read_bytes()).hexdigest()!=filename[:-4]:
                    raise ValueError("参照WAVの内容が保存したものと違います。もう一度取り込んでください")
                return candidate
        raise ValueError("参照WAVが見つかりません。もう一度取り込んでください")

    def import_reference(self,path):
        original=reference_file(path)
        filename=hashlib.sha256(original.read_bytes()).hexdigest()+".wav"
        target=self.data/"references"/filename;target.parent.mkdir(exist_ok=True)
        if not target.exists():shutil.copyfile(original,target)
        return "voice/references/"+filename

    def normalize(self,value,project_dir=None):
        verify_assets()
        if not isinstance(value,dict) or value.get("backend") not in AI_BACKENDS:
            raise ValueError("AI方式のSeed-VC声設定だけを使えます")
        if self.model_root is None:raise ValueError("AIモデルの保存先が未設定です。音声エンジンの準備を行ってください")
        quality=value.get("quality","fast")
        if quality not in QUALITY:raise ValueError("品質の設定が不正です")
        if (quality=="hq")!=(value["backend"]==SEED_BACKEND):raise ValueError("AI方式と品質の組み合わせが不正です")
        cleanup=value.get("inputCleanup",{})
        if not isinstance(cleanup,dict) or not isinstance(cleanup.get("speechOnly",True),bool):raise ValueError("雑音設定が不正です")
        p=dict(schemaVersion=1,name=value.get("name"),backend=value["backend"],
            sourceRepo=str(self.model_root/"external"/"seed-vc"),
            cacheDirectory=str(self.model_root/"external"/("realtime-models" if value["backend"]==REALTIME_BACKEND else "quality-models")),
            reference=str(self.reference(value.get("reference","builtin"),project_dir)),
            outputGainDb=finite_number(value.get("outputGainDb",-3),-18,12),seed=1729,
            voiceTone=validate_tone(value.get("voiceTone",{})),outputFilters=validate_chain(value.get("outputFilters")),
            inputCleanup=dict(noiseReduction=finite_number(cleanup.get("noiseReduction",.85),0,1),speechOnly=cleanup.get("speechOnly",True),
                speechSensitivity=finite_number(cleanup.get("speechSensitivity",40),0,100),
                latencyMode="lowLatency" if value["backend"]==REALTIME_BACKEND else "natural",
                noiseLibrary=str(ROOT/"voice-noise.dll"),vadModel=str(ROOT/"models"/"silero_vad.onnx")))
        p.update(QUALITY[quality])
        advanced=value.get("advanced")
        if advanced:
            if not isinstance(advanced,dict) or set(advanced)-set(QUALITY["fast"])-{"seed"}:raise ValueError("品質の個別設定が不正です")
            p.update(advanced)
        path=self.data/"active-profile.json"
        path.write_text(json.dumps(p,ensure_ascii=False,allow_nan=False),encoding="utf-8")
        read_profile(path)
        return path

    def import_profile(self,path):
        self.idle()
        p=read_profile(path,check_assets=False)
        if p["backend"] not in AI_BACKENDS:raise ValueError("AI方式だけを取り込めます")
        ref=self.import_reference(p["reference"])
        quality="hq" if p["backend"]==SEED_BACKEND else next((name for name in ("fast","balanced","stable") if p["steps"]==QUALITY[name]["steps"]),"fast")
        profile=dict(name=p["name"],backend=p["backend"],quality=quality,
            reference=ref,outputGainDb=p["outputGainDb"],voiceTone=p["voiceTone"],outputFilters=p["outputFilters"],
            inputCleanup={k:p["inputCleanup"].get(k,d) for k,d in (("noiseReduction",0),("speechOnly",False),("speechSensitivity",40))},
            advanced={k:p[k] for k in (*QUALITY["fast"],"seed") if k in p})
        self.normalize(profile)
        return profile

    def status(self):
        if self.source=="speech":
            return dict(kind="status",sessionId=self.speech.session,state=self.speech.state,error=self.speech.error,
                metrics=self.speech.metrics,mute=self.speech.mute,bypass=False,source="speech",speech=self.speech.status())
        state=self.engine.state
        if state=="starting":state="priming" if hasattr(self.engine,"hop") and self.engine.client else "loading"
        return dict(kind="status",sessionId=self.session,state=state,error=self.engine.error,
            metrics=dict(self.engine.stats),mute=self.engine.mute,bypass=self.engine.bypass,source="microphone",speech=self.speech.status())

    def request(self,action,payload):
        if action=="clock":return dict(hostTimeMs=time.perf_counter()*1000)
        if action=="inspectSpeech":
            # VCの準備と独立してTTSの固定モデル・Python環境を確認する。
            profile={"sourceRepo":str(self.model_root/"external"/"seed-vc")} if self.model_root else {}
            ready=True;reason=""
            try:locate_runtime(profile)
            except ValueError as error:ready=False;reason=str(error)
            profile["reference"]=str(self.reference(payload.get("profile",{}).get("reference","builtin"),payload.get("projectDir")))
            return dict(ready=ready,reason=reason,voice=voice_description(profile),outputs=self.device_list()["outputs"])
        if action=="speak":
            self.idle()
            profile=json.loads(self.normalize(payload["profile"],payload.get("projectDir")).read_text(encoding="utf-8"))
            device=self.device(payload["outputDeviceId"],"outputs")
            mute=payload.get("mute",False)
            if not isinstance(mute,bool):raise ValueError("出力状態が不正です")
            result=self.speech.start(payload["text"],payload.get("preferences"),profile,device,mute)
            self.source="speech"
            return result
        if action=='prepareSpeechDraft':
            if self.engine.state not in ('stopped','error') or (self.job_thread and self.job_thread.is_alive()):return False
            profile=json.loads(self.normalize(payload['profile'],payload.get('projectDir')).read_text(encoding='utf-8'))
            self.speech.prepare(payload.get('text',''),payload.get('preferences'),profile,payload.get('owner'),payload.get('revision'))
            return True
        if action=='discardSpeechDraft':self.speech.discard(payload.get('owner'));return True
        if action=="clearSpeechHistory":self.speech.clear_history();return True
        if action=="releaseSpeech":self.speech.release();return True
        if action=="inspect":
            verify_assets()
            specs=[]
            for key,spec in REGISTRY.items():specs.append(dict(type=key,title=spec.title,description=spec.description,parameters=[asdict(p) for p in spec.parameters]))
            import torch
            ready=self.model_root is not None and (self.model_root/"external"/"seed-vc"/"inference.py").is_file() and torch.cuda.is_available()
            return dict(ready=ready,reason="" if ready else "CUDA対応GPUとAIモデルの準備が必要です",modelRoot=str(self.model_root or ""),filters=specs,**self.device_list())
        if action=="configure":
            self.idle();root=Path(payload["modelRoot"]).resolve()
            if not (root/"external"/"seed-vc"/"inference.py").is_file():raise ValueError("external/seed-vcのあるモデル保存先を選んでください")
            self.model_root=root
            (self.data/"runtime.json").write_text(json.dumps(dict(python=sys.executable,modelRoot=str(root))),encoding="utf-8")
            return True
        if action=="importReference":self.idle();return self.import_reference(payload["path"])
        if action=="previewReference":
            self.idle();path=self.reference(payload["reference"],payload.get("projectDir"))
            info=sf.info(path);samples,rate=sf.read(path,dtype="float32",always_2d=True,frames=min(info.frames,info.samplerate*2))
            from scipy.signal import resample_poly
            from math import gcd
            g=gcd(rate,16000);mono=resample_poly(samples.mean(axis=1),16000//g,rate//g)
            output=io.BytesIO();sf.write(output,mono,16000,format="WAV",subtype="PCM_16")
            return base64.b64encode(output.getvalue()).decode("ascii")
        if action=="importProfile":return self.import_profile(payload["path"])
        if action=="readFilters":
            self.idle();path=Path(payload["path"])
            if path.stat().st_size>65536:raise ValueError("フィルタ設定が大きすぎます")
            return validate_chain(json.loads(path.read_text(encoding="utf-8-sig")))
        if action=="saveFilters":
            self.idle();value=validate_chain(payload["filters"]);path=Path(payload["path"]).resolve()
            if path.exists():raise ValueError("同じ名前のファイルがあります。別の名前を選んでください")
            path.write_text(json.dumps(value,ensure_ascii=False,indent=2),encoding="utf-8");return True
        if action=="persistReferences":
            key=payload["reference"]
            if key=="builtin":return True
            source=self.reference(key,payload.get("sourceDir"));target=Path(payload["targetDir"]).resolve()/key
            target.parent.mkdir(parents=True,exist_ok=True)
            if source.resolve()!=target.resolve():shutil.copyfile(source,target)
            return True
        if action=="start":
            self.idle();self.project_dir=payload.get("projectDir");path=self.normalize(payload["profile"],self.project_dir)
            self.speech.release();self.source="microphone"
            self.engine=LiveEngine();self.session=uuid.uuid4().hex
            self.engine.input_gain_db=finite_number(payload.get("inputGainDb",0),-12,24)
            self.engine.mute=bool(payload.get("mute",False));self.engine.bypass=False
            self.engine.start(path,self.device(payload["inputDeviceId"],"inputs"),self.device(payload["outputDeviceId"],"outputs"),self.data/"voice-model.log")
            return dict(sessionId=self.session)
        if action=="controls":
            allowed={"voiceTone","outputFilters","inputGainDb","mute","bypass"}
            if set(payload)-allowed:raise ValueError("未対応の実行中調整です")
            if "voiceTone" in payload:self.engine.voice_tone=validate_tone(payload["voiceTone"])
            if "outputFilters" in payload:self.engine.filter_config=validate_chain(payload["outputFilters"])
            if "inputGainDb" in payload:self.engine.input_gain_db=finite_number(payload["inputGainDb"],-12,24)
            for key in ("mute","bypass"):
                if key in payload:
                    if not isinstance(payload[key],bool):raise ValueError("出力状態が不正です")
                    setattr(self.engine,key,payload[key])
                    if key=="mute":self.speech.mute=payload[key]
            return True
        if action=="stop":
            self.speech.stop()
            self.engine.stop()
            self.job_cancel.set()
            if self.job:stop_owned_process(self.job)
            if not self.engine.wait(20):raise RuntimeError("音声プロセスの停止を確認できません")
            if self.job_thread:self.job_thread.join(20)
            if self.job_thread and self.job_thread.is_alive():raise RuntimeError("WAV変換の停止を確認できません")
            self.engine.playback=queue.Queue(maxsize=128)
            self.emit(self.status());return True
        if action=="exportProfile":
            self.idle();profile=self.normalize(payload["profile"],payload.get("projectDir"))
            destination=Path(payload["path"]).resolve()
            if destination.exists():raise ValueError("同じ名前のファイルがあります。別の名前を選んでください")
            value=read_profile(profile)
            reference=Path(value["reference"])
            ref_target=destination.with_suffix(".reference.wav")
            if ref_target.exists():raise ValueError("参照WAVと同じ名前のファイルがあります")
            shutil.copyfile(reference,ref_target);value["reference"]=ref_target.name
            destination.write_text(json.dumps(value,ensure_ascii=False,indent=2),encoding="utf-8");return True
        if action=="convert":
            self.idle();profile=self.normalize(payload["profile"],payload.get("projectDir"))
            self.speech.release()
            self.job_cancel.clear()
            source=Path(payload["source"]).resolve();output=Path(payload["output"]).resolve()
            if output.exists():raise ValueError("同じ名前の出力ファイルがあります。別の名前を選んでください")
            temporary=output.with_name(".voice-"+uuid.uuid4().hex+".wav")
            def run():
                try:
                    with (self.data/"voice-convert.log").open("ab") as log:
                        if self.job_cancel.is_set():return
                        self.job=subprocess.Popen([sys.executable,"-X","utf8","-u",str(ROOT/"worker.py"),"--profile",str(profile),"--source",str(source),"--output",str(temporary)],stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=log,creationflags=subprocess.CREATE_NO_WINDOW if sys.platform=="win32" else 0)
                        if self.job_cancel.is_set():stop_owned_process(self.job)
                        result=self.job.communicate(timeout=1800)[0]
                        if self.job.returncode:raise RuntimeError(result.decode("utf-8",errors="replace")[-3000:] or "WAVの変換に失敗しました")
                        if self.job_cancel.is_set():raise RuntimeError("cancelled")
                        if output.exists():raise ValueError("変換中に同じ名前のファイルが作られました。別の保存先を選んでください")
                        temporary.rename(output)
                        self.emit(dict(kind="converted",output=str(output)))
                except Exception as error:
                    if self.job and self.job.poll() is None:stop_owned_process(self.job)
                    if self.job_cancel.is_set():self.emit(dict(kind="conversionCancelled"))
                    else:self.emit(dict(kind="conversionError",error=str(error)))
                finally:
                    temporary.unlink(missing_ok=True)
                    temporary.with_suffix(".metrics.json").unlink(missing_ok=True)
                    self.job=None
            self.job_thread=threading.Thread(target=run,daemon=True);self.job_thread.start();return True
        raise ValueError("未対応の音声操作です")

    def events(self):
        last=0
        try:
            while not self.closed.wait(.005):
                engine=self.engine
                for seq,start,dac_ms,samples in self.speech.poll():
                    if self.source!="speech" or self.speech.state=="stopping":continue
                    if time.perf_counter()*1000-dac_ms>150:continue
                    self.emit(dict(kind="playback",sessionId=self.speech.session,sequence=seq,sourceStartSample=start,
                        playbackTimeMs=dac_ms,sampleRate=48000,pcm=base64.b64encode(samples.astype("<f4").tobytes()).decode("ascii")))
                # The real device clock supplies the timestamp of this FINAL PCM,
                # after drift correction, mute/bypass ramps, and output protection.
                for _ in range(16):
                    try:seq,start,dac_ms,samples=engine.playback.get_nowait()
                    except queue.Empty:break
                    if engine is not self.engine or engine.stop_event.is_set():continue
                    if time.perf_counter()*1000-dac_ms>150:continue
                    self.emit(dict(kind="playback",sessionId=self.session,sequence=seq,sourceStartSample=start,
                        playbackTimeMs=dac_ms,sampleRate=48000,pcm=base64.b64encode(samples.astype("<f4").tobytes()).decode("ascii")))
                now=time.perf_counter()
                if now-last>=.1:self.emit(self.status());last=now
        except (BrokenPipeError,OSError):self.closed.set();self.engine.stop()

    def close(self):
        self.closed.set();self.engine.stop()
        self.speech.stop()
        self.speech.release()
        self.job_cancel.set()
        if self.job:stop_owned_process(self.job)
        self.engine.wait(20)


def main():
    parser=argparse.ArgumentParser();parser.add_argument("--data",required=True);parser.add_argument("--model-root")
    args=parser.parse_args();host=Host(args.data,args.model_root)
    try:
        while True:
            line=sys.stdin.buffer.readline(65537)
            if not line:break
            request={}
            try:
                if len(line)>65536:raise ValueError("音声操作のデータが大きすぎます")
                request=json.loads(line.decode("utf-8"));value=host.request(request["action"],request.get("payload",{}))
                host.emit(dict(kind="response",id=request["id"],ok=True,value=value))
            except Exception as error:host.emit(dict(kind="response",id=request.get("id",0),ok=False,error=str(error)))
    finally:host.close()


if __name__=="__main__":main()
