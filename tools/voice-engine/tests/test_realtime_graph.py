import sys
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import torch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from realtime_graph import EstimatorGraph, enable_realtime_graph


class RealtimeGraphTests(unittest.TestCase):
    def make_adapter(self):
        estimator = SimpleNamespace(training=False, forward=lambda *args, **kwargs: sum(args) + kwargs.get("offset", 0))
        return EstimatorGraph(torch, estimator)

    def test_large_backend_keeps_original_execution(self):
        model = SimpleNamespace(profile={"backend": "seed-whisper-large"})
        self.assertIsNone(enable_realtime_graph(model))

    def test_capture_failure_returns_original_and_does_not_retry(self):
        adapter = self.make_adapter()
        inputs = tuple(torch.tensor([float(index)]) for index in range(6))
        with patch.object(torch, "is_inference_mode_enabled", return_value=True), \
             patch.object(torch, "is_autocast_enabled", return_value=True), \
             patch.object(torch, "get_autocast_dtype", return_value=torch.float16), \
             patch.object(adapter, "capture", side_effect=RuntimeError("unsupported capture")) as capture:
            torch.testing.assert_close(adapter(*inputs), torch.tensor([15.]))
            torch.testing.assert_close(adapter(*inputs), torch.tensor([15.]))
            capture.assert_called_once()
        self.assertFalse(adapter.active)
        self.assertEqual(adapter.disabled_reason, "unsupported capture")

    def test_new_shapes_keep_original_without_growing_graph_cache(self):
        adapter = self.make_adapter()
        captured = tuple(torch.ones(2) for _ in range(6))
        entry = (adapter.signature(captured), None, None, None)
        adapter.entry = entry
        changed = tuple(torch.ones(3) for _ in range(6))
        with patch.object(torch, "is_inference_mode_enabled", return_value=True), \
             patch.object(torch, "is_autocast_enabled", return_value=True), \
             patch.object(torch, "get_autocast_dtype", return_value=torch.float16):
            torch.testing.assert_close(adapter(*changed), torch.full((3,), 6.))
        self.assertIs(adapter.entry, entry)

    def test_unexpected_keyword_arguments_use_original(self):
        adapter = self.make_adapter()
        inputs = tuple(torch.tensor([1.]) for _ in range(6))
        torch.testing.assert_close(adapter(*inputs, offset=3), torch.tensor([9.]))
        self.assertIsNone(adapter.entry)


if __name__ == "__main__":
    unittest.main()
