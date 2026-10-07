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

- 2026-10-07 CO: ホットキーのパラメータを専用の `hotkey` 層へ移した。順はカード65の層で決め、表情の登録順に頼るコメントを削除。背景のプリセット・表示名とシーンの切り替えコマンドはscenesの定義を再利用する。
- シーンとホットキーの画面は同じ `useBackgroundImagePaths` で未使用の背景画像も読む。`targetOptions(action, project, listedImages)` の3つ目でファイルの一覧を渡す（省略時は従来のシーンの背景）。シーンを削除すると対象ホットキーの数を出して確認し、1回のUndoで両方戻す。確認中の変更では削除しない。
- 背景の画像の横に削除ボタンを付けた。使うシーンの名前と背景ホットキーの数を確認し、シーンは透明へ、対象ホットキーは削除へ。画像は `backgrounds/.removed/` へ退避し、一覧から外す。履歴のスナップショットに合わせてファイルも復元・退避するため、1回のUndo/Redoで画像と設定が戻る。未保存の画像は保存対象から外し、Undoで戻す。別名で保存した後のUndoは現在のフォルダへ元のバイトを戻す。退避の失敗では設定を変えない。
- 公開の口: `removeBackgroundImage(store, files, dialogs, path)`、純粋な参照変更は `removeBackgroundImageCommand(path)`、BackgroundFilesには `remove(path)`・`restore(path)`。削除の確定前にファイルも履歴も変えない。
- 自分の回帰テストは未使用画像・シーン削除の2件と背景ファイルの2件が修正前に失敗。関連129件、型とlintが成功。CLの層の10件は実装コミット後にskipの行だけを外して確認する。
- 残り: CLの独立したtargets/scenesテスト・CH/UC-CHとテスト確認、Edgeの2画面サイズと全体検査。

- 2026-10-07 CL（テストの担当）: 先に `apps/desktop/src/hotkeys/actions.c68.test.ts`（10件）を書き、`describe.skip`（カード68 の実装待ち）でコミットした。今の公開の口（createHotkeyActions の producer・createStudioRuntime・registerLayerProducer）だけを使う。producer の id が hotkey、表情とホットキーの登録の順2通り・アニメーションを加えた6通りで最後の値と層の並び（表情 → ホットキー → アニメーション）、もう一度押す・押している間を離すと表情の値に戻る。skip を外して今の実装で動かすと10件とも失敗する（直す前の失敗の確認）。実装の担当は、実装をコミットしたら skip の1行だけを戻す。
- 残り: `targets.c68.test.ts`・`scenes.c68.test.ts` は、背景の画像の一覧の渡し方とシーン・背景の削除の口が決まってから書く（着手したら知らせてほしい）。CH・UC-CH も実装の後。
