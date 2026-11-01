# AT-01 顔・Pose・手の同時推定の試作

製品から独立した試作。製品のビルド・`packages/`・`apps/` には登録しない。顔は製品と同じ `createMediaPipeFaceLandmarker` をメインスレッドで呼び、Pose と手（GestureRecognizer）は1つのモジュール Worker で順に推定する。

- [報告](../../../docs/arm-tracking/reports/AT-01-inference.md) / [カード](../../../docs/arm-tracking/cards/01-inference-spike.md)
- 証跡: `docs/arm-tracking/evidence/AT-01/`（計測 JSON・画面・点列）

## 構成

| ファイル                           | 役割                                                                                                         |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `host/`                            | 試作専用の WebView2 の窓（wry 0.57・tao 0.37。アプリと同じ版）。CSP は製品と同じ値を HTML の応答だけに付ける |
| `src/main.ts`                      | カメラ・顔の推定・Worker への受け渡し・合成の描画負荷・計測・案内つき収録                                    |
| `src/worker.ts`                    | Pose と手の推定、待ちは最新の1枚、外部への fetch の見張り、CSP の確認                                        |
| `src/metrics.ts`                   | 計測の集計（時刻の単位・fps の分母はファイル先頭に記載）                                                     |
| `src/record.ts`・`scenarios.ts`    | 点列の形式と案内つき収録の手順（案内の文が正解）                                                             |
| `src/analyze.ts`・`analyze-cli.ts` | 点列と正解の照合、回帰用の短い点列の書き出し                                                                 |
| `run.mjs`                          | main.lock を取り、窓を開き、CDP で計測を流す                                                                 |

## 準備（一度だけ）

モデルは公式配布元から取得し、リポジトリには入れない（`.cache/` は git 管理外）。2026-10-31 にユーザーの了承を得て取得した。版と SHA-256 は報告に記載。

```powershell
New-Item -ItemType Directory -Force .cache/arm-tracking/models
foreach ($u in 'pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task','pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task','gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task') { curl.exe -sSf -o ".cache/arm-tracking/models/$(Split-Path $u -Leaf)" "https://storage.googleapis.com/mediapipe-models/$u" }
cargo build --release --offline --manifest-path prototypes/arm-tracking/inference/host/Cargo.toml --target-dir .cache/arm-tracking/host-target
```

## 実行

リポジトリのルートから。`run.mjs` は `.cache/locks/main.lock` を排他的に取り、使用中なら何もせず終わる。自分が開いた窓だけを閉じ、自分のロックだけを解放する。

```powershell
node prototypes/arm-tracking/inference/run.mjs --label fake --fake --suite smoke   # 仮のカメラ（人物なし）で動作と異常系
node prototypes/arm-tracking/inference/run.mjs --label fake --fake --suite perf    # 同条件の比較（12 条件）
node prototypes/arm-tracking/inference/run.mjs --label camera --suite perf --camera-label eMeet     # 実カメラ（演者がカメラの前にいる）
node prototypes/arm-tracking/inference/run.mjs --label camera --suite workers --camera-label eMeet  # 1・2 Worker、手だけ CPU などの比較
node prototypes/arm-tracking/inference/run.mjs --label camera --suite repeat --camera-label eMeet   # 1 Worker と 2 Worker を交互に3回
node prototypes/arm-tracking/inference/run.mjs --label camera --suite guided --camera-label eMeet   # 案内つき収録（約3分）
node prototypes/arm-tracking/inference/run.mjs --label fake --fake --suite cycles  # 開始・停止の10回とメモリ
node prototypes/arm-tracking/inference/run.mjs --suite csp --csp all --fake        # CSP を全応答に付けた比較
node prototypes/arm-tracking/inference/run.mjs --label fake-2workers --fake --suite smoke --workers 2  # 全条件を 2 Worker で
node prototypes/arm-tracking/inference/run.mjs --label fake-netlog --fake --suite network --net-guard off --netcheck-only  # 外へ出ない設定の確認（.invalid だけ）
node prototypes/arm-tracking/inference/run.mjs --label fake-netlog --fake --suite network                    # NetLog（見張りあり）。--net-guard off・--csp all で比較
node fixtures/node_modules/tsx/dist/cli.mjs prototypes/arm-tracking/inference/src/analyze-cli.ts <収録.json> <出力先>
```

`--fake` は WebView2 の仮のカメラ（`--use-fake-device-for-media-stream`）で、人物が写らない。推定の経路・異常系・受け渡しの確認用で、実カメラの性能・認識の結果として扱わない。`--camera-label` はカメラの名前の一部、`--workers 2` は Pose と手を別々の Worker で並行に動かす、`--screens` は仮のカメラのときだけ画面を保存する（1枚約1.2MB）。結果の `timeline` に集計窓の前後1秒の生の時刻が入る。

COの独立試験（COが作成）: `node node_modules/vitest/vitest.mjs run --config prototypes/arm-tracking/inference/vitest.at01.config.mjs`

確認の補助（実装者 CL）:

```powershell
node node_modules/typescript/bin/tsc -p prototypes/arm-tracking/inference/tsconfig.json
node node_modules/typescript/bin/tsc -p prototypes/arm-tracking/inference/tsconfig.worker.json
node node_modules/vitest/vitest.mjs run prototypes/arm-tracking/inference/src
node node_modules/eslint/bin/eslint.js prototypes/arm-tracking/inference
node node_modules/prettier/bin/prettier.cjs --check prototypes/arm-tracking/inference
```

## 保存するもの・しないもの

- カメラの映像・画像は保存しない。推定器と画面のプレビューにだけ使う。`run.mjs` の画面の保存（PNG）は仮のカメラで `--screens` を付けたときだけ。実カメラの実行では保存しない。
- 保存するのは計測値（JSON）と点列（Pose 33 点・手 21 点・SDK の左右と手形の候補）。案内つき収録の全体は `.cache/arm-tracking/recordings/` に置き、リポジトリには区間ごとに2秒の点列だけを入れる。
- 外部への通信: Worker の fetch・XHR を見張り、ページの外への送信は止めて記録する。ページは製品と同じ CSP で止まる。
