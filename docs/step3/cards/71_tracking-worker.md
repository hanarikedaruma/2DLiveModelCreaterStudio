# カード71 顔の推定を Worker へ（条件付き）

| 段              | 担当 | 依存          | 契約 | 実機                  | テスト |
| --------------- | ---- | ------------- | ---- | --------------------- | ------ |
| 1（部品・並行） | CO   | 70 の判断・57 | —    | ○（OBS と同時の計測） | CO     |

課題: I-005。カード70 で「行う」と決めたときだけ行う。行わないなら状態を「見送り」にする。

## 目的

顔の推定（MediaPipe）と描画が重なったフレームが遅くなり、OBS の録画でフレーム落ちが見える場合に、推定を Worker に移して直す。

## 前提

- 推定: `packages/tracking/src/source/landmarker.ts`（detectForVideo を runningMode 'VIDEO' でメインスレッドで呼ぶ）。
- 前の計測（この PC、OBS の録画と同時）: 描画の平均 154fps、1%最低 45fps 前後（docs/acceptance-mvp.md）。カード70 で新しい値を取る。
- 外へ通信しない（MediaPipe の利用の記録は CSP で止めている）。
- 既存のテスト: `packages/tracking/src/source/*.test.ts`、e2e の `tracking.e2e.ts`（外への通信が 0）、UC-12・UC-15。

## 作るもの・直すもの

1. 映像のフレームを Worker へ渡し（ImageBitmap か VideoFrame）、推定を Worker で行う。結果の形（TrackingFrame）は変えない。
2. Worker が使えない環境では今の方式に戻る。
3. MediaPipe のファイルはアプリに同梱のものを使い、Worker からも外へ通信しない。

## 触ってよいもの

- `packages/tracking/src/source/`
- `apps/desktop/vite.config.ts`（Worker の設定。カード57 の設定に足す）

## 触らないもの

- `packages/tracking/src/mapping/`（カード66）。

## テスト（担当: CO）

このカードのテストは、実装の担当（CL）ではなく CO が書く（README の「テストの分担」）。テストのファイルは名前にカードの番号（`.c71.`）を入れ、実装の担当は書き換えない。

- `packages/tracking/src/source/landmarker.c71.test.ts`: Worker の経路と今の経路で、同じ入力の画像から同じ TrackingFrame が出る。Worker が使えないときに今の方式へ戻る。
- e2e の外への通信の確認（`tracking.e2e.ts`）が通る。計測の前後（OBS と同時の 1%最低・遅延 p95）を照合する。

## 完了条件

- [ ] OBS の録画と同時の計測で、1%最低のフレームが改善する（前後の数値）
- [ ] 遅延（p95）が 100ms 以下のまま、トラッキングの fps が下がらない
- [ ] `tracking.e2e.ts` の外への通信の確認が通る
- [ ] Worker が使えないときに今の方式で動く（テスト）

## 締めるときに書くもの

- docs/issues.md の I-005 を対応済みに（数値を添えて）。

## 記録

- 2026-10-07 CO（引き継ぎ）: カード70のOBS同時の実測とI-005の判断を引き継ぐ。条件が成立した記録はまだ無いので、新しいWorkerの実装は開始しない。未着手（70の判断待ち）を維持し、見送りとも判定しない。
