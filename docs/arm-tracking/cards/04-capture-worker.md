# AT-04 共有カメラ・推定Worker・モデル同梱

[計画・共通ルール](../README.md) / [元の設計](../../arm-tracking-design.md)

| 項目                 | 内容                     |
| -------------------- | ------------------------ |
| 段階                 | 3：部品                  |
| 実装担当（推奨）     | CL                       |
| 独立テスト・確認担当 | CO                       |
| 依存                 | [AT-03](03-contracts.md) |
| 状態                 | 完了（CO独立確認済み）   |
| 担当者・開始日       | CL・2026-11-01           |

## 目的

顔を継続しながら、同じカメラからPoseと最大2手の観測を安定して配信する。

## 着手条件・入力

- AT-01で採用したSDK・モデル・Worker実行方式、AT-03のBodyTrackingFrameと機能制御契約。
- 同梱するモデル：pose_landmarker_lite.task と gesture_recognizer.task（いずれもfloat16/1、SHA-256はAT-01の報告）。gesture_recognizer.task の手形の分類はモデルカードに利用条件の記載がないが、2026-10-31 ユーザーが「同梱する」と決定。Workerの外部通信の対策（見張りとWorkerのスクリプトへのCSP）はAT-01の報告のとおり必須。

依存カードは共通ルールに従って確認済みの版を使う。推奨担当の変更は一覧とこのカードへ記録し、実装と独立確認を混同しない。

## 実装すること

1. source/body/（新規）へPose・GestureRecognizerのアダプタ、Workerとスケジューラを実装し、既存sourceに共有カメラで接続する。左右の対応付けとモデル制御はここで行わない。
2. 処理中1枚＋最新待ち1枚に制限し、置換／完了／停止時に画像を解放する。観測時刻を保持し、単調時刻、世代違い、遅延結果を検査する。
3. 顔通知と身体通知を独立させる。腕OFF・カメラ切替・初期化失敗・再開時の終了と解放を実装する。顔だけは使い続けられるようにする。
4. GPU Worker失敗時のCPU Worker、利用不可の状態を実装する。未検証のメインスレッドfallbackは追加しない。
5. 同梱モデル／WASM、CSP、完了fpsと結果の古さの診断、手15fpsの軽量設定を接続する。解像度自動選択は手の可視サイズも考慮し、未測定で低解像度を優先しない。

## 変更対象

- packages/tracking/src/source/**、packages/tracking/assets/ の追加モデル・来歴
- apps/desktop/vite.config.ts の同梱／Worker設定
- 依存変更がAT-01で必要と判定された場合だけ packages/tracking/package.json と pnpm-lock.yaml（他担当と直列）

新しい公開APIのexport行だけは[共有ファイルの規則](../README.md#共有ファイルと変更の所有)に従い直列で追加できる。上記外の変更が必要なら、担当カードと依存・所有を更新してから行う。

## このカードでは行わないこと

- packages/tracking/src/body/ の左右対応、hands/ の形判定、core、studio/runtime、schema/contracts。

## テスト・確認（CO）

- *.at04.test.ts：二重カメラなし、待ちキュー上限、破棄時close、世代の切替、古い結果の不採用、顔と腕の独立を仮推定器で確認する。
- 実WebView2で同梱モデルのロードとCPU/GPUの実経路を確認し、外部通信を検査する。全体のOBS性能判定はAT-14。

実装者の補助テストと、上記担当による独立確認は分けて記録する。main.lockが必要な操作は共通ルールに従う。

## 完了条件

- [x] BodyTrackingFrameを契約どおり通知し、停止・再開の繰返しでWorkerや画像が増えない。（補助試験と実WebView2の繰返し）
- [x] 腕OFFで追加推定が止まり、顔が続く。失敗理由が状態から読める。
- [x] COの試験と同梱／Workerの実機結果が記録されている。
- [x] 変更範囲の型・整形・lint・必要なテストが通り、相手の確認と検証対象の版が記録されている。
- [x] 下記の引継ぎが揃い、計画一覧と本カードの状態が一致している。

## 引継ぐ成果物

- 身体観測を配信するTrackingSource、同梱アセット一覧、診断値、実機経路の証跡。

## 作業記録

- 実装者／期間：CL・2026-11-01。
- 使用した依存カードの版：AT-03「CO v1」（[manifest](../evidence/AT-03/manifest.json)）の観測の契約。AT-03のCL指摘1件（Environmentの腕の校正の保存）はAT-04の範囲外。AT-01の採用方式（1 Worker・Pose先行・同梱モデル）。
- 変更ファイル・コミット：`packages/tracking/src/source/body/**`（新規）、`source/source.ts`・`camera.ts`・`capture.ts`、`packages/tracking/assets/` の2モデルと `MODELS.md`、確認ページ `prototypes/arm-tracking/at04-check/`。未コミット。対象の版は[AT-04 manifest](../evidence/AT-04/manifest.json)。vite.config.ts・依存は変更なし。
- 実行した試験・コマンド・結果：補助試験28件（tracking全体182件）、tracking・desktopの型、lint・整形が成功。desktopの本番ビルドで同梱を確認。実WebView2（仮のカメラ）で通常30/30/30・軽量30/30/15（顔/Pose/手、件/秒）、腕OFFでWorker0・顔継続、ON/OFF・カメラの止め直し各5回でWorker・メモリが増えない、外部通信の試み22件を止めNetLogにMediaPipeの送信なし。
- 証跡・報告：[報告](../reports/AT-04-capture-worker.md)、[実WebView2の記録](../evidence/AT-04/fake-2026-10-31T17-09-05-361Z/run.json)。NetLogの本体は `.cache/arm-tracking/netlogs/`。
- 未確認・制約・戻したカード：実カメラ・OBS同時の性能はAT-14、製品の窓での実行はAT-12。WebView2ランタイム自身の通信（edge.microsoft.com・config.edge.skype.com）は[I-092](../../issues.md)。
- 独立確認（担当・日付・対象の版）：CO・2026-11-01・「AT-04 CL v1」。SHA-256一致。合格。COの[独立確認報告](../reports/AT-04-co-review.md)と[確認manifest](../evidence/co-review-2026-11-01.json)を参照。実サービスの統合はAT-12、実カメラ・OBSの性能と自然さはAT-14/16へ引き継ぐ。
