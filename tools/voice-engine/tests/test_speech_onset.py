"""Aperiodic onset, protected body, and conservative abstention."""
import sys,unittest
from pathlib import Path
import numpy as np
from scipy.ndimage import gaussian_filter1d
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from speech_onset import eligible_onset,onset_vowel,needs_onset_context,soften_onset

RATE=24000
def vowel(seconds=.24):
    time=np.arange(round(seconds*RATE))/RATE
    wave=sum(np.sin(2*np.pi*240*k*time)/k for k in range(1,30)).astype(np.float32)
    wave*=.15/max(np.max(np.abs(wave)),1e-6)
    fade=np.minimum(np.arange(len(wave))/480,1)*np.minimum(np.arange(len(wave))[::-1]/480,1)
    return (wave*fade).astype(np.float32)
def clip():return np.concatenate((np.zeros(1920,np.float32),vowel(),np.zeros(8400,np.float32),vowel(.7)))
def periodicity(wave):
    wave=wave-wave.mean();corr=np.correlate(wave,wave,'full')[len(wave)-1:]
    return corr[40:240].max()/corr[0]

class OnsetTests(unittest.TestCase):
    def test_only_explicit_shy_vowels_are_eligible(self):
        for text in ('あ、あなたのことが大好きです','「ぁっ……あなたのことが大好き」','あ……今日は嬉しいです','ぁっ・・・あなたのことが',
                     'い、行きます。','う、うん。','え、ええんですか。','お、おっきい。',
                     'ぃっ……行きます','「ぅ・・・うん」','うっ。うん。','ぇ、ええんですか','ぉっ…おっきい','イ、行きます','ｳ､うん','エッ・・・ええんですか','ォ、おっきい'):
            self.assertTrue(eligible_onset(text,'shy'))
            for style in ('auto','cheerful','gentle','sad','surprised','whisper'):
                self.assertFalse(eligible_onset(text,style))
        for text in ('あなたのことが大好きです','あの、話します','だ、大好きです','み、みんな','行きます。','うん、そうです','ええ、そうです','おお、すごい','い.行きます'):
            self.assertFalse(eligible_onset(text,'shy'))
        for text,expected in [('ｨ､行きます','い'),('「ウッ……うん」','う'),('ぇ、ええんですか','え'),('オ、おっきい','お'),('ぁっ・・・あなた','あ')]:
            self.assertEqual(onset_vowel(text,'shy'),expected)

    def test_removes_periodicity_only_from_isolated_intro(self):
        source=clip();result,meta=soften_onset(source)
        self.assertEqual(meta['breathyOnset'],1)
        end=round(meta['breathyOnsetEndMs']/1000*RATE)
        self.assertTrue(np.array_equal(source[end:],result[end:]))
        self.assertEqual(len(result),len(source));self.assertTrue(np.isfinite(result).all())
        a,b=round(.12*RATE),round(.24*RATE)
        self.assertGreater(periodicity(source[a:b]),.8)
        self.assertLess(periodicity(result[a:b]),.3)
        self.assertLess(np.sqrt(np.mean(result[a:b]**2)),np.sqrt(np.mean(source[a:b]**2))*.4)

    def test_first_packet_and_whole_pcm_are_identical_and_deterministic(self):
        source=clip();whole,meta=soften_onset(source)
        count=round(.64*RATE);first,_=soften_onset(source[:count])
        self.assertTrue(np.array_equal(whole,np.concatenate((first,source[count:]))))
        self.assertTrue(np.array_equal(whole,soften_onset(source)[0]))
        self.assertEqual(meta['breathyOnset'],1)

    def test_each_vowel_keeps_its_own_resonances_instead_of_a_shared_breath(self):
        time=np.arange(5760)/RATE
        profiles=[];results=[]
        def profile(wave):
            # Compare broad envelopes, independent of harmonics/noise phases.
            spectrum=gaussian_filter1d(abs(np.fft.rfft(wave[2800:6400]*np.hanning(3600))),24)[:500]
            return spectrum/np.linalg.norm(spectrum)
        for name,centers in [('a',(800,1300)),('i',(300,2400)),('u',(350,1100)),('e',(500,2000)),('o',(500,900))]:
            with self.subTest(vowel=name):
                wave=sum(np.sin(2*np.pi*160*k*time)*sum(np.exp(-.5*((160*k-center)/90)**2) for center in centers) for k in range(1,50))
                wave*=.15/np.max(abs(wave))
                wave*=np.minimum(np.arange(len(wave))/480,1)*np.minimum(np.arange(len(wave))[::-1]/480,1)
                source=np.r_[np.zeros(1920),wave,np.zeros(8400),vowel(.7)].astype(np.float32)
                result,meta=soften_onset(source)
                self.assertEqual(meta['breathyOnset'],1)
                end=round(meta['breathyOnsetEndMs']*24)
                self.assertTrue(np.array_equal(source[end:],result[end:]))
                # At the known 160 Hz source period; a formant can correlate at
                # shorter lags even when its excitation is entirely aperiodic.
                pitch_corr=np.dot(result[2800:6250],result[2950:6400])/np.dot(result[2800:6250],result[2800:6250])
                self.assertLess(abs(pitch_corr),.3)
                profiles.append(profile(source));results.append(profile(result))
        similarities=np.asarray(results)@np.asarray(profiles).T
        np.testing.assert_array_equal(similarities.argmax(axis=1),np.arange(5))
        self.assertTrue(np.all(similarities.diagonal()>.8))

    def test_continuous_speech_silence_late_onset_and_notched_articulation_abstain(self):
        changing=vowel().copy();changing[1800:2400]=0
        sources=[np.zeros(RATE,np.float32),vowel(1.),np.r_[np.zeros(6000),vowel(),np.zeros(6000)],
            np.r_[np.zeros(1920),changing,np.zeros(8400)]]
        for source in sources:
            source=source.astype(np.float32);result,meta=soften_onset(source)
            self.assertEqual(meta['breathyOnset'],0);self.assertTrue(np.array_equal(source,result))

    def test_late_isolated_vowel_can_cross_a_packet_without_touching_the_body(self):
        source=np.r_[np.zeros(round(.62*RATE)),vowel(.16),np.zeros(round(.4*RATE)),vowel(.7)].astype(np.float32)
        self.assertTrue(needs_onset_context(source[:15360]))
        self.assertFalse(needs_onset_context(source[:23040]))
        whole,meta=soften_onset(source,extended=True)
        first,first_meta=soften_onset(source[:23040],extended=True)
        self.assertEqual(meta['breathyOnset'],1);self.assertEqual(first_meta,meta)
        np.testing.assert_array_equal(whole,np.r_[first,source[23040:]])
        end=round(meta['breathyOnsetEndMs']*24)
        np.testing.assert_array_equal(whole[end:],source[end:])

    def test_extended_context_is_bounded_and_never_swallows_continuous_speech(self):
        self.assertFalse(needs_onset_context(np.zeros(30720,np.float32)))
        self.assertFalse(needs_onset_context(vowel(.64)))
        for source in (vowel(1.5),np.r_[np.zeros(18000),vowel(),np.zeros(10000)].astype(np.float32)):
            result,meta=soften_onset(source,extended=True)
            self.assertEqual(meta['breathyOnset'],0);np.testing.assert_array_equal(result,source)

if __name__=='__main__':unittest.main()
