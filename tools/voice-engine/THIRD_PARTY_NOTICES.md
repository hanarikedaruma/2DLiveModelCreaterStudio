# AI音声エンジンの依存と素材

- 移行元: liverVoiceChanger 0.8.0。取り込み時のhashは `upstream.json`、原版の依存記録は `upstream-notices.md`。直接波形加工・Beatrice・VST3は統合版に含めない。
- チャット読み上げ: liverVoiceChanger 0.9.0の `speech.py`・`speech_config.py`・`speech_worker.py`（GPL-3.0-or-later）。元のhashは `upstream.json` の `speech`。StudioのIPCと口の連動、同じスレッドによるaudio mutexの解放、減衰型の出力保護を追加した。変更後のソースも同梱する。
- 読み上げモデルは上記Qwen3-TTS VoiceDesignの固定版（Apache-2.0表記）を別途導入し、モデル自体は同梱しない。Python依存は独立環境へ `requirements-voice-design.txt` の固定版で導入する。配布元のライセンス文書を保持する。
- Seed-VC source: `Plachtaa/seed-vc` revision `51383efd921027683c89e5348211d93ff12ac2a8`、GPL-3.0。変更した音声コードもソースとして含む。ライセンスは `licenses/GPL-3.0.txt`。
- Tiny: `Plachta/Seed-VC` revision `257283f9f41585055e8f858fba4fd044e5caed6e`、GPL-3.0表記。別途取得。
- XLSR: `facebook/wav2vec2-xls-r-300m` revision `1a640f32ac3e39899438a2931f9924c02f080a54`、Apache-2.0表記。別途取得。
- HiFT: `FunAudioLLM/CosyVoice-300M` revision `24c40509c3c5ea6fe06b5f8790ff99e3714a6bee`、Apache-2.0表記。別途取得。
- 大型Seed・Whisper・BigVGAN・話者モデルは `fetch_models.py` の固定revision・公式hashを使用。各条件は取得先の `external/quality-models/assets.json` に記録する。
- RNNoise: `xiph/rnnoise` revision `70f1d256acd4b34a572f999a05c87bf00b67730d`、BSD形式。全著作権表示と条件は `licenses/RNNoise.txt`。DLLはAVX2構成で、hashは `assets.json`。ビルド対象は `noise-target.cmake`。公式モデルアーカイブSHA256: `0a8755f8e2d834eff6a54714ecc7d75f9932e845df35f8b59bc52a7cfe6e8b37`。
- Silero VAD: `snakers4/silero-vad` revision `1e261b036686cd0017d500ee96acd1c4ba572a9d`、MIT。ライセンスは `licenses/Silero.txt`、ONNX hashは `assets.json`。
- Python依存は `requirements-lock.txt` で固定。PyTorch、NumPy、SciPy、SoundDevice、ONNX Runtime等は導入先環境へインストールし、各配布に含まれるライセンスを保持する。
- `voices/original-soft-girl.wav` は移行元でQwen3-TTS VoiceDesignから生成した架空の日本語女性声。特定人物や利用者の録音ではない。生成元の公式モデル `Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign` revision `5ecdb67327fd37bb2e042aab12ff7391903235d3` はApache-2.0表記。VoiceDesignのモデル・環境自体は同梱しない。
- 話者を固定する読み上げは公式`Qwen/Qwen3-TTS-12Hz-1.7B-Base` revision `fd4b254389122332181a7c3db7f27e918eec64e3`（Apache-2.0表記）を別途取得する。モデル本体をアプリへ同梱しない。参照声を再生成せず、既存の参照WAVから話者条件を作る。
- 検証に使う公開JVS音声は配布に含めない。用途はコーパス条件に従う。利用者が取り込む参照WAVにはその素材の条件が適用される。

公開配布時はアプリ全体の配布条件と対応ソースの提供方法を別途確認する。このファイルは上流のライセンス文書を置き換えない。
