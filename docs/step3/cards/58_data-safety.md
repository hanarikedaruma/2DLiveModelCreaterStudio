# カード58 データ保全

| 段              | 担当 | 依存 | 契約 | 実機 | テスト |
| --------------- | ---- | ---- | ---- | ---- | ------ |
| 1（部品・並行） | CL   | 55   | ○    | —    | CO     |

課題: I-056・I-057・I-027。完成条件: D1・D3（[開発方針](../../step3-plan.md) 2章）。D4 の自動テストの分。

## 目的

保存したモデルが、素材の欠け・保存の途中の停止・消したパラメータの参照で、失われたり開けなくなったりしないようにする。

## 前提

- 読み込み: `packages/io/src/project/projectIO.ts` の readAssets は、PNG が1つ欠けると MissingAssetFilesError で全体を止める。画面には素材の id が出るだけ。
- 書き込み: `.tmp` に書いてから名前を変える。失敗すると移動先を消してから変え直す（`apps/desktop/src/platform/tauriFs.ts` の rename）。
- パラメータを消す: `apps/desktop/src/modes/modeling/userParams/userParams.ts`。物理の入力からは外すが、出力先（outputParameterId）は残る。
- 既存のテスト: `packages/io/src/project/*.test.ts`、`apps/desktop/src/project/actions.test.ts`、e2e の `recovery.e2e.ts`、UC-11（tests/usecase/usecases.md）。

## 作るもの・直すもの

1. **欠けた素材でも開く（I-056）。**
   - 欠けた素材は透明の代わりで開き、「欠けた素材」の一覧（パーツ名・元のファイル名・レイヤー名）を出す。
   - 一覧から PNG・PSD のレイヤーを選んで差し替える。差し替えは1回の Undo。保存すると解消する。
   - ProjectIO.load の結果に欠けた素材を足す（契約の変更）。
   - 外で書き換えた PNG は、ハッシュが記録と違えば知らせる（読み込みは続ける）。
2. **置き換えで消さない（I-057）。** 置き換えを1回の操作にする（Rust 側で Windows の置き換えを使うコマンドを足す）。開くときに `project.json` が無く `.tmp` だけが残っていれば、復元を勧める。
3. **消したパラメータを指す物理（I-027）。** パラメータを消すと、それを出力先にした物理の出力先も外す（1回の Undo、Undo で戻る）。前の版で残っていたものは、開くときに外して知らせる（開くのは拒まない）。
4. **自動テスト（D4 の分）。** 強制終了からの復元、壊れた JSON、欠けた素材、置き換えの途中の失敗を差し込むテストは、テストの担当（CO）が書く（下の「テスト」の節）。実装の担当は、直す前に失敗する回帰テストを自分のテストに書く。

## 触ってよいもの

- `packages/io/src/project/`
- `packages/contracts/src/index.ts`（ProjectIO の型）と `packages/contracts/src/fakes/`
- `packages/schema/src/validate.ts`（参照の規則が要れば）
- `apps/desktop/src/project/`（欠けた素材の一覧と差し替えの画面もここに置く）
- `apps/desktop/src/platform/`
- `apps/desktop/src-tauri/src/lib.rs`（置き換えのコマンド）と `apps/desktop/src-tauri/capabilities/`（要れば）
- `apps/desktop/src/modes/modeling/userParams/`
- `apps/desktop/e2e/recovery.e2e.ts`（既存の確認が変わる場合だけ。新しい e2e はテストの担当の `recovery.c58.e2e.ts`）
- `docs/contract-changes.md`

## 触らないもの

- `packages/io/src/import/`・`packages/contracts/src/assets.ts`・`apps/desktop/src/modes/modeling/assets/`（カード57）。

## テスト（担当: CO）

このカードのテストは、実装の担当（CL）ではなく CO が書く（README の「テストの分担」）。テストのファイルは名前にカードの番号（`.c58.`）を入れ、実装の担当は書き換えない。

- `packages/io/src/project/projectIO.c58.test.ts`: 欠けた素材があっても開け、欠けた素材の一覧が返る。差し替えて保存すると一覧が空になる。ハッシュの違う PNG を知らせる。
- 同じファイル: 置き換えの途中の失敗を差し込む（1回目の名前の変更が失敗・消したあとに失敗）。どちらでも project.json か .tmp から元の内容に戻せ、.tmp だけが残っていれば復元を勧める。
- `apps/desktop/src/modes/modeling/userParams/userParams.c58.test.ts`: パラメータを消すと物理の出力先も外れ、Undo で戻る。前の版の残りは開くときに直して知らせる。
- `apps/desktop/e2e/recovery.c58.e2e.ts`: 素材を1つ消したプロジェクトを本物のアプリで開き、一覧から差し替えて保存する。
- CH・UC-CH: UC-11 に、欠けた素材・置き換え・パラメータの削除を足す。

## 完了条件

- [ ] 欠けた素材のあるプロジェクトが開け、一覧が出て、差し替えと保存で元に戻る
- [ ] 置き換えの途中の失敗を差し込んでも、`project.json` か `.tmp` から元の内容に戻せる
- [ ] パラメータを消すと物理の出力先も外れ、Undo で戻る。前の版の残りは開くときに直して知らせる
- [ ] 強制終了の復元・壊れた JSON・欠けた素材の自動テストがある（e2e を含む）
- [ ] 契約の変更記録（CC）がある

## 締めるときに書くもの

- docs/issues.md の I-027・I-056・I-057 を対応済みに。

## 記録

（作業中に書く）
