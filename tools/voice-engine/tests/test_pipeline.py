import json
from pathlib import Path
import sys
import subprocess
import tempfile
import unittest

import numpy as np
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from live import Ring,LiveEngine
from worker import Composer,read_exact
from backend import read_profile


class IdentityModel:
    profile={"hopSeconds":.16,"lookaheadSeconds":.08,"historySeconds":.24,"outputGainDb":0}
    def convert(self,x):
        return x.copy(),{"processingMs":2,"vramMiB":0}


class PipelineTests(unittest.TestCase):
    def test_input_meter_reports_gain_adjusted_signal_and_overload(self):
        engine=LiveEngine();engine.input_gain_db=12
        source=np.array([.05,-.4,.005],np.float32)
        prepared=engine.prepare_input(source)
        np.testing.assert_array_equal(prepared,source*(10**(.6)))
        self.assertAlmostEqual(engine.stats['inputGainPeak'],float(np.max(np.abs(prepared))))
        self.assertEqual(engine.stats['inputOverSamples'],1)
        engine.prepare_input(np.zeros(480,np.float32))
        self.assertEqual(engine.stats['inputGainPeak'],0)
        self.assertTrue(np.isfinite(engine.stats['inputGainRmsDb']))
        json.dumps(engine.stats,allow_nan=False)

    def test_worker_output_handles_partial_pipe_writes(self):
        from unittest.mock import patch
        import worker
        class Partial:
            def __init__(self):self.value=bytearray()
            def write(self,value):
                count=min(7,len(value));self.value.extend(value[:count]);return count
            def flush(self):pass
        pipe=Partial()
        class Stdout:buffer=pipe
        samples=np.arange(480,dtype=np.float32)
        with patch.object(worker.sys,'stdout',Stdout()):worker.emit({'frames':480},samples)
        header,audio=bytes(pipe.value).split(b'\n',1);self.assertEqual(json.loads(header)['frames'],480)
        np.testing.assert_array_equal(np.frombuffer(audio,dtype='<f4'),samples)
    def test_ring_wrap_and_overflow_preserve_data(self):
        r=Ring(9,2)
        a=np.column_stack([np.arange(6),-np.arange(6)]).astype(np.float32)
        self.assertTrue(r.write(a))
        np.testing.assert_array_equal(r.take(4),a[:4])
        self.assertTrue(r.write(a))
        self.assertFalse(r.write(a))
        np.testing.assert_array_equal(r.take(8),np.concatenate([a[4:],a]))
        self.assertIsNone(r.take(1))

    def test_composer_time_samples_and_boundary(self):
        model=IdentityModel();c=Composer(model)
        rng=np.random.default_rng(301)
        source=rng.normal(0,.03,c.hop*5+c.future).astype(np.float32)
        out=[]
        for i in range(5):
            start=0 if i==0 else i*c.hop+c.future
            count=c.hop+c.future if i==0 else c.hop
            y,m=c.push(source[start:start+count])
            self.assertEqual(m["sourceStartSample"],i*c.hop)
            self.assertEqual(len(y),c.hop)
            self.assertGreater(m["streamRtf"],0)
            out.append(y)
        np.testing.assert_allclose(np.concatenate(out),source[:c.hop*5],rtol=1e-5,atol=1e-6)

    def test_composer_rejects_wrong_packet(self):
        c=Composer(IdentityModel())
        with self.assertRaises(ValueError):c.push(np.zeros(c.hop,np.float32))

    def test_silence_advances_time_and_flushes_tail(self):
        c=Composer(IdentityModel())
        y,m=c.push(np.zeros(c.hop+c.future,np.float32))
        self.assertEqual(c.cursor,c.hop)
        self.assertFalse(np.any(y))
        y,m=c.push(np.zeros(c.hop,np.float32))
        self.assertEqual(m["sourceStartSample"],c.hop)
        self.assertFalse(np.any(y))

    def test_output_mute_and_aligned_bypass(self):
        engine=LiveEngine();engine.hop=7680;engine.play_at=0
        wet=np.full(48000,.1,np.float32);dry=np.full(48000,.2,np.float32)
        engine.output_ring.write(np.column_stack([wet,dry]))
        output=np.zeros((480,2),np.float32)
        for _ in range(4):engine.output_callback(output,480,None,False)
        np.testing.assert_allclose(output,.1,atol=1e-5)
        engine.bypass=True
        for _ in range(3):engine.output_callback(output,480,None,False)
        np.testing.assert_allclose(output,.2,atol=1e-5)
        engine.mute=True
        for _ in range(3):engine.output_callback(output,480,None,False)
        self.assertFalse(np.any(output))

    def test_starvation_fails_closed(self):
        engine=LiveEngine();engine.hop=7680;engine.primed=True
        output=np.ones((480,2),np.float32)
        engine.output_callback(output,480,None,False)
        self.assertFalse(np.any(output))
        self.assertTrue(engine.stop_event.is_set())
        self.assertEqual(engine.stats["underruns"],1)

    def test_clock_control_ignores_gpu_block_queue_phase(self):
        engine=LiveEngine();engine.input_ring.w=48000*5;engine.target_lag=48000*5
        for queued in (100,96000,150000,100,110000):
            engine.output_ring.w=queued
            engine.correct_clock()
        self.assertEqual(engine.ratio,1.)

    def test_silent_start_preserves_budget_for_later_voiced_inference(self):
        engine=LiveEngine();engine.hop=144000;engine.min_capture_frames=300288
        engine.play_at=0
        engine.output_ring.write(np.zeros((engine.hop*2,2),np.float32))
        output=np.ones((480,2),np.float32)
        engine.input_ring.w=200000
        engine.output_callback(output,480,None,False)
        self.assertFalse(engine.primed)
        self.assertFalse(np.any(output))
        self.assertEqual(engine.output_ring.r,0)
        engine.input_ring.w=engine.min_capture_frames
        engine.output_callback(output,480,None,False)
        self.assertTrue(engine.primed)
        self.assertEqual(engine.target_lag,float(engine.min_capture_frames))

    def test_clock_difference_does_not_accumulate_delay(self):
        for ppm in (-500,500):
            engine=LiveEngine();lag=240000.;consumed=0.;captured=lag
            engine.target_lag=lag
            for _ in range(180000):  # 30 minutes of 10ms callback clocks.
                captured+=480*(1+ppm/1e6)
                engine.input_ring.w=round(captured)
                engine.output_ring.r=int(consumed);engine.fraction=consumed-int(consumed)
                engine.correct_clock();consumed+=480*engine.ratio
            self.assertLess(abs(captured-consumed-lag),1000)
            self.assertAlmostEqual(engine.ratio,1+ppm/1e6,places=5)

    def test_input_overflow_stops_instead_of_overwriting(self):
        engine=LiveEngine();engine.input_ring=Ring(100)
        engine.input_callback(np.ones((480,1),np.float32),480,None,False)
        self.assertTrue(engine.stop_event.is_set())
        self.assertEqual(engine.stats["overflows"],1)

    def test_invalid_quality_profile_rejected(self):
        task_temp=Path(__file__).resolve().parents[2]/"build"/"test-temp"
        task_temp.mkdir(parents=True,exist_ok=True)
        with tempfile.TemporaryDirectory(dir=task_temp) as temp:
            p=Path(temp)/"bad.json"
            p.write_text(json.dumps({"schemaVersion":1,"backend":"seed-whisper-large",
                "sourceRepo":".","reference":".","cacheDirectory":".","steps":float("nan")}),encoding="utf-8")
            with self.assertRaises(ValueError):read_profile(p)

    def test_second_worker_is_rejected_before_loading_gpu(self):
        from execution_lock import ExecutionLock
        with ExecutionLock("Local\\VoiceChanger-HQ-GPU-v1"):
            result=subprocess.run([sys.executable,"-X","utf8",str(Path(__file__).resolve().parents[1]/"worker.py"),
                "--profile","unused.json","--prefetch"],capture_output=True,text=True,encoding="utf-8",timeout=10)
        self.assertEqual(result.returncode,1)
        self.assertIn("別のVoiceChangerが実行中",json.loads(result.stdout)["error"])

    def test_realtime_generation_history_cannot_exceed_encoder_history(self):
        profile_path=Path(__file__).resolve().parents[1]/"profiles"/"Original Soft Girl Realtime.json"
        profile=read_profile(profile_path,check_assets=False)
        self.assertEqual(profile["backend"],"seed-xlsr-tiny")
        directory=Path(__file__).resolve().parents[2]/"build"/"test-temp"
        directory.mkdir(parents=True,exist_ok=True)
        with tempfile.TemporaryDirectory(dir=directory) as temp:
            path=Path(temp)/"bad.json"
            profile["generationHistorySeconds"]=profile["historySeconds"]+.1
            path.write_text(json.dumps(profile),encoding="utf-8")
            with self.assertRaises(ValueError):read_profile(path,check_assets=False)


if __name__=="__main__":unittest.main()
