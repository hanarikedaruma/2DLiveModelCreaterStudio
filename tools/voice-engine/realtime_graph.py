# SPDX-License-Identifier: GPL-3.0-or-later
"""Replay Tiny's unchanged DiT arithmetic with fewer CPU/GPU dispatches.

SeedModel supplies unpadded, fixed-length windows: x_lens is exactly the audio
condition length (also for its two-row CFG batch). This permits constructing the
same sequence mask from the known shape, without a device-to-host scalar read
inside CUDA capture. The original module function is restored after capture.
Only the estimator is captured; RNG, content extraction and vocoder remain as is.
"""
from __future__ import annotations

import os
import sys


class EstimatorGraph:
    def __init__(self, torch, estimator, *, verify_replays=False):
        self.torch = torch
        self.estimator = estimator
        self.original = estimator.forward
        self.entry = None
        self.disabled_reason = ""
        self.verify_replays = verify_replays
        self.verified_calls = 0

    @property
    def active(self):
        return self.entry is not None and not self.disabled_reason

    def signature(self, args):
        return tuple((tuple(value.shape), value.dtype, value.device) for value in args)

    def capture(self, args):
        import modules.diffusion_transformer as module
        t = self.torch
        tokens = int(self.estimator.style_as_token) + int(self.estimator.time_as_token)
        bound = args[0].shape[-1] + tokens
        if int((args[2] + tokens).max().item()) != bound:
            raise ValueError("固定長でない入力にはGPU実行の最適化を適用しません")
        reference = self.original(*args).clone()
        static = tuple(value.clone() for value in args)
        original_mask = module.sequence_mask

        def fixed_mask(length, max_length=None):
            return original_mask(length, bound if max_length is None else max_length)

        module.sequence_mask = fixed_mask
        try:
            stream = t.cuda.Stream()
            stream.wait_stream(t.cuda.current_stream())
            # Captured casts must own their storage beyond this autocast scope.
            # The ordinary autocast weight cache is not safe across replays.
            with t.cuda.stream(stream), t.autocast("cuda", dtype=t.float16, cache_enabled=False):
                for _ in range(3):
                    self.original(*static)
            t.cuda.current_stream().wait_stream(stream)
            graph = t.cuda.CUDAGraph()
            with t.cuda.graph(graph), t.autocast("cuda", dtype=t.float16, cache_enabled=False):
                output = self.original(*static)
        finally:
            module.sequence_mask = original_mask
        graph.replay()
        t.cuda.synchronize()
        if not t.equal(reference, output):
            raise ValueError("GPU実行の最適化前後でAI出力が一致しません")
        return self.signature(args), static, graph, output

    def __call__(self, *args, **kwargs):
        t = self.torch
        if (self.disabled_reason or kwargs or len(args) != 6 or self.estimator.training
                or not t.is_inference_mode_enabled() or not t.is_autocast_enabled()
                or t.get_autocast_dtype("cuda") != t.float16
                or any(not isinstance(value, t.Tensor) for value in args)):
            return self.original(*args, **kwargs)
        if self.entry is None:
            try:
                self.entry = self.capture(args)
            except Exception as error:
                self.disabled_reason = str(error)
                print("Tiny GPU実行の最適化を使わず元の処理へ戻します: " + str(error), file=sys.stderr, flush=True)
                return self.original(*args)
        signature, static, graph, output = self.entry
        if self.signature(args) != signature:
            # Do not create an unbounded graph/memory cache for unexpected shapes.
            return self.original(*args)
        for target, source in zip(static, args):
            target.copy_(source)
        graph.replay()
        # The next diffusion step must not overwrite a previous result's storage.
        result = output.clone()
        if self.verify_replays:
            reference = self.original(*args)
            t.cuda.synchronize()
            if not t.equal(reference, result):
                raise ValueError("GPU再実行と元のAI計算が一致しません")
            self.verified_calls += 1
        return result


def enable_realtime_graph(model, *, verify_replays=False):
    """Install only on the pinned, evaluation-mode Tiny estimator in a worker."""
    if model.profile.get("backend") != "seed-xlsr-tiny" or os.environ.get("VOICE_DISABLE_CUDA_GRAPH") == "1":
        return None
    torch = getattr(model, "torch", None)
    cfm = getattr(getattr(model, "model", None), "cfm", None)
    estimator = getattr(cfm, "estimator", None)
    if (torch is None or estimator is None or estimator.training
            or type(estimator).__module__ != "modules.diffusion_transformer"
            or not hasattr(torch.cuda, "CUDAGraph")):
        return None
    adapter = EstimatorGraph(torch, estimator, verify_replays=verify_replays)
    estimator.forward = adapter
    return adapter
