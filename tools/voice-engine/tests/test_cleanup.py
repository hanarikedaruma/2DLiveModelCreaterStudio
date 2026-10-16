"""Timing, speech protection and suppression with the real pretrained CPU models."""
import json
from pathlib import Path
import sys
import unittest
import tempfile
from unittest.mock import patch
import numpy as np
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from audio_processing import InputCleaner, default_processing, ToneProcessor, PeakGuard
from worker import Composer


class CleanupTests(unittest.TestCase):
    def test_detector_boost_does_not_amplify_audio_sent_to_ai(self):
        cleaner=InputCleaner(dict(default_processing(),noiseReduction=0))
        observed=[]
        class DetectorSession:
            def run(self,_,values):
                observed.append(values['input'][0,-512:].copy())
                return np.array([.99],np.float32),values['state']
        cleaner.detector.session=DetectorSession()
        source=(.001*np.sin(np.arange(1536*4)*2*np.pi*200/48000)).astype(np.float32)
        cleaner.push(source)
        np.testing.assert_array_equal(cleaner.slice(0,len(source)),source)
        self.assertGreater(float(np.sqrt(np.mean(observed[-1]**2))),.002)
        self.assertLess(float(np.max(np.abs(observed[-1]))),.0041)

    def test_peak_guard_never_boosts_and_preserves_normal_voice(self):
        source=np.random.default_rng(17).normal(0,.08,48000).astype(np.float32)
        np.testing.assert_array_equal(PeakGuard().process(source),source)
        guard=PeakGuard();loud=(2*np.sin(np.arange(48000)*2*np.pi*180/48000)).astype(np.float32)
        result=guard.process(loud)
        self.assertTrue(np.isfinite(result).all())
        self.assertLessEqual(float(np.max(np.abs(result))),guard.ceiling+1e-7)
        self.assertTrue(np.all(np.abs(result)<=np.abs(loud)+1e-7))
        clipped=np.clip(loud,-guard.ceiling,guard.ceiling)
        flat_old=np.count_nonzero(np.isclose(np.abs(clipped),guard.ceiling,atol=1e-6))
        flat_new=np.count_nonzero(np.isclose(np.abs(result),guard.ceiling,atol=1e-6))
        self.assertLess(flat_new,flat_old*.2)
        steady=loud[4800:].astype(np.float64);actual=result[4800:].astype(np.float64)
        scale=np.dot(steady,actual)/np.dot(steady,steady)
        shape_error=np.sqrt(np.mean((actual-scale*steady)**2))/np.sqrt(np.mean(actual**2))
        self.assertLess(shape_error,.02)

    def test_peak_guard_state_is_continuous_across_packets(self):
        source=np.random.default_rng(38).normal(0,.7,97471).astype(np.float32)
        whole=PeakGuard().process(source);guard=PeakGuard();parts=[]
        for begin in range(0,len(source),731):parts.append(guard.process(source[begin:begin+731]))
        np.testing.assert_allclose(np.concatenate(parts),whole,atol=1e-7,rtol=1e-6)

    def test_peak_guard_recovers_in_silence_without_loudness_boost(self):
        guard=PeakGuard();guard.process(np.full(480,.99,np.float32))
        self.assertLess(guard.gain,1)
        np.testing.assert_array_equal(guard.process(np.zeros(48000,np.float32)),np.zeros(48000,np.float32))
        quiet=np.full(480,.02,np.float32);result=guard.process(quiet)
        self.assertLessEqual(float(result.max()),float(quiet.max()))
        self.assertGreater(float(result.min()),.0199)

    def test_noise_only_never_calls_generator_or_leaks_its_voice(self):
        class HallucinatingModel:
            profile={"hopSeconds":.16,"lookaheadSeconds":.08,"historySeconds":.24,"outputGainDb":0,
                     "inputCleanup":default_processing()}
            def convert(self,x):raise AssertionError("nonspeech must skip inference")
        c=Composer(HallucinatingModel())
        rng=np.random.default_rng(31)
        source=rng.normal(0,.004,c.hop*12+c.future).astype(np.float32)
        source[::5000]+=.4  # Typing-like isolated transients, not a real recording.
        for index in range(12):
            begin=0 if index==0 else index*c.hop+c.future
            count=c.hop+c.future if index==0 else c.hop
            audio,meta=c.push(source[begin:begin+count])
            self.assertFalse(np.any(audio))
            self.assertTrue(meta["inferenceSkipped"])
            self.assertEqual(meta["sourceStartSample"],index*c.hop)
            json.dumps(meta)  # Worker protocol must accept silence metadata too.

    def test_rnnoise_latency_and_strength_mix_follow_source_time(self):
        config=default_processing();config.update(noiseReduction=.5,speechOnly=False)
        cleaner=InputCleaner(config)
        source=np.arange(480*8,dtype=np.float32)*.000001
        class Delayed:
            history=[np.zeros(480,np.float32),np.zeros(480,np.float32)]
            def frame(self,audio):
                result=self.history.pop(0)*2;self.history.append(audio.copy());return result
        cleaner.rn=Delayed()
        for chunk in np.array_split(source,7):cleaner.push(chunk)
        self.assertEqual(cleaner.end,len(source)-960)
        np.testing.assert_allclose(cleaner.slice(0,cleaner.end),source[:-960]*1.5,atol=1e-8)

    def test_real_rnnoise_mixing_uses_matching_source_time(self):
        from audio_processing import RNNoise
        config=dict(default_processing(),speechOnly=False,noiseReduction=.5)
        cleaner=InputCleaner(config);reference=RNNoise(config['noiseLibrary'])
        time=np.arange(48000*2)/48000
        # Changing harmonic phase avoids a periodic signal concealing a frame
        # offset. This runs the actual bundled DLL, not the delayed test double.
        phase=2*np.pi*(140*time+7*time*time)
        source=(.1*np.sin(phase)+.05*np.sin(phase*2)+.025*np.sin(phase*3)).astype(np.float32)
        wet=np.concatenate([reference.frame(source[i:i+480]) for i in range(0,len(source),480)])
        for i in range(0,len(source),731):cleaner.push(source[i:i+731])
        expected=.5*wet[960:]+.5*source[:-960]
        np.testing.assert_allclose(cleaner.slice(0,cleaner.end),expected,atol=1e-7)
        a=source[4800:-1440].astype(np.float64)
        def correlation(delay):
            b=wet[4800+delay:len(source)-1440+delay].astype(np.float64)
            return np.dot(a,b)/np.sqrt(np.dot(a,a)*np.dot(b,b))
        correlations={delay:correlation(delay) for delay in (0,480,960,1440)}
        self.assertEqual(max(correlations,key=correlations.get),960,correlations)
        self.assertGreater(correlations[960],correlations[480]+.3,correlations)

    def test_segmentation_and_pruning_do_not_reprocess_overlap(self):
        config=default_processing()
        rng=np.random.default_rng(7);source=rng.normal(0,.01,48000*3+120).astype(np.float32)
        first=InputCleaner(config);second=InputCleaner(config)
        first.push(source)
        for start in range(0,len(source),731):second.push(source[start:start+731])
        np.testing.assert_allclose(first.slice(0,first.end),second.slice(0,second.end),atol=1e-7)
        np.testing.assert_array_equal(first.mask(0,first.end),second.mask(0,second.end))
        end=second.end;second.discard(end-12288)
        self.assertLessEqual(len(second.buffer),13824)

    def test_gate_protects_onset_and_tail_across_windows(self):
        config=default_processing();config["noiseReduction"]=0
        cleaner=InputCleaner(config)
        probabilities=iter([0]*10+[.9]*4+[0]*15)
        with patch.object(cleaner.detector,"frame",side_effect=lambda _:next(probabilities)):
            cleaner.push(np.ones(1536*29,np.float32)*.02)
        mask=cleaner.mask(0,1536*29)
        self.assertTrue(mask[10*1536-3000]>0)
        self.assertEqual(mask[14*1536+8000],1)
        self.assertEqual(mask[-1],0)

    def test_tone_neutral_identity_and_live_update_are_finite(self):
        rng=np.random.default_rng(8);source=rng.normal(0,.1,48000).astype(np.float32)
        tone=ToneProcessor()
        np.testing.assert_array_equal(tone.process(source),source)
        tone.update({"brightnessDb":4,"bodyDb":3,"softnessDb":6})
        output=tone.process(source)
        self.assertTrue(np.isfinite(output).all())
        self.assertLess(np.max(np.abs(output)),1)
        with self.assertRaises(ValueError):tone.update({"brightnessDb":float("nan")})

    def test_realtime_nonspeech_keeps_model_warm_but_output_exactly_zero(self):
        class Model:
            profile={"backend":"seed-xlsr-tiny","hopSeconds":.18,"lookaheadSeconds":.08,"historySeconds":1.5,"outputGainDb":0,"inputCleanup":dict(default_processing(),latencyMode="lowLatency")}
            calls=0
            def convert(self,audio):
                self.calls+=1
                return np.ones(len(audio),np.float32)*.3,{"processingMs":2,"vramMiB":1}
        model=Model();composer=Composer(model)
        for index in range(3):
            count=composer.hop+(composer.future if index==0 else 0)
            output,meta=composer.push(np.zeros(count,np.float32))
            self.assertFalse(np.any(output))
            self.assertFalse(meta["inferenceSkipped"])
        self.assertEqual(model.calls,3)

    def test_denoising_without_gate_does_not_pay_vad_lookahead(self):
        cleaner=InputCleaner(dict(default_processing(),speechOnly=False))
        self.assertEqual(cleaner.lookahead,960)

    def test_low_latency_gate_opens_on_strong_speech_without_second_window(self):
        config=dict(default_processing(),noiseReduction=0,latencyMode="lowLatency")
        cleaner=InputCleaner(config)
        probabilities=iter([0]*10+[.99]+[0]*10)
        with patch.object(cleaner.detector,"frame",side_effect=lambda _:next(probabilities)):
            cleaner.push(np.ones(1536*21,np.float32)*.02)
        self.assertEqual(cleaner.lookahead,6144)
        self.assertGreater(cleaner.mask(0,1536*21)[10*1536],0)

    def test_real_worker_live_tone_ack_and_audio_sequence(self):
        from live import WorkerClient
        directory=Path(__file__).resolve().parents[2]/"build"/"test-temp"
        directory.mkdir(parents=True,exist_ok=True)
        with tempfile.TemporaryDirectory(dir=directory) as temporary:
            directory=Path(temporary)
            (directory/"reference.wav").write_bytes(b"fixture");(directory/"inference.py").write_text("# fixture")
            profile={"schemaVersion":1,"name":"IPC fixture","backend":"seed-whisper-large","sourceRepo":".","cacheDirectory":".","reference":"reference.wav","steps":4,"hopSeconds":.18,"lookaheadSeconds":.08,"historySeconds":.3,"referenceSeconds":1,"outputGainDb":0,"inputCleanup":default_processing()}
            path=directory/"profile.json";path.write_text(json.dumps(profile),encoding="utf-8")
            client=WorkerClient(path,directory/"worker.log",Path(__file__).with_name("worker_fixture.py"))
            try:
                ready=client.ready()
                for index in range(3):
                    client.update_tone({"brightnessDb":2. if index else 0})
                    count=ready["hopFrames"]+(ready["lookaheadFrames"] if index==0 else 0)
                    output,meta=client.convert(np.zeros(count,np.float32))
                    self.assertEqual(meta["sequence"],index)
                    self.assertFalse(np.any(output))
                    self.assertEqual(len(output),ready["hopFrames"])
            finally:client.close()


if __name__=="__main__":unittest.main()
