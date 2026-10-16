"""WASAPI I/O separated from the model process; bounded queues and fail closed."""
from __future__ import annotations
import json
import copy
from pathlib import Path
import struct
import subprocess
import sys
import threading
import time
import queue

import numpy as np
import sounddevice as sd
from worker import read_exact
from backend import read_profile
from audio_processing import PeakGuard
from processes import stop_owned_process


class Ring:
    """One writer / one reader. Publish the counter only after the PCM copy."""
    def __init__(self, capacity=48000*4, channels=1):
        self.capacity=capacity
        self.data=np.zeros((capacity,channels),np.float32)
        self.w=self.r=0

    @property
    def count(self): return self.w-self.r

    def write(self, samples):
        n=len(samples)
        if n > self.capacity-self.count: return False
        start=self.w % self.capacity
        first=min(n,self.capacity-start)
        self.data[start:start+first]=np.asarray(samples[:first]).reshape(first,-1)
        if n>first: self.data[:n-first]=np.asarray(samples[first:]).reshape(n-first,-1)
        self.w += n
        return True

    def take(self,n):
        if self.count<n: return None
        start=self.r % self.capacity
        first=min(n,self.capacity-start)
        result=np.empty((n,self.data.shape[1]),np.float32)
        result[:first]=self.data[start:start+first]
        if n>first: result[first:]=self.data[:n-first]
        self.r += n
        return result


class WorkerClient:
    def __init__(self, profile_path, log_path, worker_script=None):
        self.log=open(log_path,"ab",buffering=0)
        flags=subprocess.CREATE_NO_WINDOW if sys.platform=="win32" else 0
        self.process=subprocess.Popen([sys.executable,"-X","utf8","-u",str(worker_script or Path(__file__).with_name("worker.py")),
            "--stream","--profile",str(profile_path)], stdin=subprocess.PIPE,stdout=subprocess.PIPE,
            stderr=self.log,creationflags=flags,bufsize=0)
        self.sequence=0
        self.descendants=[]

    def message(self):
        line=self.process.stdout.readline(8193)
        if not line or len(line)>8192:
            raise RuntimeError("推論workerの応答がありません。ログを確認してください")
        meta=json.loads(line.decode("utf-8"))
        if "error" in meta: raise RuntimeError(meta["error"])
        return meta

    def ready(self):
        meta=self.message()
        if not meta.get("ready"): raise RuntimeError("モデルの準備に失敗しました")
        return meta

    def convert(self,audio):
        packet=struct.pack("<II",self.sequence,len(audio))+np.asarray(audio,dtype="<f4").tobytes()
        view=memoryview(packet)
        while view:
            written=self.process.stdin.write(view)
            if not written:raise EOFError("推論プロセスへの送信が終了しました")
            view=view[written:]
        self.process.stdin.flush()
        meta=self.message()
        n=meta.get("frames",0)
        if meta.get("sequence")!=self.sequence or not 1<=n<=48000*3:
            raise RuntimeError("推論音声の順序または長さが不正です")
        result=np.frombuffer(read_exact(self.process.stdout,n*4),dtype="<f4").copy()
        if not np.isfinite(result).all(): raise RuntimeError("推論音声が不正です")
        self.sequence += 1
        return result,meta

    def update_tone(self, tone):
        self.send_control(tone)

    def update_filters(self, config):
        self.send_control({"filters": config})

    def send_control(self, value):
        payload=json.dumps(value,ensure_ascii=False).encode("utf-8")
        if not 1<=len(payload)<=8192:raise ValueError("調整データが大きすぎます")
        packet=struct.pack("<II",0xffffffff,len(payload))+payload
        view=memoryview(packet)
        while view:
            written=self.process.stdin.write(view)
            if not written: raise EOFError("声質調整の送信が終了しました")
            view=view[written:]
        self.process.stdin.flush()
        if not self.message().get("control"): raise RuntimeError("声質調整に失敗しました")

    def cancel(self):
        self.descendants.extend(stop_owned_process(self.process))

    def close(self):
        self.cancel()
        self.process.wait(timeout=10)
        self.process.stdin.close(); self.process.stdout.close(); self.log.close()
        if self.descendants:
            import psutil
            _,alive=psutil.wait_procs(self.descendants,timeout=5)
            if alive:raise RuntimeError("推論プロセスの終了を確認できません")


def devices():
    hosts=sd.query_hostapis()
    wasapi=next(i for i,h in enumerate(hosts) if h["name"]=="Windows WASAPI")
    all_devices=sd.query_devices()
    inputs=[(i,d) for i,d in enumerate(all_devices) if d["hostapi"]==wasapi and d["max_input_channels"]>0]
    outputs=[(i,d) for i,d in enumerate(all_devices) if d["hostapi"]==wasapi and d["max_output_channels"]>0]
    return inputs,outputs,hosts[wasapi]


