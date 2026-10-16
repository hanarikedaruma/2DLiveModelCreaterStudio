"""Actual shy effects, packet-independent delivery, retained pitch and consonants."""
import sys,unittest
from pathlib import Path
import numpy as np
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from speech_onset import soften_onset
from speech_shy import ShyRenderer,_WordAttack,_AiryEnds
from speech_tempo import SpeechTempo
from test_speech_onset import vowel,RATE

def utterance():
    # An isolated hesitation, then a vowel connected to an unvoiced consonant.
    consonant=np.random.default_rng(7).normal(0,.025,960).astype(np.float32)
    raw=np.r_[np.zeros(1440),vowel(.16),np.zeros(4800),vowel(.06),consonant,vowel(.5),np.zeros(4800)].astype(np.float32)
    return raw,consonant

def tempo(wave,size):
    engine=SpeechTempo();parts=[engine.feed(wave[i:i+size]) for i in range(0,len(wave),size)]
    parts.append(engine.finish());return np.concatenate(parts),engine

def render(wave,size,text='い、行きます。'):
    initial,meta=soften_onset(wave,extended=True)
    renderer=ShyRenderer(wave,meta,'い',text,31415)
    parts=[renderer.feed(initial[i:i+size]) for i in range(0,len(initial),size)]
    parts.append(renderer.finish())
    return np.concatenate(parts),renderer.metrics

class ShyTests(unittest.TestCase):
    def test_slower_tempo_preserves_pitch_and_has_exact_bounded_length(self):
        t=np.arange(3*RATE)/RATE;wave=(np.sin(2*np.pi*240*t)*.15).astype(np.float32)
        output,engine=tempo(wave,15360)
        self.assertEqual(len(output),round(len(wave)/.88))
        middle=output[RATE:-RATE];frequency=np.fft.rfftfreq(len(middle),1/RATE)
        peak=frequency[np.argmax(abs(np.fft.rfft(middle*np.hanning(len(middle)))))]
        self.assertAlmostEqual(peak,240,delta=1.)
        self.assertTrue(np.isfinite(output).all());self.assertLess(np.max(abs(output)),.16)
        self.assertEqual(len(engine.buffer),0)

    def test_tempo_is_identical_for_different_packets_and_rejects_reuse_after_finish(self):
        wave=utterance()[0];whole,_=tempo(wave,len(wave))
        for size in (137,1920,7680,15360):
            output,engine=tempo(wave,size);np.testing.assert_array_equal(output,whole)
            with self.assertRaises(RuntimeError):engine.feed(wave)
        for size in (0,1,240,800):
            output,_=tempo(np.zeros(size,np.float32),137)
            self.assertEqual(len(output),round(size/.88));self.assertTrue(np.isfinite(output).all())

    def test_both_attempts_are_airy_and_the_following_consonant_is_exact(self):
        raw,consonant=utterance();initial,meta=soften_onset(raw,extended=True)
        metrics={};protected=[];word=_WordAttack(raw,meta,'い','い、行きます。',31415,metrics,protected)
        output=np.r_[word.feed(initial),word.feed(np.empty(0,np.float32),final=True)]
        self.assertEqual(meta['breathyOnset'],1);self.assertEqual(metrics['breathyWordOnset'],1)
        self.assertGreaterEqual(metrics['shyIntroGapMs'],650)
        added=round(metrics['shyGapAddedMs']*24)
        consonant_start=1440+3840+4800+1440
        np.testing.assert_array_equal(output[consonant_start+added:consonant_start+added+len(consonant)],consonant)
        self.assertLessEqual(metrics['breathyWordOnsetEndMs']-metrics['breathyWordOnsetStartMs'],130)
        # Everything after this short vowel is preserved before tempo/tail effects.
        end=round(metrics['breathyWordOnsetEndMs']*24)
        np.testing.assert_array_equal(output[end:],initial[end-added:])

    def test_a_different_written_onset_is_not_whispered(self):
        raw,_=utterance();initial,meta=soften_onset(raw,extended=True);metrics={}
        word=_WordAttack(raw,meta,'い','い、みんな。',31415,metrics,[])
        output=word.feed(initial)
        self.assertEqual(metrics['breathyWordOnset'],0)
        added=round(metrics['shyGapAddedMs']*24)
        start=1440+3840+4800
        np.testing.assert_array_equal(output[start+added:],initial[start:])

    def test_very_late_body_abstains_without_losing_held_samples(self):
        raw=np.r_[np.zeros(1440),vowel(.16),np.zeros(3*RATE),vowel(.5)].astype(np.float32)
        initial,meta=soften_onset(raw,extended=True);metrics={}
        word=_WordAttack(raw,meta,'い','い、行きます。',31415,metrics,[])
        chunks=[word.feed(initial[i:i+1920]) for i in range(0,len(initial),1920)]
        chunks.append(word.feed(np.empty(0,np.float32),final=True))
        np.testing.assert_array_equal(np.concatenate(chunks),initial)
        self.assertEqual(metrics['breathyWordOnset'],0)

    def test_non_vowel_restart_also_gets_the_wider_pause_without_whispering_the_word(self):
        raw,_=utterance();metrics={}
        word=_WordAttack(raw,{},'','み、みんな。',31415,metrics,[])
        output=word.feed(raw)
        self.assertEqual(metrics['shyRestartGapEligible'],1)
        self.assertEqual(metrics['breathyWordOnset'],0)
        self.assertGreaterEqual(metrics['shyIntroGapMs'],650)
        added=round(metrics['shyGapAddedMs']*24);start=1440+3840+4800
        np.testing.assert_array_equal(output[start+added:],raw[start:])

    def test_ending_releases_into_air_while_the_word_body_stays_intact(self):
        raw=np.r_[vowel(.6),np.zeros(4800)].astype(np.float32);metrics={}
        ends=_AiryEnds(.002,31415,metrics,[])
        output=np.r_[ends.feed(raw),ends.feed(np.empty(0,np.float32),final=True)]
        self.assertEqual(len(output),len(raw));self.assertEqual(metrics['shyTailBreaths'],1)
        start=round(metrics['shyTailStartMs']*24);end=round(metrics['shyTailEndMs']*24)
        np.testing.assert_array_equal(output[:start],raw[:start])
        self.assertGreater(end-start,1000)
        self.assertLess(np.sqrt(np.mean(output[end-960:end]**2)),np.sqrt(np.mean(raw[end-960:end]**2))*.6)
        for boundary in (start,end,min(len(raw)-1,end+720)):
            self.assertLessEqual(abs(output[boundary]-output[boundary-1]),abs(raw[boundary]-raw[boundary-1])+1e-6)

    def test_full_and_stream_delivery_match_including_mid_phrase_pause_and_end(self):
        raw,_=utterance();raw=np.r_[raw,np.zeros(12000),vowel(.4),np.zeros(2400)].astype(np.float32)
        whole,meta=render(raw,len(raw))
        self.assertEqual(meta['shyDelivery'],1);self.assertEqual(meta['shyTempoRatio'],.88)
        self.assertEqual(meta['breathyWordOnset'],1);self.assertGreaterEqual(meta['shyTailBreaths'],2)
        self.assertGreater(len(whole),len(raw))
        for size in (137,1920,7680,15360):
            output,stream_meta=render(raw,size)
            np.testing.assert_array_equal(output,whole);self.assertEqual(stream_meta,meta)

if __name__=='__main__':unittest.main()
