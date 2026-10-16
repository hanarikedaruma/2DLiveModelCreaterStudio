# スタジオのAI音声エンジン

話者固定にはQwen3-TTS Base 1.7Bを使う。音声変換と同じ参照WAVの話者プロンプトを再利用し、同じ声質調整・フィルタ・ゲインを適用する。発話ごとのVoiceDesignは廃止。参照音声のhashを照合し、文脈・読み方の指示に声の再設計を混ぜない。

入力欄の左で感情を選択できる。`shy`だけは`speech_delivery.py`で短い言い直し・ためらいを最大2箇所に加え、その全文を同じ参照声で一度に合成する。位置は軽い日本語規則で決め、読みが曖昧な言い出しは音節を推測せず短いためらいを使う。追加モデル・依存・通信・音声の切り貼りは使わない。表示・履歴・文脈は原文のまま。感情も先行合成の一致条件で、逐次の長さ見積もりには演技を加えた文を使う。[実機比較と限界](../../docs/evidence/studio-speech-emotion-2026-10-16/README.md)。

入力はIME確定後150msで最新全文を先行合成し、送信までは無音。GPU生成は一つ、次の候補も一つだけ保持する。完全一致なら準備済み音声や進行中の生成を再利用する。編集・文脈・参照声・声質変更では古い結果を使わない。先行音声はRAMに最大120秒分、ワーカー通信は8イベント、再生リングは8秒に制限する。

音声合成は全文生成後と逐次再生を切り替えられる。逐次側は固定版Qwenの完全な16コードを取得して24kHzのPCMへ復号し、状態を保持する48kHz後処理と有限リングへ渡す。別入力ウィンドウはメイン側の同じ音声処理を操作する。[操作説明](../../docs/studio-speech-guide.md)、[設計と実装上の制約](../../docs/studio-speech-streaming-design.md)。生成速度が実時間に追いつかない場合は、`speech_buffering.py` が文章長と生成側の時刻から開始前の余裕を増やす。8秒を超える余裕は既存の120秒上限内のRAMで準備し、リングが埋まって開始できなくなる状態を避ける。後処理の最後のPCMと終了は同じイベントにし、全保留PCMを渡してからリングの終了フラグを立てる。予期しない不足では末尾5msを滑らかにし、再開時も戻す。読み上げ出力のデバイス余裕は40ms。[比較](../../docs/evidence/studio-speech-continuity-2026-10-16/README.md)。

波形への復号は `speech_decoder.py` で注意機構のKVと因果畳み込みの状態をチャンク間で連続保持する。短い25フレーム履歴で毎回復号をやり直す旧経路は、途中で声が極端に低くなることがあったため廃止した。参照全体を一度だけ準備し、各発話へ独立した状態を複製する。KVは各層71フレーム、畳み込みはカーネルに必要な分だけ保持し、中断・例外で元のメソッドへ戻す。声や音程の事後加工は加えない。[再現・比較・回帰試験](../../docs/evidence/studio-speech-register-2026-10-16/README.md)。

読み上げの残差コード予測15段を `speech_predictor_graph.py` でCUDA Graphへまとめる。固定版ソース・単一フレーム・既存のBF16・temperature .9/top-k 50に限り、全コードブックの出力logitsを元のDynamicCache経路とビット一致で照合する。準備時の乱数状態を保存・復元し、再実行ごとに新しくサンプリングする。入力形状や設定が異なる場合、照合やcaptureに失敗した場合は元の処理を使う。全文の条件付け・話者プロンプト・主モデル・波形復号は同じ処理を使う。`SPEECH_DISABLE_CUDA_GRAPH=1` で調査用に無効化できる。

`speech_memory.py` は文字のEmbedding表593.5MiBをCPUへ移し、要求された行だけ元の精度のままGPUへ返す。行の参照なので演算・量子化を追加しない。`SPEECH_DISABLE_TEXT_OFFLOAD=1` で調査用に無効化できる。実機の交互比較では生成PCMのFloat32 SHA256が一致した。[測定と検証](../../docs/evidence/studio-speech-latency-2026-10-16/README.md)。診断の`firstAudioMs`はホストで送信を受けてから最初の音声サンプルのDAC時刻まで、`firstAudioWallMs`は同じDAC時刻のUnixミリ秒。無音のpriming callbackは開始に数えず、Mute時も音声が存在する最初の枠を計測する。

`liverVoiceChanger` 0.8.0からSeed-VC Tiny / 大型Seed-VC、RNNoise / Silero VAD、声質調整、5種類のフィルタを取り込んだ。直接波形加工、VST3、別アプリのGUIは含まない。

