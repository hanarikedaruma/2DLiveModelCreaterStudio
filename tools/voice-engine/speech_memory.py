# SPDX-License-Identifier: GPL-3.0-or-later
"""Keep the one-time text lookup table out of scarce GPU memory.

Embedding is a row lookup, with no arithmetic or precision conversion. Move only
the requested rows to the caller's device; the talker and decoder remain CUDA.
"""
import os


def offload_text_embedding(generator):
    if os.environ.get('SPEECH_DISABLE_TEXT_OFFLOAD') == '1':
        return 0
    embedding = generator.model.model.talker.get_text_embeddings()
    if embedding.weight.device.type != 'cuda':
        return 0
    original = embedding.forward
    size = embedding.weight.numel() * embedding.weight.element_size()
    embedding.to('cpu')

    def lookup(ids):
        return original(ids.to('cpu')).to(ids.device)

    embedding.forward = lookup
    generator.torch.cuda.empty_cache()
    return size / 1048576
