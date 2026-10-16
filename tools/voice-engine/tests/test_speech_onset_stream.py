"""Late vowel packets, end-of-stream and cancellation through the actual adapter."""
import sys,threading,unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock,patch
import numpy as np
import torch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from speech_stream_backend import generate_stream,SpeechCancelled
from speech_onset import soften_onset
from test_speech_onset import vowel

class OnsetStreamTests(unittest.TestCase):
    def run_adapter(self,audio,cancel_at=None,shy=False):
        cancelled=threading.Event();chunks=[];offsets=[];count=len(audio)//1920
        class Talker:
            config=SimpleNamespace(codec_eos_token_id=999,num_code_groups=16)
            def register_forward_hook(self,hook):
                self.hook=hook;self.removed=False
                return SimpleNamespace(remove=lambda:setattr(self,'removed',True))
            def generate(self,**kwargs):
                for index in range(count):
                    if index==cancel_at:cancelled.set()
                    self.hook(None,None,SimpleNamespace(hidden_states=(None,torch.full((1,16),index))))
                return SimpleNamespace(sequences=torch.tensor([[999]]))
        class Decoder:
            position=0
            def __enter__(self):return self
            def __exit__(self,*unused):pass
            def feed(self,codes):
                size=codes.shape[-1]*1920;start=self.position;self.position+=size
                return torch.from_numpy(audio[start:self.position].copy())
        talker=Talker();decoder=Decoder()
        tokenizer=SimpleNamespace(get_output_sample_rate=lambda:24000,model=SimpleNamespace(get_decode_upsample_rate=lambda:1920))
        generator=SimpleNamespace(torch=torch,np=np,prepare_speaker=Mock(),speaker_key='fixed',
            model=SimpleNamespace(model=SimpleNamespace(talker=talker,speech_tokenizer=tokenizer)),
            breathy_onset=True,breathy_onset_vowel='い',performance_text='い、行きます。',performance_metrics={})
        generator.synthesize=lambda request:talker.generate()
        def emit(wave,rate,offset):
            self.assertEqual(rate,24000);self.assertLessEqual(len(wave),15360)
            offsets.append(offset);chunks.append(wave.copy())
        with patch('speech_stream_backend.verify_stream_backend'),patch('speech_decoder.prepare_decoder',return_value=decoder),patch('torch.cuda.max_memory_allocated',return_value=0):
            if cancel_at is not None:
                with self.assertRaises(SpeechCancelled):generate_stream(generator,{'seed':31415,'preferences':{'style':'shy' if shy else 'auto'}},emit,cancelled)
                self.assertEqual(chunks,[])
                meta={}
            else:
                meta=generate_stream(generator,{'seed':31415,'preferences':{'style':'shy' if shy else 'auto'}},emit,cancelled)
        self.assertTrue(talker.removed);self.assertNotIn('generate',talker.__dict__)
        if cancel_at is not None:return
        self.assertEqual(offsets,np.cumsum([0]+[len(chunk) for chunk in chunks[:-1]]).tolist())
        return np.concatenate(chunks),meta

    def test_late_vowel_matches_whole_effect_and_packets_stay_bounded(self):
        audio=np.r_[np.zeros(14880),vowel(.16),np.zeros(9600),vowel(.7),np.zeros(960)].astype(np.float32)
        self.assertEqual(len(audio)%1920,0)
        output,meta=self.run_adapter(audio)
        expected,_=soften_onset(audio,extended=True)
        np.testing.assert_array_equal(output,expected)
        self.assertEqual(meta['breathyOnset'],1);self.assertEqual(meta['breathyOnsetContextMs'],960)
        self.assertEqual(meta['frames'],len(audio))

    def test_eof_releases_exact_or_partial_held_packet_without_loss(self):
        for count in (8,10,16):
            with self.subTest(frames=count):
                audio=np.zeros(count*1920,np.float32)
                output,meta=self.run_adapter(audio)
                np.testing.assert_array_equal(output,audio)
                self.assertEqual(meta['frames'],len(audio));self.assertEqual(meta['breathyOnset'],0)

    def test_cancel_during_late_onset_wait_discards_pending_pcm_and_restores_hook(self):
        self.run_adapter(np.zeros(16*1920,np.float32),cancel_at=8)

    def test_actual_adapter_applies_both_onsets_tempo_and_ending_before_emitting(self):
        from speech_shy import ShyRenderer
        audio=np.r_[np.zeros(14880),vowel(.16),np.zeros(9600),vowel(.7),np.zeros(960)].astype(np.float32)
        initial,first_meta=soften_onset(audio,extended=True)
        renderer=ShyRenderer(audio,first_meta,'い','い、行きます。',31415)
        expected=np.r_[renderer.feed(initial),renderer.finish()]
        output,meta=self.run_adapter(audio,shy=True)
        np.testing.assert_array_equal(output,expected)
        self.assertEqual(meta['breathyOnset'],1);self.assertEqual(meta['breathyWordOnset'],1)
        self.assertGreaterEqual(meta['shyIntroGapMs'],650);self.assertGreaterEqual(meta['shyTailBreaths'],1)
        self.assertEqual(meta['shyTempoRatio'],.88);self.assertEqual(meta['frames'],len(output))

if __name__=='__main__':unittest.main()
