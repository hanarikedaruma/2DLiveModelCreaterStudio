# カード74 複雑な基準モデル

| 段              | 担当 | 依存 | 契約 | 実機 | テスト |
| --------------- | ---- | ---- | ---- | ---- | ------ |
| 0（準備・並行） | CO   | 72   | —    | —    | CL     |

候補: #4。完成条件: S8・P7 の見本。

## 目的

関節の曲げの試作（カード76）と、STEP4 の機能を入れた状態の性能（S8）・操作の回数の比較（P7）に使う、「複雑な」基準モデルを作る。今の基準モデル（fixtures/reference-model、51レイヤー・頂点 3,150）は MVP の評価用で小さい。

## 前提

- 基準モデルの作り方: fixtures/scripts/generate-reference-model.ts（`pnpm --filter @app/fixtures generate:reference`）。同じ流儀で作る（新しい道具は使わない）。
- PSD の書き出し: fixtures/scripts/make-sample-psd.ts と同じ方法。

## 作るもの・直すもの

1. **生成スクリプト** `fixtures/scripts/generate-complex-model.ts` と、`fixtures/package.json` の `generate:complex`。同じ入力から同じ結果を作る（乱数を使うなら種を固定）。
2. **モデル** `fixtures/complex-model/`（project.json・assets/）。目安:
   - レイヤー 150 前後・頂点 10,000 前後
   - 標準パーツをすべて（まとめて版は除く）と、髪の房・服の飾り・アクセサリ
   - 腕: 左は上腕・前腕・手に分け、右は1枚
   - 表情 10、アニメーション 5、物理 3 系統（前髪・横髪・後ろ髪）、2段以上のワープ
   - かんたんセットアップを掛けた状態
3. **PSD への書き出し**（`generate:complex-psd`。git には入れない）。
4. **テスト** `fixtures/complex-model.test.ts`: validateProject を通る、レイヤー・頂点・表情・物理の数、生成し直して同じになる。

## 触ってよいもの

- `fixtures/scripts/generate-complex-model.ts`、`fixtures/complex-model/`、`fixtures/complex-model.test.ts`、`fixtures/package.json` の scripts、`.gitignore`（PSD）

## 触らないもの

- `fixtures/reference-model/`・`fixtures/sample-model/`・`fixtures/stress/`（既存の受け入れが使う）。アプリとパッケージのソース。

## テスト（担当: CL）

このカードのテストは、実装の担当（CO）ではなく CL が書く（STEP3 の README の「テストの分担」）。ファイルの名前に `.c74.` を入れ、実装の担当は書き換えない。

- `fixtures/complex-model.c74.test.ts`: validateProject を通る、レイヤー・頂点・表情・物理の数、生成し直して同じになる、PSD に書き出してアプリの取り込みで同じ素材になる。
- `pnpm measure` で開けることを確かめる。

## 完了条件

- [ ] 生成し直すと同じ結果になる（テスト）
- [ ] validateProject を通り、数がテストで確かめられる
- [ ] アプリで開いてスタジオで動く。`pnpm measure` で開ける（計測の対象に選べる）
- [ ] PSD に書き出せ、アプリで取り込める

## 記録

（作業中に書く）