class LiveEngine:
    def __init__(self):
        self.stop_event=threading.Event()
        self.thread=None
        self.client=None
        self.state="stopped"
        self.error=""
        self.mute=False
        self.bypass=False
        self.input_gain_db=0.0
        self.voice_tone=None
        self.filter_config=None
        self.input_ring=Ring()
        self.output_ring=Ring(capacity=48000*8,channels=2)
        self.stats={"blocks":0,"underruns":0,"overflows":0,"inputStatus":0,"outputStatus":0,
            "inputPeak":0.0,"outputPeak":0.0,"processingMs":0.,"maxProcessingMs":0.,"streamRtf":0.,
            "vramMiB":0.,"queueFrames":0,"estimatedMs":0.,"limitedSamples":0,"runningSeconds":0.}
        self.stats.update(maxInputCallbackGapMs=0.,maxOutputCallbackGapMs=0.,capturedFrames=0,renderedFrames=0)
        self.last_input_callback=None;self.last_output_callback=None
        self.primed=False
        self.ratio=1.0
        self.fraction=0.0
        self.mute_mix=1.
        self.bypass_mix=0.
        self.start_mix=0.
        self.play_at=None
        self.target_lag=None
        self.last_input_callback=None;self.last_output_callback=None
        self.jitter_seconds=1.0
        self.device_latency_ms=0.
        self.min_capture_frames=0
        self.output_guard=PeakGuard()
        # Only copies and timestamps in the callback. Encoding/IPC is in host.py.
        self.playback=queue.Queue(maxsize=128)
        self.playback_sequence=0

    def start(self,profile,input_device,output_device,log_path):
        if self.thread and self.thread.is_alive(): raise RuntimeError("音声はすでに実行中です")
        read_profile(profile)
        sd.check_input_settings(device=input_device,channels=1,samplerate=48000,dtype="float32")
        self.output_channels=min(2,int(sd.query_devices(output_device)["max_output_channels"]))
        sd.check_output_settings(device=output_device,channels=self.output_channels,samplerate=48000,dtype="float32")
        self.stop_event.clear(); self.state="starting"; self.error=""
        self.input_ring=Ring(); self.output_ring=Ring(capacity=48000*8,channels=2)
        self.primed=False; self.fraction=0; self.ratio=1
        self.mute_mix=0. if self.mute else 1.
        self.bypass_mix=1. if self.bypass else 0.
        self.start_mix=0.
        self.play_at=None
        self.target_lag=None
        self.output_guard=PeakGuard()
        self.playback=queue.Queue(maxsize=128)
        self.playback_sequence=0
        for key in self.stats: self.stats[key]=0
        self.thread=threading.Thread(target=self.run,args=(Path(profile),input_device,output_device,Path(log_path)),daemon=True)
        self.thread.start()

    def input_callback(self,indata,frames,times,status):
        if self.stop_event.is_set(): return
        now=time.perf_counter()
        if self.last_input_callback is not None:self.stats["maxInputCallbackGapMs"]=max(self.stats["maxInputCallbackGapMs"],(now-self.last_input_callback)*1000)
        self.last_input_callback=now
        if status: self.stats["inputStatus"] += 1
        self.stats["inputPeak"]=float(np.max(np.abs(indata)))
        if not self.input_ring.write(indata):
            self.stats["overflows"]+=1
            self.error="入力キューが一杯です。品質設定の処理速度を確認してください"
            self.stop_event.set()
        self.stats["capturedFrames"]=self.input_ring.w

    def output_callback(self,outdata,frames,times,status):
        outdata.fill(0)
        if self.stop_event.is_set(): return
        now=time.perf_counter()
        if self.last_output_callback is not None:self.stats["maxOutputCallbackGapMs"]=max(self.stats["maxOutputCallbackGapMs"],(now-self.last_output_callback)*1000)
        self.last_output_callback=now
        if status: self.stats["outputStatus"]+=1
        available=self.output_ring.count
        if not self.primed:
            if available < self.hop: return
            if self.play_at is None:self.play_at=time.perf_counter()+self.jitter_seconds
            if time.perf_counter()<self.play_at:return
            # Skipped nonspeech inference is much faster than a voiced block.
            # Keep enough source-time slack for a full-hop processing budget,
            # even when startup happened in silence. Otherwise the first later
            # voiced block could miss its playback deadline.
            if self.input_ring.w < self.min_capture_frames:return
            self.primed=True; self.state="running"
            self.target_lag=float(self.input_ring.w-self.output_ring.r)-self.fraction
        # Independent device clocks: bounded fractional interpolation. 4 taps,
        # no per-block phase reset. GPU work is never done in this callback.
        # Use source timestamps to correct device clocks. Queue size jumps by
        # a whole model block and is not a clock-drift measurement.
        self.correct_clock()
        positions=self.fraction+np.arange(frames)*self.ratio
        indexes=positions.astype(np.int64)
        consume=int(self.fraction+frames*self.ratio)
        if available < max(consume+3,int(indexes[-1])+3):
            self.stats["underruns"]+=1
            self.stats["starvedFrames"]=available
            self.stats["stalledOperation"]=self.stats.get("activeOperation",0)
            self.stats["stalledOperationMs"]=max(0.,time.perf_counter()*1000-self.stats.get("operationStartedMs",time.perf_counter()*1000))
            self.error="出力が追いつきません。音声を停止して遅延・品質設定を見直してください"
            self.stop_event.set()
            return
        ring=self.output_ring
        base=ring.r
        a=ring.data[(base+indexes-1)%ring.capacity]
        b=ring.data[(base+indexes)%ring.capacity]
        c=ring.data[(base+indexes+1)%ring.capacity]
        d=ring.data[(base+indexes+2)%ring.capacity]
        u=(positions-indexes).astype(np.float32)[:,None]
        values=b + .5*u*(c-a+u*(2*a-5*b+4*c-d+u*(3*(b-c)+d-a)))
        ring.r += consume
        self.stats["renderedFrames"]=ring.r
        self.fraction=self.fraction+frames*self.ratio-consume
        ramp=np.arange(1,frames+1,dtype=np.float32)
        mute=np.clip(self.mute_mix + np.clip((0. if self.mute else 1.)-self.mute_mix,-1/480,1/480)*ramp,0,1)
        by=np.clip(self.bypass_mix + np.clip((1. if self.bypass else 0.)-self.bypass_mix,-1/480,1/480)*ramp,0,1)
        self.mute_mix=float(mute[-1]); self.bypass_mix=float(by[-1])
        startup=np.clip(self.start_mix+ramp/960,0,1); self.start_mix=float(startup[-1])
        mono=(values[:,0]*(1-by)+values[:,1]*by)*mute*startup
        mono=self.output_guard.process(mono)
        self.stats["outputPeakProtectionDb"]=self.output_guard.reduction_db
        outdata[:,0]=mono
        if outdata.shape[1]>1: outdata[:,1]=mono
        self.stats["outputPeak"]=float(np.max(np.abs(mono)))
        self.stats["queueFrames"]=ring.count
        # Both cursors refer to source samples. Do not count inference time,
        # acquisition and the same queued audio twice.
        self.stats["estimatedMs"]=max(0.,(self.input_ring.w-ring.r-self.fraction)/48)+self.device_latency_ms
        if hasattr(times,"outputBufferDacTime") and hasattr(times,"currentTime"):
            dac_ms=(time.perf_counter()+times.outputBufferDacTime-times.currentTime)*1000
        else:
            dac_ms=time.perf_counter()*1000
        try:
            self.playback.put_nowait((self.playback_sequence,base,dac_ms,mono.astype(np.float32,copy=True)))
        except queue.Full:
            self.stats["analysisDrops"]=self.stats.get("analysisDrops",0)+1
        self.playback_sequence+=1

    def correct_clock(self):
        lag=float(self.input_ring.w-self.output_ring.r)-self.fraction
        if self.target_lag is None:self.target_lag=lag
        error=lag-self.target_lag
        desired=1+max(-.001,min(.001,error/(48000*20)))
        self.ratio += (desired-self.ratio)*.005

    def prepare_input(self, raw):
        prepared=raw*(10**(self.input_gain_db/20))
        self.stats["inputGainPeak"]=float(np.max(np.abs(prepared)))
        power=float(np.mean(prepared.astype(np.float64)**2))
        self.stats["inputGainRmsDb"]=10*np.log10(max(power,1e-12))
        self.stats["inputOverSamples"]=self.stats.get("inputOverSamples",0)+int(np.count_nonzero(np.abs(prepared)>=1))
        return prepared

    def run(self,profile,input_device,output_device,log_path):
        from execution_lock import ExecutionLock
        import ctypes
        ole=ctypes.WinDLL("ole32")
        hr=ole.CoInitializeEx(None,0)
        try:
            if hr not in (0,1):raise OSError(f"音声スレッドのCOM初期化失敗: {hr:#x}")
            with ExecutionLock("Local\\VoiceChanger-Audio-v1"):
                self.run_owned(profile,input_device,output_device,log_path)
        except Exception as error:
            self.error=str(error);self.state="error";self.stop_event.set()
        finally:
            if hr in (0,1):ole.CoUninitialize()

    def run_owned(self,profile,input_device,output_device,log_path):
        started=None
        try:
            log_path.parent.mkdir(parents=True,exist_ok=True)
            self.client=WorkerClient(profile,log_path)
            ready=self.client.ready()
            self.hop=ready["hopFrames"]; future=ready["lookaheadFrames"]
            self.min_capture_frames=int(ready.get("minimumCaptureFrames",2*self.hop+future))
            self.jitter_seconds=float(ready.get("jitterSeconds",1.0))
            self.stats["loadSeconds"]=ready["loadSeconds"]
            self.stats["cudaGraph"]=int(bool(ready.get("cudaGraph",False)))
            if self.stop_event.is_set(): return
            first=True
            sent_tone=None
            sent_filters=None
            dry_pending=np.zeros(0,np.float32)
            with sd.InputStream(device=input_device,channels=1,samplerate=48000,dtype="float32",
                    blocksize=480,latency="low",callback=self.input_callback) as capture, \
                 sd.OutputStream(device=output_device,channels=self.output_channels,samplerate=48000,dtype="float32",
                    blocksize=480,latency="low",callback=self.output_callback) as render:
                self.device_latency_ms=(capture.latency+render.latency)*1000
                started=time.perf_counter()
                while not self.stop_event.is_set():
                    count=self.hop+future if first else self.hop
                    raw=self.input_ring.take(count)
                    if raw is None:
                        self.stop_event.wait(.005)
                        continue
                    raw=raw[:,0]
                    if not np.isfinite(raw).all(): raise RuntimeError("マイク入力が不正です")
                    dry_pending=np.concatenate([dry_pending,raw])
                    prepared=self.prepare_input(raw)
                    control_started=time.perf_counter()
                    self.stats["activeOperation"]=1
                    self.stats["operationStartedMs"]=control_started*1000
                    tone=self.voice_tone
                    if tone is not None and tone!=sent_tone:
                        self.client.update_tone(tone)
                        sent_tone=dict(tone)
                    filters=self.filter_config
                    if filters is not None and filters!=sent_filters:
                        snapshot=copy.deepcopy(filters)
                        self.client.update_filters(snapshot)
                        sent_filters=snapshot
                    self.stats["controlMs"]=(time.perf_counter()-control_started)*1000
                    self.stats["maxControlMs"]=max(self.stats.get("maxControlMs",0),self.stats["controlMs"])
                    roundtrip_started=time.perf_counter()
                    self.stats["activeOperation"]=2
                    self.stats["operationStartedMs"]=roundtrip_started*1000
                    y,metrics=self.client.convert(prepared)
                    self.stats["roundtripMs"]=(time.perf_counter()-roundtrip_started)*1000
                    self.stats["maxRoundtripMs"]=max(self.stats.get("maxRoundtripMs",0),self.stats["roundtripMs"])
                    self.stats["activeOperation"]=0
                    if self.stop_event.is_set(): break
                    if metrics["sourceStartSample"]!=self.stats["blocks"]*self.hop:
                        raise RuntimeError("音声の時刻が一致しません")
                    paired=np.column_stack([y,dry_pending[:self.hop]])
                    dry_pending=dry_pending[self.hop:]
                    if not self.output_ring.write(paired): raise RuntimeError("出力キューが一杯です")
                    self.stats["blocks"]+=1
                    for key in ("processingMs","streamRtf","vramMiB","cleanupMs","inferenceMs","postprocessingMs","outputGainReductionDb"):
                        if key in metrics:self.stats[key]=metrics[key]
                    self.stats["speechProbability"]=metrics.get("speechProbability",0.)
                    self.stats["speechFraction"]=metrics.get("speechFraction",1.)
                    self.stats["limitedSamples"]+=metrics["limitedSamples"]
                    self.stats["maxProcessingMs"]=max(self.stats["maxProcessingMs"],metrics["processingMs"])
                    self.stats["runningSeconds"]=time.perf_counter()-started
                    first=False
        except Exception as error:
            if not self.stop_event.is_set(): self.error=str(error)
        finally:
            self.stop_event.set()
            if self.client:
                self.client.close(); self.client=None
            self.state="error" if self.error else "stopped"

    def stop(self):
        self.stop_event.set()
        if self.client: self.client.cancel()

    def wait(self,timeout=20):
        if self.thread: self.thread.join(timeout)
        return not self.thread or not self.thread.is_alive()