チャット読み上げは0.9.0の `speech.py`・`speech_config.py`・`speech_worker.py` を移植し、`studio_speech.py` でStudioのIPC・WASAPI出力・口の連動へつないだ。元ファイルのhash・モデルの固定版は `upstream.json` の `speech` に記録する。通常の生成はオフライン。Qwenの別環境は `setup-speech.ps1` で同じモデル保存先へ導入できる。[操作説明](../../docs/studio-speech-guide.md)。

再生の最終PCMを有限キューへコピーし、DAC時刻とともに既存の口解析へ渡す。符号化・IPCはコールバック外で行う。停止時に自身の生成worker・一時ファイル・再生を破棄する。マイク変換とGPU/audio mutexを共有し、音声mutexの取得・解放は同じ専用スレッドで行う。読み上げ出力保護はStudio既存の減衰型 `PeakGuard` を使う。

取り込み元のファイルhashは `upstream.json`、同梱DLL・発話判定モデル・架空声の参照WAVは `assets.json` に記録する。推論モデルとPython環境は別途準備する。

## 準備

このPCでは、準備済みの `liverVoiceChanger/.venv-quality` とモデルを使うPC専用の `runtime.json` を生成した。元アプリのコード・声設定を変更しない。スタジオの［マイク・音声］でマイクと出力先を選ぶ。

別のPCでは、Python 3.12 x64、AVX2 CPU、CUDA対応NVIDIA GPU、Git、初回のネット接続を用意する。

```powershell
.\setup.ps1 -PythonExecutable 'C:\Python312\python.exe'
```

隔離Python環境・固定依存・固定revisionのAIソースとモデルを導入し、公式ファイルhashを検証する。［実行環境を設定］から準備済みのPythonと `external/seed-vc` を含むフォルダを指定することもできる。通常の変換はoffline。AI未準備でもモデル編集と既存のマイクの口開閉は使える。

## 通信と保存

- `host.py` は64KiB以内の改行JSON要求を受け、128KiB以内の応答を返す。ログはstderr側へ分ける。
- `live.py` が48kHz WASAPI入出力を所有し、推論を別workerへ送る。音声コールバックは最終PCMとDAC時刻を有限キューへコピーする。符号化・IPC・口解析はコールバックで行わない。
- WebViewは口の解析用PCMを受ける。配信用の音声はWASAPIへ直接送る。Mute、Bypass、立ち上がり、出力保護、時計ずれ補正の後の波形を使う。
- 独自参照WAVはhashで管理し、プロジェクト保存時に `voice/references/` へコピーする。停止では待ち行列と口の状態を破棄する。
- 元アプリと音声・GPUのmutexを共有し、同時実行を防ぐ。終了では自身のプロセスだけを止める。

## 上流からの変更

直接加工のbackend・composer・DLL依存を除去した。GUIなしホスト、参照WAV・声設定の移行と保存、WAV比較・中断、最終PCMの時刻通知を追加した。AIのSeedModelと個別フィルタは元と同じ処理を使う。Composerの出力保護・発話判定・RNNoiseの時間合わせには、後述する修正を加えた。パイプの短い書込みを最後まで送る変更は、通信の欠落を防ぐために保持する。

Tinyの品質は元の4ステップ/180ms、6/240ms、8/300ms。生成履歴は最速400ms、他500ms。開始時の余裕は40ms。大型AIは20/30ステップ。元と同じ4 CPUスレッドを使い、interopスレッドの追加制限や独自のGPU待機処理を加えない。取り込んだ個別設定は保持し、品質を選び直すと元のプリセットに戻る。基準値は `upstream.json` に記録する。

最初の統合版で加えた400/600/800ms・240msの余裕・GPU待機処理は、即応性を保つ移植の範囲を越えていたため撤回した。その設定での1.2秒・30分の記録は現行設定の性能根拠に使わない。CPUを1スレッドにしたという以前の説明も訂正する。元からある後続の4スレッド設定で上書きされていた。今回、追加していたスレッド設定を両方とも除去した。

## 再生音声の不足への対処

Tinyのライブ処理は `realtime_graph.py` で、元のDiTの計算をCUDA Graphとしてまとめて実行する。ステップ数・区間・履歴・参照声・精度・CPUスレッド数・再生余裕を変更しない。乱数生成、音響特徴の抽出、vocoder、Composerのつなぎ合わせは元の処理を使う。短長の交互区切りや、GPU待機中に繰り返す処理は追加しない。

