# カード86 顔が外れたときの振る舞い

| 段              | 担当 | 依存 | 契約 | 実機 | テスト |
| --------------- | ---- | ---- | ---- | ---- | ------ |
| 3（部品・並行） | CL   | 79   | —    | —    | CO     |

候補: #6。完成条件: M3。

## 目的

顔が外れたときに「正面へ戻す」か「その場で止める」かを選べるようにする。

## 前提

- 「止める」（hold）は `packages/tracking/src/mapping/lostWeight.ts` にあるが、アプリからは選べない（`apps/desktop/src/services/trackingLayer.ts` が returnToFront に決めている）。
- カード79 の Environment の `lostBehavior`。
- トラッキングの設定の画面: `apps/desktop/src/modes/studio/calibration/CalibrationSection.tsx`（STEP3 で自動まばたきのオン・オフを足してある）。

## 作るもの・直すもの

1. 設定の画面に「顔が外れたとき」（正面へ戻す・その場で止める）を足し、Environment に保存する。
2. トラッキングの層へ渡し、稼働中に変えても反映する。
3. 「止める」の間も、自動まばたき（STEP3 のカード66）は続く。

## 触ってよいもの

- `packages/tracking/src/mapping/`、`apps/desktop/src/services/trackingLayer.ts`、`apps/desktop/src/services.ts`
- `apps/desktop/src/modes/studio/calibration/`

## 触らないもの

- 自動の層の動き（カード87）。

## テスト（担当: CO）

ファイルの名前に `.c86.` を入れる。

- `packages/tracking/src/mapping/lost.c86.test.ts`: 「止める」で最後の値を保ち、「正面へ戻す」で今までどおり戻る。稼働中に変えても反映する。
- `apps/desktop/src/modes/studio/calibration/lost.c86.test.tsx`: 設定の保存・復元。
- 最後の値のテスト: 「止める」の間も自動まばたきが続く。
- CH・UC-CH: UC-12 の「外れたとき」の続き。

## 完了条件

- [ ] 「止める」で最後の値を保ち、「正面へ戻す」は今までどおり
- [ ] 設定が保存・復元され、稼働中に変えても反映する
- [ ] 「止める」の間も自動まばたきが続く
- [ ] CO のテストが通り、テスト確認がある

## 記録

（作業中に書く）
