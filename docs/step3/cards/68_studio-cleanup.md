# カード68 シーン・背景・ホットキーの後始末

| 段              | 担当 | 依存 | 契約 | 実機 | テスト |
| --------------- | ---- | ---- | ---- | ---- | ------ |
| 1（部品・並行） | CO   | 65   | —    | —    | CL     |

課題: I-021・I-022・I-023・I-024。完成条件: S4。

## 目的

配信中に使うシーン・背景・ホットキーの小さな食い違いを片付け、ホットキーのパラメータの上書きを、登録の順に頼らない専用の層（カード65 の `hotkey`）にする。

## 前提

- ホットキー: `apps/desktop/src/hotkeys/`（targets.ts・actions.ts）。パラメータの上書きは、表情と同じ id `expression` の層を使い、順番は登録の順（`apps/desktop/src/modes/index.ts` の登録の順に頼っている）。
- シーン: `apps/desktop/src/modes/studio/scenes/`（presets.ts など）。背景の画像: `apps/desktop/src/modes/studio/backgrounds.ts`。
- 既存のテスト: `hotkeys/*.test.ts(x)`、`studio/scenes/` のテスト、`studio/backgrounds.test.ts`、UC-26・UC-27。

## 作るもの・直すもの

1. **I-021**: ホットキーの背景の選択肢に、backgrounds/ の画像をすべて出す（シーンで使っていない画像も）。
2. **I-022**: 背景のプリセットとシーンの切り替えのコマンドの定義を1つにし、hotkeys が scenes から使う。
3. **I-023**: シーンを消すとき、そのシーンを対象にしたホットキーも消すか確かめる。
4. **I-024**: 背景の画像のプリセットを消せるようにする。使っているシーンがあれば確かめる。
5. **ホットキーの層**: パラメータの上書きを `hotkey` の層で出す（表情の後・アニメーションの前）。

## 触ってよいもの

- `apps/desktop/src/hotkeys/`
- `apps/desktop/src/modes/studio/scenes/`、`apps/desktop/src/modes/studio/backgrounds.ts`・`backgrounds.test.ts`
- `apps/desktop/src/modes/index.ts`（ホットキーの登録の順のコメントを直す行だけ）

## 触らないもの

- `apps/desktop/src/modes/studio/` のほかのファイル（カード66）。

## テスト（担当: CL）

このカードのテストは、実装の担当（CO）ではなく CL が書く（README の「テストの分担」）。テストのファイルは名前にカードの番号（`.c68.`）を入れ、実装の担当は書き換えない。

- `apps/desktop/src/hotkeys/targets.c68.test.ts`: 使っていない背景の画像も選択肢に出る。背景・シーンの定義が1か所（scenes から使う）。
- `apps/desktop/src/modes/studio/scenes/scenes.c68.test.ts`: シーンを消すとホットキーの扱いを確かめ、Undo で両方戻る。背景の画像を消せ、使っているシーンがあれば確かめる。
- `apps/desktop/src/hotkeys/actions.c68.test.ts`: ホットキーのパラメータの上書きが、表情より後・アニメーションより前に効く（最後の値）。登録の順を変えても同じ。
- CH・UC-CH: UC-26・UC-27 の続き。

## 完了条件

- [ ] 使っていない背景の画像もホットキーで選べる
- [ ] 定義が1か所になり、両方の画面が同じ動きをする
- [ ] シーンを消すとホットキーの扱いを確かめ、Undo で両方戻る
- [ ] 背景の画像を消せ、使っているシーンがあれば確かめる
- [ ] ホットキーのパラメータの上書きが、表情より後・アニメーションより前に効く（最後の値のテスト）

## 締めるときに書くもの

- docs/issues.md の I-021〜I-024 を対応済みに。

## 記録

（作業中に書く）