固定長入力で元と同じマスクを作り、GPUから長さを読み戻す同期をcapture内から外す。混合精度のweight cacheはcapture時のみ無効にし、再実行後も生存する領域を使う。毎回すべての入力をコピーし、結果は独立した領域として返す。準備中に元のestimatorとビット一致を確認し、一致しない・非対応の場合は元の処理へ戻す。予期しない形状でも元の処理を使い、graphのメモリを無制限に増やさない。

適用は固定版のTiny・評価モード・FP16ライブに限る。大型AIとWAV変換は元の経路のまま。調査時は起動環境の `VOICE_DISABLE_CUDA_GRAPH=1` で無効にできる。workerのready通知と計測の `cudaGraph` で適用を確認できる。[比較と実機検証](../../docs/evidence/voice-underrun-2026-10-15/README.md)。

## 小さい声・発話再開時の音割れへの修正

Silero VADへ渡す判定用の音声だけを最大4倍まで補正し、弱くゆっくりした発話を拾いやすくした。RNNoise後の実音声とAI入力をこの処理で増幅しない。雑音除去の強さ、発話のしきい値、先読み、品質プリセットは変更しない。

Composerと最終出力の固定値への切り詰めを、ピークに応じて減衰し120msで戻す `PeakGuard` へ変更した。音量を増やす自動補正はなく、待ち時間を加えない。サンプル数とDAC時刻の契約は同じ。ゲインは区間をまたいで保持する。入力段で既に割れた音や、AI生成による音程変化の電子感を復元する処理ではない。

ライブ計測に調整後の入力ピーク・RMS・過大サンプル数と、出力のピーク抑制量を追加した。Studioの入力メーターは調整後の値を表示する。[検証と制約](../../docs/evidence/voice-clarity-2026-10-15/README.md)。

## 雑音除去後の混合位置の修正

舌足らずな発話・「ん」の音量増加の報告を受け、実DLLの遅延を測定した。同梱RNNoiseは`delayed_X`を合成する版で、解析/合成の重複と合わせて960サンプル（20ms）遅れる。元から引き継いだコードは480サンプルとして混合していた。起動時の2フレームを捨て、20ms前の元PCMと混ぜ、バッファのサンプル0を実際の入力0へ合わせた。

発話判定OFF・雑音除去ONだけの場合の最低先読みは20msへ直した。Tinyの既定128msの先読み、80msのAI先読み、区間長、再生開始条件は変更しない。発話判定も雑音除去もOFFなら遅延補償しない。実DLLを使った混合と遅延位置の回帰テストを追加した。[実測と制約](../../docs/evidence/voice-articulation-2026-10-15/README.md)。これは時間合わせの修正で、特定の音素を認識して音量調整する機能ではない。

## 検証

```powershell
<音声用python.exe> -m unittest discover -s tools/voice-engine/tests
<音声用python.exe> tools/voice-engine/validate_live.py --model-root <モデル保存先> --source <検証音源.wav> --seconds 1800 --report .cache/voice-evidence/live.json
<音声用python.exe> tools/voice-engine/validate_parity.py --model-root <元VoiceChangerフォルダ> --source <公開検証音源.wav> --seconds 6 --report .cache/voice-parity/comparison.json
<音声用python.exe> tools/voice-engine/validate_realtime_graph.py --model-root <元VoiceChangerフォルダ> --source <公開検証音源.wav> --seconds 3 --report .cache/voice-graph/replays.json
```

連続試験はマイクPCMを指定音源へ置き換え、実デバイス時計で処理し、出力を常にMuteにする。保存するのは統計のみ。単体試験はIPC・描画・OBSを測らないため、Tauriとの結合は `apps/desktop/e2e/voice.e2e.ts` と配信経路で確認する。IPCの単体テストは同じworker通信・composerにidentity推論を差し込み、GPU品質試験と分ける。

`validate_parity.py` は復元時の独立worker同士の厳密な波形比較用。今回の発話判定・出力保護は意図的な処理差なので、現行版ではComposer/音声処理の一致検査で停止する。検査を緩めて一致とは扱わない。AI生成の同一性は `validate_realtime_graph.py` とSeedModelのAST比較で別に確認する。Tinyは元worker同士の再起動でも波形が変わる。復元時の元同士の対照試験、同じモデル出力の経路比較、大型AIの独立比較は[当時の検証記録](../../docs/evidence/voice-parity-2026-10-15/README.md)に残す。

移行元の音声コードはGPL-3.0-or-later表記。変更したPythonソースとライセンスを同梱する。依存条件は `THIRD_PARTY_NOTICES.md` と `licenses/` に記載する。新しい目標声のVoiceDesign生成は計画の後続段階V6として残す。
