# SPDX-License-Identifier: GPL-3.0-or-later
"""One GPU owner, latest-draft synthesis and exact-snapshot playback promotion."""
import hashlib,json,queue,threading,time,uuid
from collections import deque
from statistics import median
import numpy as np
from pathlib import Path
import sounddevice as sd
from speech import SpeechJob,SpeechPlayer,SpeechStreamPlayer
from speech_config import locate_runtime,validate_request
from speech_buffering import SpeechBufferPlan,text_units
from speech_delivery import prepare_performance
from speech_tempo import SHY_TEMPO

ACTIVE=('loading','priming','running','stopping')

class StudioSpeech:
    def __init__(self,data):
        self.events=queue.Queue(maxsize=8);self.job=SpeechJob(data,self.events)
        self.lock=threading.RLock();self.player=None;self.state='stopped';self.error=''
        self.session='';self.history=[];self.completed_history=[];self.metrics={};self.mute=False
        self.device=None;self.delivery='whole';self.text='';self.recorded=False
        self.record=None;self.role=None;self.parts=[];self.frames=0;self.meta=None;self.ended=False
        self.backlog=deque();self.pending=None;self.wanted=None;self.committed=None
        self.owners={};self.preparation=dict(owner='',revision=0,state='idle')
        self.speaker_key=''
        self.started=0.
        self.plan=None;self.pacing=deque(maxlen=8);self.stream_ended=False;self.stream_started=False

    def busy(self):return self.state in ACTIVE

    def _context(self):
        history=list(self.completed_history)
        if self.player and self.recorded and self.state in ACTIVE:history.append(self.text)
        return history[-3:]

    def _snapshot(self,text,preferences,profile,owner='',revision=0):
        profile=json.loads(json.dumps(profile,allow_nan=False))
        python,cache=locate_runtime(profile)
        # A next draft can use the currently playing utterance as tentative
        # context; stopping it changes the key and invalidates that draft.
        if preferences is not None and not isinstance(preferences,dict):raise ValueError('読み上げ設定が不正です')
        value=dict(schemaVersion=1,text=text,preferences={**(preferences or {}),'applyFilters':True},history=self._context())
        reference_hash=hashlib.sha256(Path(profile['reference']).read_bytes()).hexdigest() if profile.get('reference') else 'builtin'
        if profile.get('reference'):value['speaker']={'reference':profile['reference'],'sha256':reference_hash}
        request=validate_request(value)
        # Delivery changes only playback. Speaker, DSP, context and words must match exactly.
        key_request={**request,'preferences':{k:v for k,v in request['preferences'].items() if k not in ('delivery','voice')}}
        key=hashlib.sha256(json.dumps([key_request,profile,reference_hash],sort_keys=True,ensure_ascii=False,allow_nan=False).encode()).hexdigest()
        return dict(key=key,request=request,profile=dict(profile),python=python,cache=cache,owner=owner,revision=revision)

    def prepare(self,text,preferences,profile,owner,revision):
        with self.lock:
            if not isinstance(owner,str) or not 1<=len(owner)<=80 or type(revision) is not int or revision<0:raise ValueError('入力の識別子が不正です')
            if revision<=self.owners.get(owner,-1):return
            self.owners[owner]=revision
            if len(self.owners)>64:self.owners.pop(next(iter(self.owners)))
            if not isinstance(text,str) or len(text)>300:raise ValueError('入力は300文字までです')
            if not text.strip():
                if self.wanted and self.wanted['owner']==owner:self.wanted=None
                if self.record and self.record['owner']==owner and self.role=='draft':self.job.cancel()
                if self.preparation['owner']==owner:self.preparation=dict(owner=owner,revision=revision,state='idle')
                return
            self.wanted=self._snapshot(text,preferences,profile,owner,revision)
            self.preparation=dict(owner=owner,revision=revision,state='scheduled')
            if self.role=='draft' and self.record and self.record['key']!=self.wanted['key']:self.job.cancel()

    def discard(self,owner=None):
        with self.lock:
            if owner is None or (self.wanted and self.wanted['owner']==owner):self.wanted=None
            if self.role=='draft' and (owner is None or self.record['owner']==owner):self.job.cancel()
            if owner is None or self.preparation['owner']==owner:self.preparation=dict(owner='',revision=0,state='idle')
            if self.role=='draft' and not self.job.active():self._forget()

    def _forget(self):
        self.record=None;self.role=None;self.parts=[];self.frames=0;self.meta=None;self.ended=False;self.plan=None

    def _launch(self,record,role):
        self._forget();self.record=record;self.role=role
        key=(record['profile'].get('reference','builtin'),record['request']['preferences']['style'])
        spoken=prepare_performance(record['request']['text'],record['request']['preferences']['style']).text
        units=text_units(spoken)
        # Short replies have a different pause/character ratio from paragraphs.
        similar=[seconds for speaker,length,seconds in self.pacing if speaker==key and .5<=length/units<=2]
        pace=median(similar) if similar else None
        self.plan=SpeechBufferPlan(spoken,pace)
        if pace is None and record['request']['preferences']['style']=='shy':
            self.plan.duration=min(120.,(self.plan.duration+.4)/SHY_TEMPO)
        # Even whole playback collects cancellable chunks privately until complete.
        request={**record['request'],'preferences':{**record['request']['preferences'],'delivery':'stream'}}
        self.job.start(record['python'],record['cache'],request,record['profile'])
        if role=='draft':self.preparation=dict(owner=record['owner'],revision=record['revision'],state='generating')

    def _channels(self):return min(2,int(sd.query_devices(self.device)['max_output_channels']))

    def _show_history(self):
        if not self.recorded:self.history=(self.history+[self.text])[-20:];self.recorded=True

    def _play_complete(self,meta,parts,cached=False):
        self.player=SpeechPlayer(np.concatenate(parts),self.device,self._channels(),lambda:self.mute)
        self.metrics={k:v for k,v in meta.items() if type(v) in (int,float)}
        self.metrics['prefetchHit']=int(cached);self.speaker_key=meta.get('speakerKey','')
        self.state='running';self._show_history()

    def _begin_stream(self,force=False):
        if self.stream_started or not self.parts or not (force or self.plan.ready()):return
        self.metrics.update(self.plan.metrics())
        self.backlog.extend(self.parts);self.parts=[];self.stream_started=True
        self.state='priming'

    def start(self,text,preferences,profile,device,mute):
        with self.lock:
            if self.busy():raise RuntimeError('実行中の読み上げを停止してください')
            record=self._snapshot(text,preferences,profile)
            self.session=uuid.uuid4().hex;self.device=device;self.mute=mute;self.error='';self.metrics={}
            self.started=time.perf_counter()
            self.delivery=record['request']['preferences']['delivery'];self.text=record['request']['text'];self.recorded=False
            self.state='loading';self.backlog.clear();self.pending=None;self.committed=None
            self.stream_ended=False;self.stream_started=False
            reusable=self.role=='draft' and self.record and self.record['key']==record['key'] and not self.job.cancelled.is_set()
            if reusable:
                self.role='speech';self.wanted=None;self.preparation=dict(owner='',revision=0,state='idle')
                if self.ended:
                    self._play_complete(self.meta,self.parts,True)
                    self._forget()
                elif self.delivery=='stream':
                    if self.parts:self.state='priming'
                    self._begin_stream();self.metrics['prefetchHit']=1
            elif self.job.active():
                self.committed=record;self.job.cancel();self.wanted=None
            else:self.wanted=None;self._launch(record,'speech')
            return dict(sessionId=self.session)

    def poll(self):
        with self.lock:
            # Drain ring backlog before accepting more audible chunks. The
            # reader's bounded queue then applies backpressure to the worker.
            if self.backlog and self.player is None:
                try:self.player=SpeechStreamPlayer(self.device,self._channels(),lambda:self.mute);self.state='priming'
                except Exception as error:self.error=str(error);self.state='error';self.job.cancel();self.backlog.clear()
            while self.backlog and self.player:
                if not self.player.append(self.backlog[0],ended=self.stream_ended and len(self.backlog)==1):break
                self.backlog.popleft()
            if self.stream_ended and self.player and not self.backlog:self.player.ended=True
            while not self.backlog:
                try:event=self.events.get_nowait()
                except queue.Empty:break
                if event.get('jobId') and event['jobId']!=self.job.identity:continue
                if self.role is None:continue
                if self.role=='draft' and (self.wanted is None or self.wanted['key']!=self.record['key']):continue
                if event.get('speechError'):
                    if self.role=='speech':
                        self.error=event['speechError'];self.state='error'
                        if self.player:self.player.close();self.player=None
                    else:
                        self.preparation=dict(owner=self.record['owner'],revision=self.record['revision'],state='error',error=event['speechError'])
                        self.wanted=None
                    self._forget();continue
                if event.get('speechChunk'):
                    audio=event['audio'];self.frames+=len(audio)
                    if self.frames>48000*120:self.job.cancel();self.error='生成音声が長すぎます';self.state='error';continue
                    self.plan.observe(len(audio),event.get('producedAt'))
                    if self.role=='speech' and self.delivery=='stream' and self.stream_started:
                        self.backlog.append(audio);break
                    self.parts.append(audio)
                    if self.role=='speech' and self.delivery=='stream':
                        self.state='priming'
                        self._begin_stream()
                        if self.backlog:break
                if event.get('speechEnd'):
                    tail=event.get('audio')
                    if tail is not None:
                        self.frames+=len(tail);self.plan.observe(len(tail))
                        if self.role=='speech' and self.delivery=='stream' and self.stream_started:self.backlog.append(tail)
                        else:self.parts.append(tail)
                    self.meta=event['meta'];self.ended=True;self.speaker_key=self.meta.get('speakerKey','')
                    seconds=self.frames/48000/self.plan.units
                    pacing_key=(self.record['profile'].get('reference','builtin'),self.record['request']['preferences']['style'])
                    self.pacing.append((pacing_key,self.plan.units,max(.1,min(.6,seconds))))
                    if self.role=='draft':self.preparation=dict(owner=self.record['owner'],revision=self.record['revision'],state='ready')
                    elif self.delivery=='whole':
                        try:self._play_complete(self.meta,self.parts)
                        except Exception as error:self.error=str(error);self.state='error'
                    else:
                        self.metrics.update({k:v for k,v in self.meta.items() if type(v) in (int,float)})
                        self.stream_ended=True;self._begin_stream(True)
                        if self.player and not self.backlog:self.player.ended=True
                    if self.role=='speech':self._forget()
            # A cancelled draft must finish consuming its terminal packet before
            # a replacement reuses the same resident worker and its pipe.
            if not self.job.active():
                if self.committed:
                    record=self.committed;self.committed=None;self._launch(record,'speech')
                elif self.wanted and self.role!='speech':
                    latest=self.wanted
                    context=self._context() if latest['request']['preferences']['useContext'] else []
                    if latest['request']['history']!=context:
                        latest=self._snapshot(latest['request']['text'],latest['request']['preferences'],latest['profile'],latest['owner'],latest['revision'])
                    self.wanted=latest
                    if self.record is None or self.record['key']!=latest['key'] or self.job.cancelled.is_set():self._launch(latest,'draft')
                    elif self.ended:self.preparation=dict(owner=latest['owner'],revision=latest['revision'],state='ready')
                elif self.role=='draft' and self.wanted is None:self._forget()
            player=self.player;frames=[]
            if player:
                corrections=getattr(player,'clock_corrections',0)
                if type(corrections) is int:self.metrics['dacClockCorrections']=corrections
                first_dac=getattr(player,'first_audio_dac_ms',None)
                if type(first_dac) in (int,float):self.metrics['firstAudioMs']=max(0.,first_dac-self.started*1000)
                first_wall=getattr(player,'first_audio_wall_ms',None)
                if type(first_wall) in (int,float):self.metrics['firstAudioWallMs']=first_wall
                if isinstance(player,SpeechStreamPlayer):
                    self.state='priming' if player.priming else 'running'
                    self.metrics.update(bufferedMs=player.available/48,rebuffers=player.rebuffers)
                    if not player.priming:self._show_history()
                for _ in range(16):
                    try:frames.append(player.playback.get_nowait())
                    except queue.Empty:break
                if player.done and time.perf_counter()*1000>=player.last_dac_ms:
                    player.close();self.player=None;self.error=player.error or self.error
                    if player.error:self.job.cancel()
                    self.state='error' if self.error else 'stopped'
                    if not self.error:self.completed_history=(self.completed_history+[self.text])[-20:]
            return frames

    def stop(self):
        with self.lock:
            self.state='stopping';self.wanted=None;self.committed=None;self.job.cancel()
            if self.player:self.player.close();self.player=None
            if self.job.thread:self.job.thread.join(3)
            if self.job.active():self.job.release();self.job.thread.join(5)
            if self.job.active():raise RuntimeError('読み上げの停止を確認できません')
            self.backlog.clear();self.pending=None;self._forget();self.preparation=dict(owner='',revision=0,state='idle')
            self.stream_ended=False;self.stream_started=False
            while True:
                try:self.events.get_nowait()
                except queue.Empty:break
            self.state='stopped';self.error=''

    def release(self):
        with self.lock:
            if self.busy():raise RuntimeError('読み上げを停止してからモデルを解放してください')
            self.discard()
            if self.job.active():self.job.cancel();self.job.thread.join(3)
            self.job.release()
            if self.job.thread:self.job.thread.join(5)
            self._forget()

    def status(self):
        with self.lock:return dict(history=list(self.history),resident=self.job.resident(),delivery=self.delivery,preparation=dict(self.preparation),speakerKey=self.speaker_key)

    def clear_history(self):
        with self.lock:
            if self.busy():raise RuntimeError('読み上げを停止してから履歴を消してください')
            self.discard();self.history=[];self.completed_history=[]
