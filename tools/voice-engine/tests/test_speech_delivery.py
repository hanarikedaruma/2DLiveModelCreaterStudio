"""Selected shy acting, unchanged source words, fixed speaker and safe restarts."""
import sys,unittest
from pathlib import Path
from unittest.mock import Mock
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from speech_delivery import prepare_performance
from speech_config import validate_request,build_delivery_instruction
from speech_worker import Generator

class DeliveryTests(unittest.TestCase):
    def test_other_emotions_keep_every_character(self):
        text='「あなたのことが大好きです」\n今日は10月16日です。'
        for style in ('auto','cheerful','gentle','sad','surprised','whisper'):
            result=prepare_performance(text,style)
            self.assertEqual(result.text,text);self.assertEqual(result.hesitations,0)

    def test_shy_restarts_at_onset_and_affection_without_changing_the_message(self):
        result=prepare_performance('あなたのことが大好きです','shy')
        self.assertEqual(result.text,'あ、あなたのことが…だ、大好きです');self.assertEqual(result.hesitations,2)
        self.assertEqual(prepare_performance('大好きです','shy').text,'だ、大好きです')

    def test_shy_does_not_guess_ambiguous_kanji_dates_or_name_readings(self):
        self.assertEqual(prepare_performance('今日は嬉しいです','shy').text,'あ……今日は…う、嬉しいです')
        for text in ('一条さんに伝えます','10月16日に会おう','ABCという名前です'):
            self.assertEqual(prepare_performance(text,'shy').text,'あ……'+text)

    def test_small_kana_digraph_and_halfwidth_voicing_stay_one_mora(self):
        for text,prefix in [('きょうは晴れ','きょ、'),('ジェーンです','じぇ、'),('ｷｬﾝﾌﾟに行きたい','きゃ、'),('ｶﾞﾝﾊﾞﾘﾏｽ','が、')]:
            self.assertEqual(prepare_performance(text,'shy').text,prefix+text)

    def test_explicit_restarts_are_not_doubled(self):
        for text in ('あ、あなたのことが…だ、大好きです','あの、あなたのことが…だ、大好きです','えっと、話します'):
            result=prepare_performance(text,'shy');self.assertEqual(result.text,text);self.assertEqual(result.hesitations,0)

    def test_written_airy_onsets_and_caught_restarts_are_not_doubled(self):
        for text in ('ぁっ・・・あなたのことがぁ・・・だっ・・・だいすきぃ',
                     'ぁっ……あなたのことがぁ……だっ……大好きです',
                     'あ…あなたのことが…だっ…大好きです'):
            result=prepare_performance(text,'shy');self.assertEqual(result.text,text);self.assertEqual(result.hesitations,0)

    def test_explicit_vowel_examples_keep_their_text_and_single_restart(self):
        for text in ('い、行きます。','う、うん。','え、ええんですか。','お、おっきい。'):
            with self.subTest(text=text):
                result=prepare_performance(text,'shy')
                expected='うっ。うん。' if text=='う、うん。' else text.replace('、','、 ',1)
                self.assertEqual(result.text,expected);self.assertEqual(result.hesitations,0)

    def test_vowel_separation_is_idempotent_and_keeps_other_emotions_verbatim(self):
        for text in ('い、 行きます。','うっ。うん。','う、\nうん。','え、 ええんですか。','お、 おっきい。'):
            self.assertEqual(prepare_performance(text,'shy').text,text)
        for style in ('auto','cheerful','gentle','sad','surprised','whisper'):
            self.assertEqual(prepare_performance('う、うん。',style).text,'う、うん。')

    def test_negation_quotes_and_input_limit_are_preserved(self):
        self.assertEqual(prepare_performance('「あなたのことが好きじゃない」','shy').text,'「あ、あなたのことが…す、好きじゃない」')
        result=prepare_performance('あなたが大好き。'*30,'shy')
        self.assertLessEqual(result.hesitations,2);self.assertLessEqual(len(result.text),len('あなたが大好き。'*30)+8)
        self.assertEqual(prepare_performance('「  ','shy').hesitations,0)

    def test_worker_only_changes_performance_text_and_keeps_reference_prompt(self):
        request=validate_request(dict(schemaVersion=1,text='あなたのことが大好きです',preferences=dict(style='shy')))
        generator=Generator.__new__(Generator);generator.prepare_speaker=Mock();generator.model=Mock();generator.prompt='fixed-reference'
        generator.model._tokenize_texts.return_value=['instruction']
        generator.synthesize(request)
        generator.model.generate_voice_clone.assert_called_once_with(text='あ、あなたのことが…だ、大好きです',language='Japanese',
            voice_clone_prompt='fixed-reference',instruct_ids=['instruction'],non_streaming_mode=True,max_new_tokens=1536)
        self.assertEqual(request['text'],'あなたのことが大好きです');self.assertEqual(generator.performance_metrics['hesitations'],2)
        self.assertIn('reference speaker',build_delivery_instruction(request))

    def test_worker_keeps_reference_and_original_request_for_all_vowel_examples(self):
        for text,planned,kana in [('い、行きます。','い、 行きます。','い'),('う、うん。','うっ。うん。','う'),
                                  ('え、ええんですか。','え、 ええんですか。','え'),('お、おっきい。','お、 おっきい。','お')]:
            with self.subTest(text=text):
                request=validate_request(dict(schemaVersion=1,text=text,preferences=dict(style='shy')))
                generator=Generator.__new__(Generator);generator.prepare_speaker=Mock();generator.model=Mock();generator.prompt='fixed-reference'
                generator.model._tokenize_texts.return_value=['instruction'];generator.synthesize(request)
                call=generator.model.generate_voice_clone.call_args.kwargs
                self.assertEqual(call['text'],planned);self.assertEqual(call['voice_clone_prompt'],'fixed-reference')
                self.assertEqual(generator.breathy_onset_vowel,kana);self.assertTrue(generator.breathy_onset)
                self.assertEqual(request['text'],text);self.assertEqual(generator.performance_metrics['hesitations'],0)

if __name__=='__main__':unittest.main()
