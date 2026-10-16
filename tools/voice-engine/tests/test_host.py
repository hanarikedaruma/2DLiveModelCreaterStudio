import copy
import json
from pathlib import Path
import queue
import sys
import tempfile
import threading
import unittest
from unittest.mock import patch
import numpy as np
import soundfile as sf
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from host import Host
from live import LiveEngine

class HostTests(unittest.TestCase):
    def setUp(self):
        directory=Path(__file__).resolve().parents[3]/'.cache'/'voice-tests';directory.mkdir(parents=True,exist_ok=True)
        self.temp=tempfile.TemporaryDirectory(dir=directory);self.root=Path(self.temp.name)
        source=self.root/'external'/'seed-vc';source.mkdir(parents=True);(source/'inference.py').write_text('# fixture')
        self.host=Host.__new__(Host);self.host.data=self.root/'data';self.host.data.mkdir();self.host.model_root=self.root
        self.host.engine=LiveEngine();self.host.job=None;self.host.job_thread=None;self.host.session='test';self.host.project_dir=None
        ref=self.root/'reference.wav';sf.write(ref,np.sin(np.arange(48000)*.03)*.1,48000)
        self.reference=self.host.import_reference(ref)
        self.profile={'name':'Test','backend':'seed-xlsr-tiny','quality':'fast','reference':self.reference,'outputGainDb':-3,'voiceTone':{},'inputCleanup':{'noiseReduction':0,'speechOnly':False,'speechSensitivity':40},'outputFilters':None}
    def tearDown(self):self.temp.cleanup()
    def test_ai_only_and_normalized_assets(self):
        path=self.host.normalize(self.profile)
        value=json.loads(path.read_text());self.assertEqual(value['hopSeconds'],.18);self.assertEqual(value['generationHistorySeconds'],.4);self.assertNotIn('waveformLibrary',value)
        for backend in ('signalsmith-waveform','beatrice','unknown'):
            p={**self.profile,'backend':backend}
            with self.assertRaises(ValueError):self.host.normalize(p)
    def test_reference_is_copied_by_content_and_portable(self):
        self.host.request('persistReferences',{'reference':self.reference,'sourceDir':None,'targetDir':str(self.root/'project')})
        target=self.root/'project'/self.reference;self.assertTrue(target.is_file())
        (self.host.data/'references'/target.name).unlink()
        self.assertEqual(self.host.reference(self.reference,str(self.root/'project')),target)
        target.write_bytes(b'changed')
        with self.assertRaises(ValueError):self.host.reference(self.reference,str(self.root/'project'))
    def test_quality_presets_match_recorded_voicechanger_080(self):
        presets=json.loads((Path(__file__).resolve().parents[1]/'upstream.json').read_text())['qualityPresets']
        for quality,expected in presets.items():
            profile={**self.profile,'quality':quality,'backend':'seed-whisper-large' if quality=='hq' else 'seed-xlsr-tiny'}
            actual=json.loads(self.host.normalize(profile).read_text())
            self.assertEqual({key:actual[key] for key in expected},expected)
    def test_no_path_traversal_or_nonfinite_controls(self):
        for key in ('../../reference.wav','voice/references/../reference.wav','voice/references/x.wav'):
            with self.assertRaises(ValueError):self.host.reference(key)
        for value in (True,float('nan'),25):
            with self.assertRaises(ValueError):self.host.request('controls',{'inputGainDb':value})
    def test_final_output_reports_device_clock_and_mute(self):
        engine=self.host.engine;engine.hop=480;engine.primed=True;engine.target_lag=0;engine.input_ring.w=4000;engine.start_mix=1
        engine.output_ring.write(np.column_stack([np.full(2000,.2),np.full(2000,.3)]));engine.mute=True;engine.mute_mix=0
        out=np.empty((480,1),np.float32)
        class Times:currentTime=100.;outputBufferDacTime=100.02
        with patch('live.time.perf_counter',return_value=5.):engine.output_callback(out,480,Times(),False)
        sequence,source,dac,samples=engine.playback.get_nowait()
        self.assertEqual(sequence,0);self.assertEqual(source,0);self.assertAlmostEqual(dac,5020);self.assertFalse(np.any(samples));np.testing.assert_array_equal(samples,out[:,0])
    def test_playback_queue_overflow_does_not_interrupt_audio(self):
        engine=self.host.engine;engine.hop=480;engine.primed=True;engine.target_lag=0;engine.input_ring.w=4000;engine.start_mix=1
        engine.output_ring.write(np.column_stack([np.full(2000,.2),np.zeros(2000)]));engine.playback=queue.Queue(maxsize=1);engine.playback.put('full')
        engine.output_callback(np.empty((480,1),np.float32),480,object(),False)
        self.assertFalse(engine.stop_event.is_set());self.assertEqual(engine.stats['analysisDrops'],1)
    def test_import_preserves_ai_quality_filters_and_old_filter_default(self):
        original=json.loads(self.host.normalize(self.profile).read_text());path=self.root/'old.json';path.write_text(json.dumps(original))
        imported=self.host.import_profile(path);self.assertFalse(imported['outputFilters']['enabled']);self.assertEqual(imported['advanced']['steps'],4)
        self.assertEqual(imported['reference'],self.reference)
        original['steps']=6;original['hopSeconds']=.24;original['generationHistorySeconds']=.5
        path.write_text(json.dumps(original));imported=self.host.import_profile(path)
        self.assertEqual(imported['quality'],'balanced');self.assertEqual(imported['advanced']['hopSeconds'],.24)

if __name__=='__main__':unittest.main()
