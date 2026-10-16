"""Exact draft promotion, cancellation, speaker/DSP keys and final DAC ownership."""
import queue,sys,tempfile,threading,unittest
from pathlib import Path
from unittest.mock import Mock,patch
import numpy as np
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from studio_speech import StudioSpeech

class StudioSpeechTests(unittest.TestCase):
    def setUp(self):
        root=Path(__file__).resolve().parents[3]/'.cache/speech-tests';root.mkdir(parents=True,exist_ok=True)
        self.temp=tempfile.TemporaryDirectory(dir=root);self.speech=StudioSpeech(self.temp.name)
        self.job=self.speech.job=Mock();self.job.active.return_value=False;self.job.resident.return_value=True
        self.job.thread=None;self.job.cancelled=threading.Event();self.job.identity='initial'
        def start(*args):self.job.identity=str(self.job.start.call_count);self.job.cancelled.clear()
        self.job.start.side_effect=start;self.job.cancel.side_effect=self.job.cancelled.set
        self.runtime=patch('studio_speech.locate_runtime',return_value=('python','cache'));self.runtime.start()
    def tearDown(self):self.runtime.stop();self.temp.cleanup()
    def prepare(self,text='こんにちは',revision=1,owner='editor',preferences=None,profile=None):
        self.speech.prepare(text,preferences or {},profile or {},owner,revision);self.speech.poll()
    def complete(self):
        self.speech.events.put(dict(speechChunk=True,audio=np.full(4800,.1,np.float32),jobId=self.job.identity))
        self.speech.events.put(dict(speechEnd=True,meta={'seconds':.1,'speakerKey':'fixed'},jobId=self.job.identity))
        self.speech.poll()
    def player(self):
        p=Mock(done=False,last_dac_ms=5020,error='');p.playback=queue.Queue();return p
    def test_only_last_three_completed_utterances_are_context(self):
        self.speech.completed_history=['最初','二番目','三番目','四番目']
        result=self.speech.start('今の文章',{}, {},1,True)
        request=self.job.start.call_args.args[2]
        self.assertEqual(request['history'],['二番目','三番目','四番目'])
        self.assertEqual(result['sessionId'],self.speech.session)
        with self.assertRaises(RuntimeError):self.speech.clear_history()
    def test_whole_waits_for_all_chunks_and_closes_after_last_dac(self):
        self.speech.start('発話',{}, {},3,True);player=self.player()
        player.playback.put((0,0,5010,np.zeros(480,np.float32)))
        with patch('studio_speech.sd.query_devices',return_value={'max_output_channels':2}),patch('studio_speech.SpeechPlayer',return_value=player) as create:
            self.speech.events.put(dict(speechChunk=True,audio=np.zeros(480,np.float32)))
            self.assertEqual(self.speech.poll(),[]);create.assert_not_called()
            self.speech.events.put(dict(speechEnd=True,meta={'seconds':.01}))
            self.assertEqual(len(self.speech.poll()),1)
        self.assertEqual(create.call_args.args[1:3],(3,2));self.assertTrue(create.call_args.args[3]())
        player.done=True
        with patch('studio_speech.time.perf_counter',return_value=5.01):self.speech.poll()
        player.close.assert_not_called()
        with patch('studio_speech.time.perf_counter',return_value=5.03):self.speech.poll()
        self.assertEqual(self.speech.completed_history,['発話']);self.assertEqual(self.speech.state,'stopped')
    def test_prefetch_is_silent_and_exact_send_reuses_audio(self):
        with patch('studio_speech.SpeechPlayer') as create:
            self.prepare();self.complete();create.assert_not_called()
            self.assertEqual(self.speech.history,[]);self.assertEqual(self.speech.state,'stopped')
            self.assertEqual(self.speech.preparation['state'],'ready')
        player=self.player()
        with patch('studio_speech.sd.query_devices',return_value={'max_output_channels':2}),patch('studio_speech.SpeechPlayer',return_value=player):
            self.speech.start('こんにちは',{}, {},3,True)
        self.assertEqual(self.job.start.call_count,1);self.assertEqual(self.speech.metrics['prefetchHit'],1)
        self.assertEqual(self.speech.speaker_key,'fixed')
    def test_edit_cancels_old_draft_and_launches_only_latest(self):
        self.prepare('古い文章');self.job.active.return_value=True
        self.speech.prepare('中間の文章',{}, {},'editor',2)
        self.speech.prepare('最新の文章',{}, {},'editor',3)
        self.speech.events.put(dict(speechChunk=True,audio=np.ones(480,np.float32)))
        self.speech.poll();self.assertEqual(self.speech.parts,[])
        self.assertEqual(self.job.start.call_count,1)
        self.job.active.return_value=False;self.speech.poll()
        self.assertEqual(self.job.start.call_count,2)
        self.assertEqual(self.job.start.call_args.args[2]['text'],'最新の文章')
    def test_send_while_exact_draft_generates_adopts_same_job(self):
        self.prepare();self.job.active.return_value=True
        self.speech.start('こんにちは',{}, {},3,True)
        self.assertEqual(self.speech.role,'speech');self.assertEqual(self.job.start.call_count,1)
        # Clearing the editor after send never cancels audible generation.
        self.speech.prepare('',{}, {},'editor',2)
        self.job.cancel.assert_not_called()
    def test_send_new_text_waits_for_cancel_then_uses_committed_snapshot(self):
        self.prepare('古い');self.job.active.return_value=True
        self.speech.start('送信した文章',{}, {},3,True)
        self.assertEqual(self.speech.committed['request']['text'],'送信した文章')
        self.speech.prepare('その次の下書き',{}, {},'editor',2)
        self.job.active.return_value=False;self.speech.poll()
        self.assertEqual(self.job.start.call_args.args[2]['text'],'送信した文章')
    def test_scene_tone_context_or_speaker_change_invalidates_cache(self):
        original=self.speech._snapshot('同じ文章',{}, {})['key']
        self.assertNotEqual(original,self.speech._snapshot('同じ文章',{'scene':'喜ぶ'}, {})['key'])
        self.assertNotEqual(original,self.speech._snapshot('同じ文章',{'style':'shy'}, {})['key'])
        self.assertNotEqual(original,self.speech._snapshot('同じ文章',{}, {'outputGainDb':-6})['key'])
        self.speech.completed_history=['前の発話']
        self.assertNotEqual(original,self.speech._snapshot('同じ文章',{}, {})['key'])
        path=Path(self.temp.name)/'reference.wav';path.write_bytes(b'voice-a')
        first=self.speech._snapshot('同じ文章',{}, {'reference':str(path)})['key'];path.write_bytes(b'voice-b')
        self.assertNotEqual(first,self.speech._snapshot('同じ文章',{}, {'reference':str(path)})['key'])
    def test_stale_revision_and_other_editor_discard_do_not_replace_latest(self):
        self.prepare('最新',3);self.speech.prepare('古い',{}, {},'editor',2)
        self.speech.discard('other-editor')
        self.assertEqual(self.speech.wanted['request']['text'],'最新')
        self.speech.discard('editor');self.assertIsNone(self.speech.wanted)
    def test_draft_error_is_visible_without_retry_or_audible_error(self):
        self.prepare();self.speech.events.put({'speechError':'GPUメモリ不足'})
        self.speech.poll();self.speech.poll()
        self.assertEqual(self.speech.preparation['state'],'error');self.assertEqual(self.job.start.call_count,1)
        self.assertEqual(self.speech.state,'stopped');self.assertEqual(self.speech.history,[])
    def test_stop_discards_late_pcm_and_keeps_model(self):
        self.speech.start('取消',{}, {},3,True)
        self.speech.events.put(dict(speechChunk=True,audio=np.zeros(480,np.float32)))
        self.speech.stop();self.job.cancel.assert_called_once();self.job.release.assert_not_called()
        self.assertEqual(self.speech.poll(),[]);self.assertEqual(self.speech.history,[])
    def test_interrupted_utterance_never_enters_next_context(self):
        self.speech.history=['完了した文章','途中で止めた文章'];self.speech.completed_history=['完了した文章']
        self.speech.stop();self.speech.start('次の文章',{'delivery':'stream'}, {},1,True)
        self.assertEqual(self.job.start.call_args.args[2]['history'],['完了した文章'])
    def test_converter_dsp_is_always_used_for_fixed_voice(self):
        record=self.speech._snapshot('声を固定',{'applyFilters':False},{'outputGainDb':-6})
        self.assertTrue(record['request']['preferences']['applyFilters'])
        self.assertEqual(record['profile']['outputGainDb'],-6)
    def test_stream_stages_reserve_before_device_and_ends_only_after_backlog_is_submitted(self):
        from speech import SpeechStreamPlayer
        from test_speech_stream import StreamTests
        # Deliberately slower than real time: reserve exceeds the finite 8 s ring.
        self.speech.start('あ'*200,{'delivery':'stream'}, {},3,True)
        self.job.active.return_value=True
        player=StreamTests().player();player.done=False;player.last_dac_ms=float('inf')
        player.close=Mock()
        with patch('studio_speech.sd.query_devices',return_value={'max_output_channels':2}),patch.object(SpeechStreamPlayer,'__new__',return_value=player) as create,patch.object(SpeechStreamPlayer,'__init__',return_value=None):
            for i in range(50):
                self.speech.events.put(dict(speechChunk=True,audio=np.zeros(30720,np.float32),producedAt=100+i*1.3))
                self.speech.poll()
                if self.speech.stream_started:break
            self.speech.poll()
            self.assertTrue(self.speech.stream_started);create.assert_called_once()
            self.assertGreater(self.speech.metrics['startupBufferMs'],8000)
            self.assertTrue(self.speech.backlog);self.assertFalse(player.ended)
            # Simulate consumption while the host drains its staged reserve.
            while self.speech.backlog:
                with player.ring_lock:player.available=0;player.read=player.write
                self.speech.poll()
            buffered=player.available
            self.speech.events.put(dict(speechEnd=True,audio=np.zeros(260,np.float32),meta={'seconds':32.}))
            self.speech.poll()
            self.assertIsNone(self.speech.record);self.assertFalse(player.ended)
            self.speech.poll();self.assertTrue(player.ended)
            self.assertEqual(player.available,buffered+260)

    def test_inflight_prefetch_keeps_speed_measurements_when_promoted(self):
        self.prepare('あ'*100);self.job.active.return_value=True
        for i in range(2):
            self.speech.events.put(dict(speechChunk=True,audio=np.zeros(30720,np.float32),producedAt=10+i))
        self.speech.poll();plan=self.speech.plan
        self.speech.start('あ'*100,{'delivery':'stream'}, {},3,True)
        self.assertIs(self.speech.plan,plan);self.assertFalse(self.speech.stream_started)
        self.assertAlmostEqual(plan.rtf,1/.64*1.10)
        self.assertEqual(self.speech.metrics['prefetchHit'],1)
    def test_shy_buffer_estimate_includes_spoken_restarts(self):
        from speech_delivery import prepare_performance
        from speech_buffering import text_units
        text='あなたのことが大好きです'
        self.speech.start(text,{'style':'shy','delivery':'stream'}, {},3,True)
        self.assertEqual(self.speech.text,text)
        self.assertEqual(self.speech.plan.units,text_units(prepare_performance(text,'shy').text))
        self.assertGreater(self.speech.plan.units,text_units(text))
        self.assertGreater(self.speech.plan.duration,self.speech.plan.units*.22)

    def test_shy_and_other_emotions_do_not_share_tempo_calibration(self):
        from speech_delivery import prepare_performance
        from speech_buffering import text_units
        text='い、行きます。';units=text_units(prepare_performance(text,'shy').text)
        self.speech.pacing.append((('builtin','auto'),units,.1))
        self.speech.start(text,{'style':'shy','delivery':'stream'}, {},3,True)
        self.assertGreater(self.speech.plan.duration,units*.22)

    def test_measured_shy_pace_is_not_slowed_again_in_buffer_estimate(self):
        from speech_delivery import prepare_performance
        from speech_buffering import text_units
        text='い、行きます。';units=text_units(prepare_performance(text,'shy').text)
        self.speech.pacing.append((('builtin','shy'),units,.3))
        self.speech.start(text,{'style':'shy','delivery':'stream'}, {},3,True)
        self.assertAlmostEqual(self.speech.plan.duration,units*.3)

if __name__=='__main__':unittest.main()
