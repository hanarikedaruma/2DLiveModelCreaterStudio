# Third-party dependencies

VoiceChanger 0.7.0 adds the official Seed Tiny checkpoint at `Plachta/Seed-VC` revision `257283f9f41585055e8f858fba4fd044e5caed6e` (GPL-3.0), XLSR at `facebook/wav2vec2-xls-r-300m` revision `1a640f32ac3e39899438a2931f9924c02f080a54` (Apache-2.0 model card), and HiFT at `FunAudioLLM/CosyVoice-300M` revision `24c40509c3c5ea6fe06b5f8790ff99e3714a6bee` (Apache-2.0 model card). These weights are downloaded separately by fetch_realtime_models.py; official LFS SHA256 values are verified. Per-file revisions, hashes and licenses are recorded in external/realtime-models/assets.json. The code remains GPL-3.0-or-later; no user recordings are included in the ZIP.

The application binaries statically use these dependencies. Their unmodified license texts are included in the distribution's `licenses/` directory.

| Dependency                      | Revision                                 | License | Source                                                   |
| ------------------------------- | ---------------------------------------- | ------- | -------------------------------------------------------- |
| Signalsmith Stretch 1.3.2       | a670068d9aeb64913331d5cc29337b19a457a7df | MIT     | https://github.com/Signalsmith-Audio/signalsmith-stretch |
| Signalsmith Linear              | 146b26f91b48835d665fa0498d64d9617818d27a | MIT     | https://github.com/Signalsmith-Audio/linear              |
| nlohmann/json 3.12.0            | 65ee68451d8eb2b5f3a30b410476ab83deb3289b | MIT     | https://github.com/nlohmann/json                         |
| VST3 pluginterfaces             | 4f547e8e102b47de4a8b8aaf343c73b700786372 | MIT     | https://github.com/steinbergmedia/vst3_pluginterfaces    |
| VST3 public SDK hosting helpers | 586dc5e6c8012c3e4b01c79389375cbe96bdb1da | MIT     | https://github.com/steinbergmedia/vst3_public_sdk        |
| toml11                          | v4.4.0                                   | MIT     | https://github.com/ToruNiina/toml11                      |

The downloaded archives also contain upstream development files. Only the libraries needed by the application are linked into the distributed binaries. Dependencies are fetched by `scripts/fetch-dependencies.ps1` and local builds do not download additional packages.

Beatrice 2.0.0-rc.3 is a separately installed official VST3 plug-in. The application uses its standard VST3 interfaces; it does not link or call the nonpublic inference library directly. Neither the plug-in nor its models are redistributed in the application ZIP. Their original licenses and model terms apply to the locally downloaded installation. Official model 1 requires the user's explicit agreement: https://prj-beatrice.com/2.0.0-rc.0-official-model-1-terms . Blended outputs retain the conditions of all contributing voices.

Development speech validation uses one public JVS Japanese speech sample for personal / non-commercial testing under the corpus terms. It is not included in the ZIP: https://sites.google.com/site/shinnosuketakamichi/research-topics/jvs_corpus .

VoiceChanger 0.6.0 includes RNNoise at revision `70f1d256acd4b34a572f999a05c87bf00b67730d` under its BSD-style COPYING text, including Amazon/Xiph/Valin/Mozilla notices. The official model archive SHA256 is `0a8755f8e2d834eff6a54714ecc7d75f9932e845df35f8b59bc52a7cfe6e8b37`. Its full embedded model C source, build target and headers accompany voice-noise.dll in source/rnnoise. Source: https://github.com/xiph/rnnoise . The Windows build targets AVX2.

Silero VAD revision `1e261b036686cd0017d500ee96acd1c4ba572a9d` and its silero_vad.onnx model are MIT licensed. The unchanged MIT text is included; model SHA256 is `1a153a22f4509e292a94e67d6f9b85e8deb25b4988682b7e174c65279d8788e3`. Source: https://github.com/snakers4/silero-vad . ONNX Runtime 1.20.1 is installed separately under its MIT license: https://github.com/microsoft/onnxruntime .

The optional Qwen3-TTS VoiceDesign checkpoint (`5ecdb67327fd37bb2e042aab12ff7391903235d3`) is downloaded separately and labeled Apache-2.0 by its official model repository: https://huggingface.co/Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign . It prepares fictional reference WAVs and does not receive microphone speech during live conversion.
