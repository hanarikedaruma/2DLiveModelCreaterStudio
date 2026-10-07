# カード55 作業の確定と進め方の準備

| 段              | 担当 | 依存 | 契約 | 実機 | テスト |
| --------------- | ---- | ---- | ---- | ---- | ------ |
| 0（準備・直列） | CL   | —    | —    | —    | CO     |

課題: I-054（確定）。

## 目的

今ある作業中の変更を確定し、CL と CO が同じ作業フォルダで STEP3 のカードを進められる状態にする。以後のカードはすべてこの後に始める。新しい開発環境・スクリプト・リモートは作らない。

## 作るもの・直すもの

1. **作業中の変更の確定。** 未コミットの変更を確かめ、まとまりごとにコミットする。書きかけのものがあれば、確定してよいかを CO とユーザーに確かめてから。
   - I-054 の修正（`apps/desktop/src/modes/modeling/mesh/meshDrag.ts`・`meshTool.ts`・`meshWarpEditing.test.tsx`）
   - ユースケーステストの更新と結果（`tests/usecase/`）。`changes.md`・`checkpoints.md` は `pnpm format:check` を通らないので、`prettier --write` で整えてから
   - 操作性の確認と証跡（`docs/modeling-usability-2026-10-07.md`・`docs/evidence/`）
   - STEP3 の文書（`docs/step3-plan.md`・`docs/step3/`・`docs/step4-candidates.md`・`docs/part-image-prompts.md`・`docs/issues.md`）
2. **ブランチを main にする。** 今は `feat/i039-head-rotation`（main と同じコミット）。STEP3 の間は CL も CO も main のままで作業し、ブランチを切り替えない（同じ作業フォルダなので、切り替えるともう一方の作業が消える）。
3. **既存の確認が通ることを確かめる。** `pnpm format:check`・`pnpm lint`・`pnpm typecheck`・`pnpm test`、`apps/desktop/src-tauri` で `cargo test`、`pnpm e2e`。これを STEP3 の出発点の結果として記録する。
4. **ロックのフォルダ。** `.cache/locks/` を作る（git には入れない。README の「アプリ・e2e・計測を使うとき」）。
5. **docs/status.md** に「STEP3（カード55〜72）」の節を足し、出発点のコミットと確認の結果を書く。

## 触ってよいもの

- git の操作（コミット・ブランチの切り替え）、`.cache/locks/`
- `tests/usecase/changes.md`・`checkpoints.md`（書式を整えるだけ）、`docs/status.md`、`docs/issues.md`（I-054 の記述）、`docs/step3/`

## 触らないもの

- アプリのソースの中身（コミットするだけで変えない）。

## テスト（担当: CO）

このカードのテストは、実装の担当（CL）ではなく CO が書く（README の「テストの分担」）。テストのファイルは名前にカードの番号（`.c55.`）を入れ、実装の担当は書き換えない。

- 新しいテストは無い。CO は、出発点の確認（format:check・lint・typecheck・test・cargo test・e2e）の結果を見直し、記録に「テスト確認（CO・日付）」を書く。

## 完了条件

- [ ] 作業フォルダに未コミットの変更が無く、ブランチが main
- [ ] 既存の確認（format:check・lint・typecheck・test・cargo test・e2e）の結果が記録されている（通らないものは理由と課題）
- [ ] I-054 の記述が「コミット済み・実機はカード70」になっている

## 記録

- 2026-10-07 CL: 作業中の変更（I-054・ユースケーステスト・操作性の確認・STEP3/STEP4 の文書）をまとまりごとにコミットし、ブランチを main にした。
- 確かめたこと: `pnpm format:check`・`lint`・`typecheck` が通った。`pnpm test` 223 ファイル・2,105 件、`cargo test` 23 件（1 件 ignore）、`pnpm e2e` 10 件がすべて通った（docs/status.md の STEP3 の節）。
- 確かめていないこと: 実機（カード70）。
- 次: CO のテスト確認（出発点の結果の見直し）。

### CO の出発点の確認（2026-10-07）

- `80355ba` の作業フォルダ（I-054 の未コミット修正を含む）で、`pnpm lint`・`pnpm typecheck`・`pnpm test` が通った。単体テストは全 2,205 件（desktop 999 件、io 129 件を含む）。
- `pnpm format:check` は 12 ファイルで不整形: `docs/step4/cards/73_scope.md`〜`82_joint-contract.md` と、`tests/usecase/changes.md`・`checkpoints.md`。CL の整理後に再確認する。
- `cargo test` も通った（23 件成功、計測用の 1 件は既定どおり ignored）。e2e は既存変更の確定とアプリのロック取得後に確認する。この時点ではカード全体の「テスト確認」は未確定。
- 実行環境は既存の `.cache/bin/pnpm.cmd` と `.cache/corepack` を使用（`docs/verification-env.md` の手順）。
- CO の今回の未コミット変更は、この検証記録の追記のみ。カード55 の整理のコミットに含めてよい。カード57 以降のソースにはまだ着手していない。

### テスト確認（CO・2026-10-07・出発点の記録の照合）

- CL の整理後の `ed1c4b6` と docs/status.md の6種類の成功記録、I-054 のコミット `c439b2a` と「実機はカード70」の記述を照合した。最初に保留した整形12ファイルは現在の検査で問題なし。Native の全12件の成功記録には、出発点の10件と外部通信の確認が含まれる。
- 出発点の単体テスト件数は、CL の2,105件と CO の2,205件が不一致。出発点の実行ログは今回見つからず、件数は未確定として残す。現在の追加テストの件数とは区別する。
- 現在の全体の整形・lint・型検査は、別作業の `fixtures/scripts/build-desktop-character.ts` と `projects/` のため未達。この2パスだけを除いた検査はすべて成功したが、恒久設定は変更していない。現在の別作業を削除・移動・コミットして出発点を作り直す必要はない。
- 出発点の結果の照合は済み。件数の記録の照合と通常の全体検査を残し、カード全体の「完了」は保留。各カードの締めの条件と生成物の具体的な扱いは[締めに向けた確認](../closure-readiness-2026-10-07.md)に記録した。
