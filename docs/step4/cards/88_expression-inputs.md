# カード88 表情の入力の拡張と舌

| 段              | 担当 | 依存   | 契約 | 実機          | テスト |
| --------------- | ---- | ------ | ---- | ------------- | ------ |
| 3（部品・並行） | CL   | 79・75 | —    | ○（カード97） | CO     |

候補: #7・#11。完成条件: M5・M6。範囲はカード75 の結果で決める。下は今の見込み。

## 目的

MediaPipe が出しているのに今は捨てているブレンドシェイプのうち、カード75 で使えると決めたものを、トラッキングの入力として使えるようにする。舌の値が動くと分かったら、舌も入力にする。

## 前提

- 変換: `packages/tracking/src/source/convert.ts`（10項目に減らし、口と眉は左右の平均）。
- 既定の割り当て: `packages/tracking/src/mapping/defaults.ts`（眉は BrowYL・BrowYR に同じ値）。キャリブレーション・ミラー: `mapping/calibrate.ts`・`mirror.ts`。
- 割り当ての画面: `apps/desktop/src/modes/studio/trackingMap/`（I-042）、キャリブレーションの画面: `apps/desktop/src/modes/studio/calibration/`。
- カード79 の TrackingFrame・TrackingInput の新しい項目。

## 作るもの・直すもの（見込み）

1. 変換で、選んだ項目を TrackingFrame に入れる（左右別の眉・口角など）。
2. 標準の割り当てに入れると決めたものを既定に足す（眉は左右別）。前の版のプロジェクトのカスタムの割り当ては変えない。
3. 割り当ての画面で、新しい入力を選べる。
4. キャリブレーション・ミラー（左右の入れ替え）を新しい項目にも掛ける。
5. 舌（カード75 で動くと分かったときだけ）: 舌の入力と、カード79 で決めたパラメータへの既定の割り当て。

## 触ってよいもの

- `packages/tracking/src/source/`、`packages/tracking/src/mapping/`（カード86 の後）
- `apps/desktop/src/modes/studio/trackingMap/`、`apps/desktop/src/modes/studio/calibration/`

## 触らないもの

- 自動の層（カード87）。

## テスト（担当: CO）

ファイルの名前に `.c88.` を入れる。

- `packages/tracking/src/source/convert.c88.test.ts`: 新しい項目が、ミラーのオン・オフで正しい側に入る。キャリブレーションが掛かる。舌（行う場合）。
- `packages/tracking/src/mapping/defaults.c88.test.ts`: 既定の割り当て（眉の左右別など）。前の版のプロジェクトのカスタムの割り当てが変わらない。
- `apps/desktop/src/modes/studio/trackingMap/inputs.c88.test.tsx`: 割り当ての画面で新しい入力を選べる。
- CH・UC-CH: UC-22 の続き（左右別の眉・口角が実カメラで振れる。実機はカード97）。

## 完了条件（見込み）

- [ ] 新しい入力が、ミラーのオン・オフで正しい側に入る
- [ ] 標準の割り当てに入れた項目が、実カメラで振れる（カード97 で確かめる）
- [ ] 前の版のプロジェクトの割り当てが変わらない
- [ ] CO のテストが通り、テスト確認がある

## 記録

（作業中に書く）
