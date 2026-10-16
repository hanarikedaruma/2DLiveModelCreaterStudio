# SPDX-License-Identifier: GPL-3.0-or-later
"""Capture the pinned Qwen residual predictor's unchanged 15-token calculation.

Only single-frame inference is captured. Text conditioning, the main talker,
speaker prompt and waveform decoder retain their original paths. Every replay
has fresh sampling; the generated tokens are copied out of graph-owned storage.
"""
import os
import sys
from types import SimpleNamespace


class PredictorGraph:
    def __init__(self, torch, predictor):
        self.t = torch
        self.predictor = predictor
        self.original = predictor.generate
        self.graph = None
        self.disabled_reason = ''
        self.replays = 0
        self.verified = False

    def _run(self, inputs):
        t = self.t
        ids, logits = [], []
        for step in range(15):
            self.cache.length = step + 2
            output = self.predictor(
                inputs_embeds=inputs if step == 0 else None,
                input_ids=None if step == 0 else ids[-1],
                generation_steps=step, past_key_values=self.cache,
                cache_position=self.positions[step],
                attention_mask={'full_attention': None}, use_cache=True,
                output_hidden_states=False, return_dict=True)
            # Match HF's temperature, top-k and multinomial sampling in FP32.
            scores = output.logits[:, -1, :].float() / .9
            scores = scores.masked_fill(scores < t.topk(scores, 50)[0][:, -1:], float('-inf'))
            ids.append(t.multinomial(t.softmax(scores, dim=-1), num_samples=1))
            logits.append(output.logits[:, -1, :].float())
        return t.cat(ids, dim=-1), t.stack(logits, dim=1)

    def _capture(self, inputs):
        from transformers import StaticCache
        t = self.t

        class FrameCache(StaticCache):
            def update(cache, *args, **kwargs):
                keys, values = super().update(*args, **kwargs)
                # Use exactly the same key lengths and causal SDPA path as the
                # original dynamic cache; future slots are never attended to.
                return keys[:, :, :cache.length, :], values[:, :, :cache.length, :]

        self.cache = FrameCache(config=self.predictor.config, max_cache_len=16)
        self.static = inputs.clone()
        self.positions = [t.arange(2, device=inputs.device)] + [
            t.tensor([step + 1], device=inputs.device) for step in range(1, 15)]
        stream = t.cuda.Stream()
        stream.wait_stream(t.cuda.current_stream())
        with t.cuda.stream(stream):
            for _ in range(3):
                self._run(self.static)
        t.cuda.current_stream().wait_stream(stream)
        graph = t.cuda.CUDAGraph()
        with t.cuda.graph(graph):
            self.output, self.logits = self._run(self.static)
        graph.replay()
        # Verify every codebook against the original forward/DynamicCache using
        # the captured token trajectory, independently of sampling RNG offsets.
        past = None
        for step in range(15):
            reference = self.predictor(
                inputs_embeds=inputs if step == 0 else None,
                input_ids=None if step == 0 else self.output[:, step-1:step],
                generation_steps=step, past_key_values=past, use_cache=True,
                output_hidden_states=False, return_dict=True)
            past = reference.past_key_values
            if not t.equal(reference.logits[:, -1, :].float(), self.logits[:, step]):
                raise ValueError('音声コード予測の最適化前後でAI出力が一致しません')
        self.verified = True
        self.graph = graph

    def __call__(self, *args, **kwargs):
        t = self.t
        inputs = kwargs.get('inputs_embeds')
        expected = dict(max_new_tokens=15, do_sample=True, top_p=1., top_k=50,
                        temperature=.9, output_hidden_states=True, return_dict_in_generate=True)
        if (self.disabled_reason or args or set(kwargs) != set(expected) | {'inputs_embeds'}
                or any(kwargs.get(key) != value for key, value in expected.items())
                or not isinstance(inputs, t.Tensor) or inputs.shape != (1, 2, 2048)
                or inputs.device.type != 'cuda' or inputs.dtype != t.bfloat16
                or self.predictor.training or not t.is_inference_mode_enabled()):
            return self.original(*args, **kwargs)
        if self.graph is None:
            # Preparing a graph must not consume the utterance's sampling RNG.
            state = t.cuda.get_rng_state(inputs.device)
            try:
                self._capture(inputs)
            except Exception as error:
                self.disabled_reason = str(error)
                print('読み上げのGPU最適化を使わず元の処理へ戻します: ' + str(error), file=sys.stderr, flush=True)
            finally:
                t.cuda.set_rng_state(state, inputs.device)
            if self.graph is None:
                return self.original(*args, **kwargs)
        self.static.copy_(inputs)
        self.graph.replay()
        self.replays += 1
        return SimpleNamespace(sequences=self.output.clone())


def enable_predictor_graph(generator):
    if os.environ.get('SPEECH_DISABLE_CUDA_GRAPH') == '1':
        return None
    from speech_stream_backend import verify_stream_backend
    verify_stream_backend()
    predictor = generator.model.model.talker.code_predictor
    if (predictor.training or predictor.config.num_hidden_layers != 5
            or predictor.config.num_code_groups != 16
            or predictor.config.layer_types != ['full_attention'] * 5):
        return None
    adapter = PredictorGraph(generator.torch, predictor)
    predictor.generate = adapter
    return adapter
