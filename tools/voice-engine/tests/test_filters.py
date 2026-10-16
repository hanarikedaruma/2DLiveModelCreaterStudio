"""Filter transfer, continuity, ordering, validation, and worker integration."""
import copy
import json
from pathlib import Path
import sys
import tempfile
import unittest
import numpy as np
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from filter_chain import FilterChain,REGISTRY,default_chain,new_filter,validate_chain
from worker import Composer,apply_control
from live import WorkerClient

def chain(*items):return {"schemaVersion":1,"enabled":True,"items":list(items)}
def tone(frequency,amplitude=.2):return (amplitude*np.sin(np.arange(48000)*2*np.pi*frequency/48000)).astype(np.float32)
def rms(x):return np.sqrt(np.mean(np.asarray(x,dtype=np.float64)**2))

class FilterTests(unittest.TestCase):
    def test_off_empty_and_disabled_are_exact_identity(self):
        x=np.random.default_rng(10).normal(0,.1,12517).astype(np.float32)
        off=default_chain();off["enabled"]=False
        disabled=default_chain()
        for item in disabled["items"]:item["enabled"]=False
        for config in (None,off,disabled,chain()):np.testing.assert_array_equal(FilterChain(config).process(x),x)

    def test_resonance_reduces_selected_band_and_preserves_low_voice(self):
        item=new_filter("resonance");item["params"].update(strength=80,frequencyHz=1800,q=3,sensitivity=75)
        for hz,maximum in ((1800,.46),(200,1.01)):
            x=tone(hz);y=FilterChain(chain(item)).process(x)
            ratio=rms(y[4800:])/rms(x[4800:])
            self.assertLess(ratio,maximum)
            if hz==200:self.assertGreater(ratio,.97)

    def test_deesser_damps_high_band_only_when_loud(self):
        item=new_filter("deesser");item["params"].update(strength=100,frequencyHz=3500,thresholdDb=-30)
        for hz,amp,lo,hi in ((1000,.2,.999,1.001),(10000,.2,.35,.65),(10000,.0001,.999,1.001)):
            x=tone(hz,amp);y=FilterChain(chain(item)).process(x)
            ratio=rms(y[4800:])/rms(x[4800:]);self.assertGreater(ratio,lo);self.assertLess(ratio,hi)

    def test_streaming_matches_whole_file_without_state_resets(self):
        x=np.random.default_rng(19).normal(0,.1,97471).astype(np.float32)
        config=default_chain();config["items"].extend([new_filter("equalizer"),new_filter("gain")])
        whole=FilterChain(config).process(x);stream=FilterChain(config);pieces=[];offset=0
        for n in [1,11,480,1024,8640]*20:
            part=x[offset:offset+n]
            if not len(part):break
            pieces.append(stream.process(part));offset+=len(part)
        if offset<len(x):pieces.append(stream.process(x[offset:]))
        np.testing.assert_allclose(np.concatenate(pieces),whole,rtol=1e-6,atol=1e-7)
        self.assertLessEqual(len(stream.history),4800)

    def test_hot_toggle_crossfades_and_preserves_frame_count(self):
        item=new_filter("gain");item["params"]["gainDb"]=-12
        filters=FilterChain(chain(item));x=np.full(1024,.2,np.float32)
        before=filters.process(x);filters.update(None)
        first=filters.process(x);last=filters.process(x)
        self.assertAlmostEqual(float(first[0]),float(before[-1]),places=6)
        joined=np.concatenate([before,first,last])
        self.assertLess(float(np.max(np.abs(np.diff(joined)))),.001)
        self.assertEqual(len(first),1024);np.testing.assert_array_equal(last[416:],x[416:])
        self.assertIsNone(filters.previous)

    def test_order_controls_threshold_sensitive_effect(self):
        gain=new_filter("gain");gain["params"]["gainDb"]=12
        deesser=new_filter("deesser");deesser["params"].update(thresholdDb=-30,strength=100,frequencyHz=3500)
        x=tone(10000,.025)
        a=FilterChain(chain(gain,deesser)).process(x);b=FilterChain(chain(deesser,gain)).process(x)
        self.assertLess(rms(a[4800:]),.8*rms(b[4800:]))

    def test_every_filter_is_finite_and_lowpass_and_eq_respond(self):
        impulse=np.zeros(48000,np.float32);impulse[0]=.1
        for kind in REGISTRY:
            y=FilterChain(chain(new_filter(kind))).process(impulse)
            self.assertTrue(np.isfinite(y).all());self.assertLess(float(np.max(np.abs(y))),.5)
        lp=new_filter("lowpass");lp["params"]["frequencyHz"]=5000
        self.assertLess(rms(FilterChain(chain(lp)).process(tone(12000))[4800:]),.15*rms(tone(12000)[4800:]))
        eq=new_filter("equalizer");eq["params"].update(frequencyHz=3000,gainDb=-9,q=3)
        self.assertAlmostEqual(rms(FilterChain(chain(eq)).process(tone(3000))[4800:])/rms(tone(3000)[4800:]),10**(-9/20),places=4)

    def test_validation_is_detached_and_rejects_unsupported_values(self):
        valid=default_chain();clean=validate_chain(valid);valid["items"][0]["params"]["strength"]=99
        self.assertEqual(clean["items"][0]["params"]["strength"],35)
        bad=[]
        for key,value in (("type","external.py"),("type",[]),("enabled",1),("name","")):
            p=default_chain();p["items"][0][key]=value;bad.append(p)
        for value in (float("nan"),float("inf"),101,True):
            p=default_chain();p["items"][0]["params"]["strength"]=value;bad.append(p)
        p=default_chain();p["items"].append(copy.deepcopy(p["items"][0]));bad.append(p)
        bad.append(chain(*[new_filter("gain") for _ in range(9)]))
        for p in bad:
            with self.assertRaises(ValueError):validate_chain(p)

    def test_filters_cannot_emit_tails_when_speech_mask_is_closed(self):
        class Model:
            profile={"hopSeconds":.18,"lookaheadSeconds":.08,"historySeconds":.3,"outputGainDb":0,"outputFilters":default_chain()}
            def convert(self,x):return np.ones(len(x),np.float32)*.2,{"processingMs":0,"vramMiB":0}
        composer=Composer(Model());composer.cleaner.mask=lambda _,n:np.zeros(n,np.float32)
        composer.filters.process(tone(1800))
        apply_control(composer,{"filters":None})
        y,_=composer.push(np.zeros(composer.hop+composer.future,np.float32))
        np.testing.assert_array_equal(y,np.zeros_like(y))

    def test_worker_control_ack_preserves_audio_sequence(self):
        base=Path(__file__).resolve().parents[2]/"build"/"test-temp";base.mkdir(exist_ok=True,parents=True)
        with tempfile.TemporaryDirectory(dir=base) as directory:
            path=Path(directory);profile=path/"voice.json"
            (path/"reference.wav").write_bytes(b"fixture")
            (path/"inference.py").write_text("# fixture")
            profile.write_text(json.dumps({"schemaVersion":1,"name":"IPC fixture","backend":"seed-whisper-large","sourceRepo":".","cacheDirectory":".","reference":"reference.wav","steps":4,"hopSeconds":.18,"lookaheadSeconds":.08,"historySeconds":.3,"referenceSeconds":1,"outputGainDb":0}),encoding="utf-8")
            client=WorkerClient(profile,path/"worker.log",Path(__file__).with_name("worker_fixture.py"))
            try:
                ready=client.ready();hop=ready["hopFrames"];future=ready["lookaheadFrames"]
                client.update_filters(default_chain())
                first,meta=client.convert(np.zeros(hop+future,np.float32));self.assertEqual(meta["sequence"],0)
                client.update_filters(None);client.update_tone({"softnessDb":1})
                second,meta=client.convert(np.zeros(hop,np.float32));self.assertEqual(meta["sequence"],1)
                np.testing.assert_array_equal(first,np.zeros(hop,np.float32));np.testing.assert_array_equal(second,np.zeros(hop,np.float32))
            finally:client.close()

if __name__=="__main__":unittest.main()
