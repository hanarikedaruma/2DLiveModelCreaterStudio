"""Packet splitting preserves causal filters; utterances own independent state."""
import sys
from pathlib import Path
from types import SimpleNamespace
import unittest

import torch
from torch import nn
from torch.nn import functional as F

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from speech_decoder import DecoderState, DecoderSession, causal_convolution, causal_transpose


class DecoderTests(unittest.TestCase):
    def test_convolution_matches_whole_audio_across_odd_packet_sizes_and_dilations(self):
        torch.manual_seed(19)
        for dilation in (1, 3, 9):
            for groups in (1, 4):
                convolution = nn.Conv1d(4, 4, 7, dilation=dilation, groups=groups)
                module = SimpleNamespace(conv=convolution, stride=1, padding=6*dilation)
                audio = torch.randn(1, 4, 173)
                expected = convolution(F.pad(audio, (module.padding, 0)))
                state, pieces, begin = {}, [], 0
                for count in (1, 7, 3, 58, 104):
                    pieces.append(causal_convolution(torch, module, audio[..., begin:begin+count], state, 'conv'))
                    begin += count
                torch.testing.assert_close(torch.cat(pieces, -1), expected, atol=1e-6, rtol=1e-6)
                self.assertEqual(state['conv'].shape[-1], module.padding)

    def test_transpose_preserves_overlap_and_nonzero_bias_without_extra_samples(self):
        torch.manual_seed(20)
        for stride in (2, 3, 4, 5, 8):
            for overlap in (0, stride):
                convolution = nn.ConvTranspose1d(3, 4, stride+overlap, stride=stride)
                nn.init.constant_(convolution.bias, .37)
                module = SimpleNamespace(conv=convolution, right_pad=overlap)
                audio = torch.randn(1, 3, 17)
                expected = convolution(audio)[..., :audio.shape[-1]*stride]
                state, pieces, begin = {}, [], 0
                for count in (1, 2, 7, 1, 6):
                    pieces.append(causal_transpose(torch, module, audio[..., begin:begin+count], state, 'up'))
                    begin += count
                actual = torch.cat(pieces, -1)
                self.assertEqual(actual.shape[-1], 17*stride)
                torch.testing.assert_close(actual, expected, atol=1e-6, rtol=1e-6)

    def test_reference_state_forks_without_mutating_another_utterance(self):
        reference = DecoderState()
        reference.tails['conv'] = torch.arange(8.)
        a, b = reference.fork(None), reference.fork(None)
        a.tails['conv'].zero_()
        torch.testing.assert_close(reference.tails['conv'], torch.arange(8.))
        torch.testing.assert_close(b.tails['conv'], torch.arange(8.))

    def test_cancel_restores_decoder_methods_and_next_session_starts_fresh(self):
        class Qwen3TTSTokenizerV2CausalConvNet(nn.Module):
            def __init__(self):
                super().__init__()
                self.conv = nn.Conv1d(1, 1, 3)
                self.stride, self.padding = 1, 2

            def forward(self, audio):
                return self.conv(F.pad(audio, (2, 0)))

        class Decoder(nn.Module):
            def __init__(self):
                super().__init__()
                self.filter = Qwen3TTSTokenizerV2CausalConvNet()
                self.pre_transformer = nn.Identity()
                self.pre_transformer.config = SimpleNamespace(layer_types=['sliding_attention'], num_hidden_layers=1)

            def forward(self, audio):
                return self.filter(audio)

        decoder = Decoder()
        audio = torch.ones(1, 1, 8)
        expected = decoder(audio)
        with self.assertRaisesRegex(RuntimeError, 'cancel'):
            with DecoderSession(torch, decoder) as session:
                session.feed(audio)
                raise RuntimeError('cancel')
        self.assertNotIn('forward', decoder.filter.__dict__)
        self.assertNotIn('forward', decoder.pre_transformer.__dict__)
        torch.testing.assert_close(decoder(audio), expected)
        with DecoderSession(torch, decoder) as session:
            torch.testing.assert_close(session.feed(audio), expected)


if __name__ == '__main__':
    unittest.main()
