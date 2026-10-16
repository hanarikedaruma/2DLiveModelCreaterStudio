"""Speech boundaries, semantic prompt routing, mute, and cancel ownership."""
import json,queue,sys,tempfile,threading,unittest
from pathlib import Path
from unittest.mock import patch
import numpy as np
import sounddevice as sd
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from speech_config import validate_request,build_instruction,validate_preferences,voice_description,MODEL_ID,DEFAULT_VOICE
from speech import prepare_audio,SpeechJob,SpeechPlayer
TEMP_ROOT=Path(__file__).resolve().parents[3]/".cache"/"speech-tests"
TEMP_ROOT.mkdir(parents=True,exist_ok=True)

class SpeechTests(unittest.TestCase):
    def request(self,**values):return validate_request({"schemaVersion":1,"text":"そうなんだ。今日は一緒に帰ろうね。",**values})
    def test_context_is_instruction_and_current_text_stays_separate(self):
        request=self.request(history=["試験に落ちて、悲しい。"],preferences={"scene":"励ます", "style":"gentle"})
        instruction=build_instruction(request)
        self.assertIn("試験に落ちて、悲しい。",instruction);self.assertIn("励ます",instruction)
        self.assertNotIn(request["text"],instruction);self.assertIn("Do not repeat",instruction)
        request=self.request(history=["前の発話"],preferences={"useContext":False})
        self.assertEqual(request["history"],[]);self.assertNotIn("前の発話",build_instruction(request))
    def test_request_limits_and_controls_are_strict(self):
        for values in ({"text":" "},{"text":"あ"*301},{"history":["a"]*4},{"history":[13]},{"seed":True},{"seed":-1},{"preferences":{"style":"unknown"}},{"preferences":{"useContext":1}},{"preferences":{"voice":"短い"}},{"preferences":{"scene":"\x00"}}):
            with self.assertRaises(ValueError):self.request(**values)
        self.assertEqual(self.request(text="あ")["text"],"あ")
    def test_same_text_retained_when_only_scene_changes(self):
        a=self.request(preferences={"scene":"落ち込んだ友人を励ます"});b=self.request(preferences={"scene":"嬉しい知らせを聞いて喜ぶ"})
        self.assertEqual(a["text"],b["text"]);self.assertNotEqual(build_instruction(a),build_instruction(b))
    def test_voice_description_inherits_only_bounded_design_metadata(self):
        with tempfile.TemporaryDirectory(dir=TEMP_ROOT) as directory:
            reference=Path(directory)/"voice.wav";meta=reference.with_suffix(".json")
            meta.write_text(json.dumps({"model":MODEL_ID,"instruction":"柔らかく温かい女性声"}),encoding="utf-8")
            self.assertEqual(voice_description({"reference":str(reference)}),"柔らかく温かい女性声")
            meta.write_text(json.dumps({"model":"other","instruction":"別モデルの指示"}),encoding="utf-8")
            self.assertEqual(voice_description({"reference":str(reference)}),DEFAULT_VOICE)
    def test_postprocessing_resamples_preserves_time_and_limits_gain(self):
        x=np.sin(np.arange(24000)*2*np.pi*440/24000).astype(np.float32)
        y=prepare_audio(x,24000,{"outputGainDb":12},False)
        self.assertEqual(len(y),48000);self.assertTrue(np.isfinite(y).all());self.assertLessEqual(float(np.max(np.abs(y))),.891251)
        self.assertEqual(y[0],0);self.assertEqual(y[-1],0)
        with self.assertRaises(ValueError):prepare_audio(np.array([np.nan]*2400),24000,{},False)
    def test_player_routes_mono_to_both_channels_mute_and_stops_at_end(self):
        player=SpeechPlayer.__new__(SpeechPlayer);player.audio=np.full(960,.1,np.float32);player.position=0
        player.mix=1.;player.muted=lambda:False;player.error="";player.peak=0
        player.playback=queue.Queue(maxsize=1);player.sequence=0;player.first_audio_dac_ms=None
        player.unlock=threading.Event()
        class Times:currentTime=100.;outputBufferDacTime=100.02
        out=np.empty((480,2),np.float32)
        with patch('speech.time.perf_counter',return_value=5.):player.callback(out,480,Times(),False)
        sequence,position,dac,pcm=player.playback.get_nowait()
        self.assertEqual((sequence,position),(0,0));self.assertAlmostEqual(dac,5020)
        self.assertAlmostEqual(player.first_audio_dac_ms,5020)
        np.testing.assert_array_equal(pcm,out[:,0])
        np.testing.assert_array_equal(out[:,0],out[:,1]);self.assertAlmostEqual(float(out[0,0]),.1)
        player.muted=lambda:True
        with self.assertRaises(sd.CallbackStop):player.callback(out,480,Times(),False)
        self.assertEqual(out[-1,0],0);self.assertLess(out[200,0],.1)
        player.position=0
        with self.assertRaises(sd.CallbackAbort):player.callback(out,480,Times(),True)
        np.testing.assert_array_equal(out,np.zeros((480,2),np.float32))
    def test_wasapi_com_stream_and_mutex_share_one_owner_thread(self):
        events=[]
        def record(action):events.append((action,threading.get_ident()))
        class Ole:
            def CoInitializeEx(self,*args):record('com-start');return 0
            def CoUninitialize(self):record('com-end')
        class Lock:
            def __init__(self,*args):pass
            def __enter__(self):record('lock')
            def __exit__(self,*args):record('unlock')
        class Stream:
            def __init__(self,**kwargs):record('open')
            @property
            def time(self):return 1.
            def start(self):record('start')
            def abort(self):record('abort')
            def close(self):record('close')
        with patch('speech.ctypes.WinDLL',return_value=Ole()),patch('execution_lock.ExecutionLock',Lock),patch('speech.sd.OutputStream',Stream):
            player=SpeechPlayer(np.zeros(480,np.float32),1,2,lambda:True)
            player.close()
        self.assertEqual([action for action,_ in events],['com-start','lock','open','start','abort','close','unlock','com-end'])
        self.assertEqual(len({owner for _,owner in events}),1)
        self.assertNotEqual(events[0][1],threading.get_ident())
    def test_cancel_during_subprocess_creation_kills_owned_process_and_cleans_text(self):
        with tempfile.TemporaryDirectory(dir=TEMP_ROOT) as directory:
            events=queue.Queue();job=SpeechJob(directory,events);entered=threading.Event();release=threading.Event()
            class Process:
                returncode=1
                stdin=None;stdout=None
                def poll(self):return None
                def wait(self,timeout=None):return 1
            child=Process()
            def create(*args,**kwargs):entered.set();release.wait(3);return child
            with patch("speech.subprocess.Popen",side_effect=create),patch("speech.stop_owned_process") as stop:
                job.start("python","cache",self.request(),{})
                self.assertTrue(entered.wait(3));job.cancel();release.set();job.thread.join(3)
                stop.assert_called_once_with(child)
            self.assertFalse(job.active());self.assertTrue(events.empty())
            self.assertEqual(list((Path(directory)/"speech-temp").iterdir()),[])

if __name__=="__main__":unittest.main()
