# SPDX-License-Identifier: GPL-3.0-or-later
"""Cancelable child generation and fixed-rate output independent of the mic."""
import json,subprocess,tempfile,threading,queue,time,ctypes,uuid
from math import gcd
from pathlib import Path
import numpy as np
import soundfile as sf
import sounddevice as sd
from scipy.signal import resample_poly
from audio_processing import ToneProcessor
from audio_processing import PeakGuard
from filter_chain import FilterChain
from processes import stop_owned_process
from speech_stream_protocol import read_packet
from speech_stream_audio import SpeechStreamProcessor

def prepare_audio(audio,rate,profile,apply_filters):
    audio=np.asarray(audio,dtype=np.float32)
    if audio.ndim!=1 or not np.isfinite(audio).all() or not .1<=len(audio)/rate<120:raise ValueError("読み上げ音声が不正です")
    if rate!=48000:
        divisor=gcd(rate,48000);audio=resample_poly(audio,48000//divisor,rate//divisor).astype(np.float32)
    if apply_filters:audio=FilterChain(profile.get("outputFilters")).process(ToneProcessor(profile.get("voiceTone")).process(audio))
    audio*=10**(profile.get("outputGainDb",-3)/20)
    audio=PeakGuard().process(audio)
    n=min(240,len(audio)//2);fade=np.linspace(0,1,n,dtype=np.float32)
    audio[:n]*=fade;audio[-n:]*=fade[::-1]
    return audio

class SpeechJob:
    def __init__(self,data,events):
        self.data=Path(data);self.events=events;self.cancelled=threading.Event()
        self.process=None;self.thread=None;self.log=None;self.identity='';self.delivery='whole';self.write_lock=threading.Lock()
    def start(self,python,cache,request,profile):
        if self.thread and self.thread.is_alive():raise RuntimeError("読み上げを生成中です")
        self.cancelled.clear();self.identity=uuid.uuid4().hex;self.delivery=request['preferences'].get('delivery','whole')
        self.thread=threading.Thread(target=self.run,args=(python,cache,request,profile),daemon=True);self.thread.start()
    def put(self,event):
        event={**event,'jobId':self.identity}
        while not self.cancelled.is_set():
            try:self.events.put(event,timeout=.05);return
            except queue.Full:pass
    def command(self,value):
        with self.write_lock:
            payload=(json.dumps(value)+'\n').encode('utf-8');view=memoryview(payload)
            while view:
                count=self.process.stdin.write(view)
                if not count:raise EOFError('読み上げプロセスが終了しました')
                view=view[count:]
            self.process.stdin.flush()
    def run(self,python,cache,request,profile):
        try:
            temporary_root=self.data/"speech-temp";temporary_root.mkdir(parents=True,exist_ok=True)
            with tempfile.TemporaryDirectory(dir=temporary_root) as directory:
                folder=Path(directory);source=folder/"request.json";output=folder/"speech.wav"
                source.write_text(json.dumps(request,ensure_ascii=False),encoding="utf-8")
                log=self.data/"logs"/"speech.log";log.parent.mkdir(parents=True,exist_ok=True)
                if self.cancelled.is_set():return
                if self.process is None or self.process.poll() is not None:
                    self.release()
                    self.log=open(log,"ab")
                    self.process=subprocess.Popen([str(python),"-X","utf8","-u",str(Path(__file__).with_name("speech_worker.py")),
                        "--cache",str(cache),"--stream-serve"],stdin=subprocess.PIPE,
                        stdout=subprocess.PIPE,stderr=self.log,creationflags=subprocess.CREATE_NO_WINDOW,bufsize=0)
                if self.cancelled.is_set():self.release();return
                self.command(dict(action='generate',id=self.identity,request=str(source),output=str(output)))
                processor=SpeechStreamProcessor(profile,request['preferences']['applyFilters']) if self.delivery=='stream' else None
                sequence=0;position=0
                while True:
                    packet,audio=read_packet(self.process.stdout)
                    if 'error' in packet and 'id' not in packet:raise RuntimeError(packet['error'])
                    if packet.get('id')!=self.identity:raise ValueError('読み上げ応答の識別子が異なります')
                    event=packet.get('event')
                    if event=='pcm':
                        if processor is None or packet.get('sequence')!=sequence or packet.get('startSample')!=position or packet.get('sampleRate')!=24000:
                            raise ValueError('逐次音声の順序・形式が不正です')
                        sequence+=1;position+=len(audio)
                        if position>24000*120:raise ValueError('生成音声が長すぎます')
                        if not self.cancelled.is_set():self.put(dict(speechChunk=True,audio=processor.feed(audio),text=request['text'],producedAt=packet.get('producedAt')))
                    elif event=='complete':
                        if self.cancelled.is_set():return
                        meta=packet['meta']
                        if processor:
                            if position<2400:raise ValueError('生成音声が短すぎます')
                            # Tail and end are one event, so the output callback
                            # cannot mistake the final few samples for starvation.
                            self.put(dict(speechEnd=True,audio=processor.finish(),meta=meta))
                        else:
                            audio,rate=sf.read(output,dtype='float32')
                            audio=prepare_audio(audio,rate,profile,request['preferences']['applyFilters'])
                            self.put(dict(speechReady=True,audio=audio,meta=meta,text=request['text']))
                        return
                    elif event=='cancelled':return
                    elif event=='error':raise RuntimeError(packet.get('error','読み上げに失敗しました'))
                    else:raise ValueError('読み上げ応答が不正です')
        except Exception as error:
            self.release()
            self.put({"speechError":str(error)})
    def cancel(self):
        self.cancelled.set()
        if self.process:
            if self.delivery=='stream':
                if self.active():
                    try:self.command(dict(action='cancel',id=self.identity))
                    except (OSError,AttributeError):pass
            else:stop_owned_process(self.process)
        if not self.active() and self.delivery!='stream':self.release()
    def release(self):
        if self.process:
            process=self.process;self.process=None
            children=stop_owned_process(process) if process.poll() is None else []
            process.wait(timeout=5)
            if children:
                import psutil
                _,alive=psutil.wait_procs(children,timeout=5)
                if alive:raise RuntimeError("読み上げプロセスの終了を確認できません")
            for pipe in (process.stdin,process.stdout):
                if pipe:pipe.close()
        if self.log:self.log.close();self.log=None
    def active(self):return bool(self.thread and self.thread.is_alive())
    def resident(self):return self.process is not None and self.process.poll() is None

class SpeechPlayer:
    """Only this output stream is owned; mute remains live during playback."""
    def __init__(self,audio,device,channels,muted):
        self.audio=audio;self.position=0;self.done=False;self.error="";self.peak=0.;self.muted=muted;self.mix=0. if muted() else 1.
        self.stream=None;self.lock=None
        self.playback=queue.Queue(maxsize=128);self.sequence=0;self.last_dac_ms=0.;self.first_audio_dac_ms=None;self.first_audio_wall_ms=None
        self.audio_clock_offset_ms=None
        self.clock_corrections=0
        self.unlock=threading.Event();self.lock_ready=threading.Event();self.lock_error=None
        from execution_lock import ExecutionLock
        try:
            # WASAPIのCOMとWindows mutexを同じ音声スレッドで所有する。
            # GUI由来の元実装をRPC/monitorスレッドへ直接移さない。
            def own_audio():
                ole=ctypes.WinDLL("ole32");hr=ole.CoInitializeEx(None,0)
                try:
                    if hr not in (0,1):raise OSError(f"音声スレッドのCOM初期化失敗: {hr:#x}")
                    with ExecutionLock("Local\\VoiceChanger-Audio-v1"):
                        try:
                            self.stream=sd.OutputStream(device=device,samplerate=48000,channels=channels,dtype="float32",blocksize=480,
                                latency=.04,callback=self.callback,finished_callback=self.finished)
                            before=time.perf_counter()*1000;device_time=self.stream.time*1000;after=time.perf_counter()*1000
                            self.audio_clock_offset_ms=(before+after)/2-device_time
                            if not self.unlock.is_set():self.stream.start()
                            self.lock_ready.set();self.unlock.wait()
                        finally:
                            if self.stream:
                                try:self.stream.abort()
                                finally:self.stream.close();self.stream=None
                except Exception as error:
                    self.lock_error=error;self.error=str(error);self.done=True
                finally:
                    if hr in (0,1):ole.CoUninitialize()
                    self.lock_ready.set()
            self.lock_thread=threading.Thread(target=own_audio,daemon=True);self.lock_thread.start()
            if not self.lock_ready.wait(5):raise RuntimeError("音声出力のロックを確認できません")
            if self.lock_error:raise self.lock_error
        except Exception:
            self.close();raise
    def dac_time(self,times):
        # Map the device clock once. Python/GIL scheduling delays must not be
        # added anew to each callback's already-stamped hardware DAC time.
        if getattr(self,'audio_clock_offset_ms',None) is None:
            self.audio_clock_offset_ms=time.perf_counter()*1000-times.currentTime*1000
        dac=self.audio_clock_offset_ms+times.outputBufferDacTime*1000
        # Some WASAPI estimates briefly overlap/backtrack even on a stable
        # clock. Consecutive submitted buffers physically play in sample order.
        end=getattr(self,'last_dac_ms',dac)
        if dac<end:
            self.clock_corrections=getattr(self,'clock_corrections',0)+1
            dac=end
        return dac
    def callback(self,out,frames,times,status):
        out.fill(0)
        if self.unlock.is_set():raise sd.CallbackAbort
        if status:self.error="読み上げの音声出力に不足・デバイス異常を検出しました";raise sd.CallbackAbort
        count=min(frames,len(self.audio)-self.position)
        if count:
            goal=0. if self.muted() else 1.
            ramp=np.clip(self.mix+np.clip(goal-self.mix,-1/480,1/480)*np.arange(1,count+1),0,1)
            mono=self.audio[self.position:self.position+count]*ramp;self.mix=float(ramp[-1])
            out[:count,:]=mono[:,None];self.peak=float(np.max(np.abs(mono)));self.position+=count
        # 口の解析には、Muteを含めて実際に出力するPCMとDAC時刻を渡す。
        dac=self.dac_time(times)
        if count and self.first_audio_dac_ms is None:
            self.first_audio_dac_ms=dac
            self.first_audio_wall_ms=time.time()*1000+dac-time.perf_counter()*1000
        self.last_dac_ms=dac+frames/48
        try:self.playback.put_nowait((self.sequence,self.position-count,dac,out[:,0].copy()))
        except queue.Full:pass
        self.sequence+=1
        if self.position>=len(self.audio):raise sd.CallbackStop
    def finished(self):self.done=True
    def close(self):
        self.unlock.set()
        if self.lock_thread:
            self.lock_thread.join(5)
            if self.lock_thread.is_alive():raise RuntimeError("読み上げ出力の停止を確認できません")
        self.done=True

class SpeechStreamPlayer(SpeechPlayer):
    """Finite ring; pauses on starvation and resumes after buffering, without skipping PCM."""
    def __init__(self,device,channels,muted):
        self.ring=np.zeros(48000*8,np.float32);self.read=0;self.write=0;self.available=0
        self.ring_lock=threading.Lock();self.ended=False;self.priming=True;self.rebuffers=0
        self.continuity=1.
        super().__init__(np.empty(0,np.float32),device,channels,muted)
    def append(self,audio,ended=False):
        with self.ring_lock:
            n=len(audio)
            if n>len(self.ring)-self.available:return False
            first=min(n,len(self.ring)-self.write)
            self.ring[self.write:self.write+first]=audio[:first]
            self.ring[:n-first]=audio[first:]
            self.write=(self.write+n)%len(self.ring);self.available+=n
            if ended:self.ended=True
            return True
    def callback(self,out,frames,times,status):
        out.fill(0)
        if self.unlock.is_set():raise sd.CallbackAbort
        if status:self.error='読み上げの音声デバイス異常を検出しました';raise sd.CallbackAbort
        start=self.position
        with self.ring_lock:
            if self.priming and (self.available>=48000 or self.ended):self.priming=False
            count=0 if self.priming else min(frames,self.available)
            if count:
                first=min(count,len(self.ring)-self.read)
                mono=np.concatenate((self.ring[self.read:self.read+first],self.ring[:count-first]))
                goal=0. if self.muted() else 1.
                ramp=np.clip(self.mix+np.clip(goal-self.mix,-1/480,1/480)*np.arange(1,count+1),0,1)
                # Fade only the last 5 ms before an unexpected empty ring, and
                # ramp back if more PCM arrives. Sample order/count stay intact.
                recovery=np.minimum(1.,self.continuity+np.arange(1,count+1)/240)
                tail=np.ones(count) if self.ended else np.clip((self.available-np.arange(1,count+1))/240,0,1)
                continuity=np.minimum(recovery,tail);self.continuity=float(continuity[-1])
                mono=mono*ramp*continuity;self.mix=float(ramp[-1])
                out[:count,:]=mono[:,None]
                self.read=(self.read+count)%len(self.ring);self.available-=count
            if count<frames and not self.ended and not self.priming:
                # Gate at zero and collect a full second before resuming. No token/PCM is dropped.
                self.priming=True;self.rebuffers+=1;self.mix=0.
            complete=self.ended and self.available==0
        self.peak=float(np.max(np.abs(out)));self.position+=frames
        dac=self.dac_time(times)
        if count and self.first_audio_dac_ms is None:
            self.first_audio_dac_ms=dac
            self.first_audio_wall_ms=time.time()*1000+dac-time.perf_counter()*1000
        self.last_dac_ms=dac+frames/48
        try:self.playback.put_nowait((self.sequence,start,dac,out[:,0].copy()))
        except queue.Full:pass
        self.sequence+=1
        if complete:raise sd.CallbackStop
