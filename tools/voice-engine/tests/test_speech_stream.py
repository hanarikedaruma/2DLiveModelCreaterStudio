"""Packet boundaries, continuous resampling and bounded, lossless playback."""
import io,queue,sys,threading,unittest,os
from pathlib import Path
from unittest.mock import patch
import numpy as np
import sounddevice as sd
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from speech_stream_protocol import write_packet,read_packet,command_lines
from speech_stream_audio import SpeechStreamProcessor
from speech import SpeechStreamPlayer,SpeechJob

class StreamTests(unittest.TestCase):
    def test_command_reader_handles_multiple_lines_and_eof_without_blocking_stdio(self):
        read,write=os.pipe()
        os.write(write,b'{"action":"generate"}\n{"action":"cancel"}\n');os.close(write)
        with os.fdopen(read,'rb',buffering=0) as pipe:
            lines=list(command_lines(pipe,threading.Event()))
        self.assertEqual(lines,[b'{"action":"generate"}',b'{"action":"cancel"}'])
    def test_stop_after_generation_keeps_idle_stream_worker(self):
        p=SpeechJob('.',queue.Queue());p.delivery='stream'
        from unittest.mock import Mock
        p.process=Mock();p.process.poll.return_value=None
        with patch('speech.stop_owned_process') as stop:p.cancel()
        stop.assert_not_called();self.assertTrue(p.resident())
    def test_packet_binary_newlines_and_short_reads_preserve_samples(self):
        x=np.random.default_rng(42).normal(0,.1,15360).astype(np.float32)
        pipe=io.BytesIO();write_packet(pipe,dict(event='pcm',sequence=3),x)
        class Short(io.BytesIO):
            def read(self,n=-1):return super().read(min(n,17))
        meta,y=read_packet(Short(pipe.getvalue()))
        self.assertEqual(meta['sequence'],3);np.testing.assert_array_equal(x,y)
        for raw in (b'{"event":"pcm","frames":24001,"byteLength":96004}\n',pipe.getvalue()[:-3]):
            with self.assertRaises((ValueError,EOFError)):read_packet(io.BytesIO(raw))
    def test_resampling_matches_across_chunk_sizes_and_has_one_end_fade(self):
        x=(np.sin(np.arange(48000)*.07)*.2).astype(np.float32)
        def process(size):
            p=SpeechStreamProcessor({'outputGainDb':-3},False)
            y=np.concatenate([p.feed(x[i:i+size]) for i in range(0,len(x),size)]+[p.finish()])
            self.assertEqual(p.output_frames,len(y));return y
        a=process(7680);b=process(48000)
        self.assertEqual(len(a),len(x)*2)
        np.testing.assert_allclose(a,b,atol=1e-7)
        self.assertEqual(a[0],0);self.assertEqual(a[-1],0)
        self.assertGreater(np.max(np.abs(a[15350:15370])),.05)
    def player(self):
        p=SpeechStreamPlayer.__new__(SpeechStreamPlayer)
        p.ring=np.zeros(48000*8,np.float32);p.read=p.write=p.available=0
        p.ring_lock=threading.Lock();p.ended=False;p.priming=True;p.rebuffers=0
        p.position=0;p.mix=1.;p.muted=lambda:False;p.unlock=threading.Event()
        p.continuity=1.
        p.playback=queue.Queue(maxsize=128);p.sequence=0;p.error='';p.first_audio_dac_ms=None
        return p
    def test_stream_starvation_waits_without_dropping_or_repeating_samples(self):
        p=self.player();out=np.empty((480,2),np.float32)
        class Times:currentTime=1.;outputBufferDacTime=1.02
        p.append(np.full(48000,.2,np.float32))
        for _ in range(100):p.callback(out,480,Times(),False)
        p.callback(out,480,Times(),False)
        self.assertTrue(p.priming);self.assertEqual(p.rebuffers,1);self.assertEqual(p.available,0)
        p.append(np.full(960,.3,np.float32));p.callback(out,480,Times(),False)
        self.assertEqual(p.available,960);self.assertEqual(np.max(out),0)
        p.ended=True;p.callback(out,480,Times(),False)
        self.assertGreater(out[-1,0],.29)
        with self.assertRaises(sd.CallbackStop):p.callback(out,480,Times(),False)
        self.assertEqual(p.available,0)
        self.assertFalse(p.append(np.zeros(len(p.ring)+1,np.float32)))
    def test_muted_final_pcm_is_zero_including_lipsync_frames(self):
        p=self.player();p.muted=lambda:True;p.mix=0.;p.ended=True
        p.append(np.ones(480,np.float32));out=np.empty((480,2),np.float32)
        class Times:currentTime=1.;outputBufferDacTime=1.02
        with self.assertRaises(sd.CallbackStop):p.callback(out,480,Times(),False)
        np.testing.assert_array_equal(out,np.zeros((480,2)))
        self.assertEqual(np.max(p.playback.get_nowait()[3]),0)
    def test_unexpected_starvation_fades_and_resume_preserves_all_samples(self):
        p=self.player();p.priming=False;p.append(np.full(480,.3,np.float32))
        out=np.empty((480,2),np.float32)
        class Times:currentTime=1.;outputBufferDacTime=1.02
        p.callback(out,480,Times(),False)
        self.assertAlmostEqual(out[0,0],.3);self.assertEqual(out[-1,0],0)
        self.assertLess(np.max(np.abs(np.diff(out[:,0]))),.002)
        p.callback(out,480,Times(),False);self.assertEqual(p.rebuffers,1)
        p.append(np.full(48000,.3,np.float32));p.callback(out,480,Times(),False)
        self.assertLess(out[0,0],.002);self.assertAlmostEqual(out[-1,0],.3)
        self.assertEqual(p.available,47520)
    def test_short_final_tail_and_end_are_visible_to_callback_together(self):
        p=self.player();p.priming=False
        p.append(np.linspace(.01,0,260,dtype=np.float32),ended=True)
        out=np.empty((480,2),np.float32)
        class Times:currentTime=1.;outputBufferDacTime=1.02
        with self.assertRaises(sd.CallbackStop):p.callback(out,480,Times(),False)
        self.assertEqual(p.rebuffers,0);self.assertEqual(p.available,0)
        self.assertGreater(out[100,0],0);self.assertEqual(out[-1,0],0)
    def test_first_audio_dac_excludes_silent_priming_callbacks(self):
        p=self.player();out=np.empty((480,2),np.float32)
        class Times:currentTime=1.;outputBufferDacTime=1.02
        with patch('speech.time.perf_counter',return_value=5.):p.callback(out,480,Times(),False)
        self.assertIsNone(p.first_audio_dac_ms)
        p.append(np.full(48000,.2,np.float32));p.muted=lambda:True
        Times.currentTime=2.;Times.outputBufferDacTime=2.02
        with patch('speech.time.perf_counter',return_value=6.):p.callback(out,480,Times(),False)
        self.assertEqual(p.first_audio_dac_ms,6020)
        with patch('speech.time.perf_counter',return_value=7.):p.callback(out,480,Times(),False)
        self.assertEqual(p.first_audio_dac_ms,6020)
    def test_dac_clock_does_not_move_back_with_delayed_python_callbacks(self):
        p=self.player();p.append(np.full(48000,.2,np.float32));out=np.empty((480,2),np.float32)
        class Times:currentTime=100.;outputBufferDacTime=100.04
        with patch('speech.time.perf_counter',return_value=5.):p.callback(out,480,Times(),False)
        self.assertAlmostEqual(p.playback.get_nowait()[2],5040)
        Times.currentTime=100.01;Times.outputBufferDacTime=100.05
        with patch('speech.time.perf_counter',return_value=5.2):p.callback(out,480,Times(),False)
        self.assertAlmostEqual(p.playback.get_nowait()[2],5050)
        Times.currentTime=100.02;Times.outputBufferDacTime=100.06
        with patch('speech.time.perf_counter',return_value=5.21):p.callback(out,480,Times(),False)
        self.assertAlmostEqual(p.playback.get_nowait()[2],5060)
    def test_initial_playback_uses_first_two_640ms_chunks_and_retains_one_second_margin(self):
        p=self.player();out=np.empty((480,2),np.float32)
        class Times:currentTime=1.;outputBufferDacTime=1.02
        p.append(np.full(30700,.2,np.float32));p.callback(out,480,Times(),False)
        self.assertTrue(p.priming);self.assertIsNone(p.first_audio_dac_ms)
        p.append(np.full(15360,.2,np.float32));p.callback(out,480,Times(),False)
        self.assertTrue(p.priming);self.assertIsNone(p.first_audio_dac_ms)
        p.append(np.full(15360,.2,np.float32));p.callback(out,480,Times(),False)
        self.assertFalse(p.priming);self.assertGreater(out[-1,0],.19)
    def test_wasapi_timestamp_jitter_cannot_overlap_preceding_pcm(self):
        p=self.player();p.append(np.full(48000,.2,np.float32));out=np.empty((480,2),np.float32)
        class Times:currentTime=100.;outputBufferDacTime=100.04
        with patch('speech.time.perf_counter',return_value=5.):p.callback(out,480,Times(),False)
        first=p.playback.get_nowait()[2]
        Times.currentTime=100.01;Times.outputBufferDacTime=100.045
        p.callback(out,480,Times(),False);second=p.playback.get_nowait()[2]
        Times.currentTime=100.02;Times.outputBufferDacTime=100.043
        p.callback(out,480,Times(),False);third=p.playback.get_nowait()[2]
        self.assertAlmostEqual(second-first,10);self.assertAlmostEqual(third-second,10)
        self.assertEqual(p.clock_corrections,2)
        # A real forward discontinuity remains in the device timeline.
        Times.currentTime=100.03;Times.outputBufferDacTime=100.09
        p.callback(out,480,Times(),False);self.assertAlmostEqual(p.playback.get_nowait()[2],5090)

if __name__=='__main__':unittest.main()
