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

- 2026-10-07 CL: 実装した。
  - I-056: `ProjectIO.load` は素材が欠けていても開き、同じ大きさの透明な PNG の代わりで返して `report.missingAssetIds` に入れる。ハッシュが記録と違う素材は `changedAssetIds`（読み込みは続ける）。アプリは開いたときに知らせ、素材トレイに「欠けた素材」（`apps/desktop/src/project/MissingAssetsSection.tsx`）を出す。PNG か PSD を選んで差し替える（PSD は元のレイヤー名と同じレイヤー、無ければ選ぶ）。差し替えは新しい素材の id にしてパーツの参照を付け替えるので、1回の Undo で欠けた状態に戻る。保存では欠けたままの素材を書かない（`SaveOptions.skipAssetIds`）。
  - I-057: 置き換えで移動先を消すのをやめた（`apps/desktop/src/platform/rename.ts` の `renameWithRetry`）。Tauri の fs プラグインの rename は `std::fs::rename` で、Windows では移動先があれば1回の操作で置き換える（tauri-plugin-fs 2.6.0 の commands.rs で確かめた）。失敗はほかのプログラムがファイルを開いているときなので、50・200・800ms 待って試し直し、それでも駄目なら前のファイルを残したままエラーにする。開くときに project.json が無く .tmp だけがあれば、そこから開き、保存するまで変更ありにする。素材の .tmp も同じ。
  - カードから変えた点: カードの「Rust 側で置き換えるコマンドを足す」は、rename がすでに置き換えなので不要だった。src-tauri には触っていない。
  - I-027: パラメータを消すと、出力先がそのパラメータの物理も物理ごと消し、パーツの physicsId も外す（1回の Undo）。確認の文に「物理（出力先） N 個」を出す。前の版で残っていたものは、開くときに `packages/io/src/project/repair.ts` で外して知らせる。
  - 契約の変更: CC-009（`LoadReport`・`LoadedProject`・`SaveOptions`・`emptyLoadReport`）。
- 確かめたこと（実装の担当の回帰テスト）: io の projectIO.test.ts に6件（欠けた素材・欠けたままの保存・ハッシュの違い・project.json.tmp から開く・素材の .tmp・出力先の無い物理）、desktop の rename.test.ts 3件、userParams.test.ts 1件（と既存の期待値の直し）、actions.test.ts 3件、MissingAssetsSection.test.tsx 2件。直す前のコードでは落ちる内容。
- 確かめていないこと: 本物のアプリでの欠けた素材の差し替え（CO の e2e `recovery.c58.e2e.ts` とカード70・72 の UC-11）。Windows で rename が実際に失敗する場合（ファイルを開いたままにする）の確認。
- 気づいたこと: 透明な PNG を作るのに `packages/io/src/import/png.ts` の encodePng を使っている（カード57 の担当のフォルダ。import しているだけ）。
- 2026-10-07 CO（テスト担当）: projectIO.c58.test.ts 7件と userParams.c58.test.ts 2件が通った。複数の欠け、書き込みを伴わない読み込み、代用品を書かない保存、外部で変わった PNG、2種類の置き換え失敗、素材の .tmp、壊れた JSON、物理の削除・Undo・Redo・再読込を確認。
- 本物のアプリ用 recovery.c58.e2e.ts と CH-141〜143・UC-CH-23 を追加。差し替えの一覧、サイズの確認、Undo・Redo、保存後の PNG の画素と再読込を確認する。実行前なのでテスト確認・完了にはしていない。
- 2026-10-07 CL（実装の担当から CO へ）: CO の apps/desktop/e2e/recovery.c58.e2e.ts（44273a8）が、e2e の型検査（apps/desktop の typecheck の e2e/tsconfig.json）で `@app/io/src/import/png` を解決できず失敗している（TS2307）。main の `pnpm typecheck` が通らない。テストの担当のファイルなので CL は直していない。
- 2026-10-07 CO: 上の e2e の非公開パスへの参照を取り除き、実アプリの createImageBitmap と 2D コンテキストで保存後の PNG の画素を比較するように直した。desktop のソースと e2e の型検査が通った。ネイティブ e2e の実行は続ける。
