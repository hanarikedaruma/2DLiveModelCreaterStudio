# カード67 計測の表示に層ごとの値

| 段              | 担当 | 依存 | 契約 | 実機 | テスト |
| --------------- | ---- | ---- | ---- | ---- | ------ |
| 1（部品・並行） | CO   | 66   | —    | —    | CL     |

課題: I-007。完成条件: M1 の表示の部分。

## 目的

計測の表示（Ctrl+Shift+D）で、パラメータの値が、どの層（カメラ・自動・体の追従・表情・ホットキー・アニメーション・音声・周期・物理）からいくつ来ているかを見られるようにする。カード36 の完了条件「BodyAngleX・BodyAngleZ が顔に合わせて出る（計測の表示で確認）」も、これで確かめられるようになる。

## 前提

- カード66 で StudioFrame に層ごとの値がある。
- 計測の表示: `apps/desktop/src/diagnostics/`。今は fps と遅延だけで、5分の記録を JSON に書き出せる。
- 既存のテスト: diagnostics のテスト、e2e の `diagnostics.e2e.ts`、UC-15。

## 作るもの・直すもの

1. 選んだパラメータ（既定: 顔の角度・目の開閉・口の開閉・体の角度）について、層ごとの値と重み、最後の値を表で出す。
2. 表示するパラメータを選べる（この表示の中だけで覚える）。
3. JSON の書き出しに、選んだパラメータの層ごとの値を入れる（量が増えすぎないよう間引く）。
4. 表示しても描画の fps が落ちない（更新は数回／秒）。

## 触ってよいもの

- `apps/desktop/src/diagnostics/`、`apps/desktop/e2e/diagnostics.e2e.ts`

## 触らないもの

- 実行部（カード66）。

## テスト（担当: CL）

このカードのテストは、実装の担当（CO）ではなく CL が書く（README の「テストの分担」）。テストのファイルは名前にカードの番号（`.c67.`）を入れ、実装の担当は書き換えない。

- `apps/desktop/src/diagnostics/layers.c67.test.tsx`: 層ごとの値と最後の値の表、表示するパラメータの選択、JSON に層ごとの値が入る。
- `apps/desktop/e2e/diagnostics.c67.e2e.ts`: 本物のアプリで計測の表示を開き、カメラ停止中の目が「自動」の層から来ていると読める。
- 計測: 表示の前後で描画の fps が下がらない（`pnpm measure`）。
- CH・UC-CH: UC-15 の続き。

## 完了条件

- [ ] カメラ停止中に、目の値が「自動」の層から来ていると読める
- [ ] 表情を掛けると、表情の層の値と最後の値の違いが読める
- [ ] JSON に層ごとの値が入る
- [ ] 表示しても描画の fps が下がらない（`pnpm measure` の前後）

## 締めるときに書くもの

- docs/issues.md の I-007 を対応済みに。docs/status.md のカード36 の未確認の項目を確かめて書く。

## 記録

### CO 実装（2026-10-07）

- 合成前の9層の値・有効な重み（parameterWeights を優先）・合成方法と、実行部の最後の値を表にした。未担当と0を分け、同じ層に複数 producer がある場合もすべて出す。実行部は変更しない。
- 顔・目・口・体の9パラメータが既定。モデルのパラメータから表示を選び、この表示のインスタンス内だけで覚える。横スクロール時もパラメータと最後の値を固定し、小さい画面では窓全体を縦にスクロールできる。
- 表示と記録は500msに1回。記録時だけ選択した有限の値を写し、元データが変更されても記録は変わらない。非表示でも記録できる。従来の version 1 の JSON に samples.layers を追加（atMs/parameterIds/final/layers。層の values/weight/parameterWeights/blend）。5分で最大601サンプル。
- 自分の回帰テストは表・選択・記録の3件すべてが実装前に失敗。実装後は既存9件を含む12件が通り、型・lint も確認した。既存 diagnostics.e2e.ts に実自動層・表情の加算と最終値・JSON の間引きを追加。
- CL 用公開口: registerDiagnostics の従来 API、createLayerDisplay(selected: Set<string>)、sampleLayers(frame, ids, atMs)、collector.onLayerFrame(frame, now, ids)。DOM の表に data-parameter-id / data-layer-id / data-final がある。
- 残り: CL 独立テスト・テスト確認と CH、Edge 2サイズ、本物のアプリの e2e、pnpm measure で表示前後の比較、全体チェック。I-007 とカード36の確認はこれらの結果を揃えてから締める。
