# SPDX-License-Identifier: GPL-3.0-or-later
"""Keep the pinned causal vocoder's convolution and attention state across PCM chunks.

Re-decoding a short codec lookback resets eight layers of acoustic history. A
speaker prompt alone cannot prevent the resulting octave/timbre discontinuities.
No pitch shifting, resampling or model/sampling changes are applied here.
"""


class DecoderState:
    def __init__(self):
        self.tails = {}
        self.attention = None

    def fork(self, config):
        copy = DecoderState()
        copy.tails = {name: tail.clone() for name, tail in self.tails.items()}
        if self.attention is not None:
            from transformers import DynamicCache
            copy.attention = DynamicCache(config=config)
            for source, target in zip(self.attention.layers, copy.attention.layers):
                if not source.is_initialized:
                    continue
                target.lazy_initialization(source.keys)
                target.keys = source.keys.clone()
                target.values = source.values.clone()
                if hasattr(source, 'cumulative_length'):
                    target.cumulative_length = source.cumulative_length
        return copy


def causal_convolution(torch, module, audio, tails, name):
    if module.stride != 1:
        raise ValueError('対応していない音声復号の畳み込みです')
    padding = module.padding
    if padding:
        previous = tails.get(name)
        if previous is None:
            previous = audio.new_zeros((*audio.shape[:-1], padding))
        audio = torch.cat((previous, audio), dim=-1)
        tails[name] = audio[..., -padding:].clone()
    return module.conv(audio).contiguous()


def causal_transpose(torch, module, audio, tails, name):
    stride = module.conv.stride[0]
    # Re-evaluate just the overlapping input frame, keeping the original bias
    # and accumulation order instead of adding rounded output tails together.
    keep = (module.right_pad + stride - 1) // stride
    previous = tails.get(name)
    prefix = 0 if previous is None else previous.shape[-1]
    if previous is not None:
        audio = torch.cat((previous, audio), dim=-1)
    if keep:
        tails[name] = audio[..., -keep:].clone()
    wave = module.conv(audio)
    end = wave.shape[-1] - module.right_pad
    return wave[..., prefix * stride:end].contiguous()


class DecoderSession:
    """Temporary worker-local adapters; always restore original bound methods."""
    def __init__(self, torch, decoder, state=None):
        self.torch = torch
        self.decoder = decoder
        self.state = state if state is not None else DecoderState()
        self.restore = []

    def __enter__(self):
        transformer = self.decoder.pre_transformer
        if transformer.config.layer_types != ['sliding_attention'] * transformer.config.num_hidden_layers:
            raise ValueError('対応していない音声復号の注意機構です')
        try:
            for name, module in self.decoder.named_modules():
                kind = type(module).__name__
                if kind == 'Qwen3TTSTokenizerV2CausalConvNet':
                    if module.stride != 1:
                        raise ValueError('対応していない音声復号の畳み込みです')
                    self._replace(module, lambda audio, m=module, n=name: causal_convolution(
                        self.torch, m, audio, self.state.tails, n))
                elif kind == 'Qwen3TTSTokenizerV2CausalTransConvNet':
                    self._replace(module, lambda audio, m=module, n=name: causal_transpose(
                        self.torch, m, audio, self.state.tails, n))
            original = transformer.forward

            def attention(*, inputs_embeds):
                output = original(inputs_embeds=inputs_embeds, past_key_values=self.state.attention, use_cache=True)
                self.state.attention = output.past_key_values
                return output

            self._replace(transformer, attention)
            return self
        except Exception:
            self.__exit__(None, None, None)
            raise

    def _replace(self, module, method):
        self.restore.append((module, 'forward' in module.__dict__, module.__dict__.get('forward')))
        module.forward = method

    def __exit__(self, *unused):
        for module, had_local, original in reversed(self.restore):
            if had_local:
                module.forward = original
            else:
                del module.forward
        self.restore.clear()

    def feed(self, codes):
        return self.decoder(codes)


def prepare_decoder(generator, cancelled):
    """Prime once per reference; each utterance receives independent small state."""
    from speech_stream_backend import SpeechCancelled
    decoder = generator.model.model.speech_tokenizer.model.decoder
    cached = getattr(generator, 'decoder_reference', None)
    if cached is None or cached[0] != generator.speaker_key:
        state = DecoderState()
        reference = generator.prompt[0].ref_code
        with DecoderSession(generator.torch, decoder, state) as session:
            if reference is not None:
                for begin in range(0, reference.shape[0], 64):
                    if cancelled.is_set():
                        raise SpeechCancelled()
                    session.feed(reference[begin:begin+64].T.unsqueeze(0))
        generator.decoder_reference = (generator.speaker_key, state)
    return DecoderSession(generator.torch, decoder,
                          generator.decoder_reference[1].fork(decoder.pre_transformer.config))
