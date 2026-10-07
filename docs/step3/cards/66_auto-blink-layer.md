# カード66 自動まばたきの層と層ごとの値

| 段              | 担当 | 依存 | 契約 | 実機 | テスト |
| --------------- | ---- | ---- | ---- | ---- | ------ |
| 1（部品・並行） | CL   | 65   | —    | —    | CO     |

課題: I-055。完成条件: M1（値を残す部分）・M2。

## 目的

カード65 の契約どおりに、トラッキングの層をカメラから来た値だけにし、自動まばたきを `auto` の層に移す。割り当てに目が無いときもまばたきするようにし（I-055）、同じ処理が2か所にあるのを1か所にする。実行部は層ごとの値を残す。

## 前提

- カード65 の LayerId（`auto`）、順番、FrameContext の前の層ごとの結果、Environment の `autoBlink`。
- 自動まばたき: `packages/core/src/layers/autoBlink.ts`。今はトラッキングの層の tick（`packages/tracking/src/mapping/producer.ts` の applyBlink）と、実行部のカメラ停止中の経路（`apps/desktop/src/modes/studio/runtime.ts` の trackingProducer）から呼ばれる。
- 層の作り方: `apps/desktop/src/services.ts`。
- 既存のテスト: `packages/tracking/src/mapping/producer*.test.ts`、`packages/core/src/layers/autoBlink.test.ts`、`apps/desktop/src/services.step1.test.ts`・`services.step2.test.ts`、`apps/desktop/src/modes/studio/runtime.test.ts`、e2e の `step1.e2e.ts`・`step2.e2e.ts`、UC-23。

## 作るもの・直すもの

1. **トラッキングの層からまばたきを外す。** applyBlink と、目のための parameterWeights（CC-002）をやめる。顔が外れたときの重みは今のまま。
2. **`auto` の層。** 自動まばたきの producer を作る。目の値がトラッキングの層から来ていない間（割り当てに目が無い・「無効」・顔が外れた・目のトラッキングがオフ・カメラ停止中）は、いつでも働く。`autoBlink` がオフなら働かない。実行部の別の経路は消す。
3. **層ごとの値を残す。** StudioFrame に、そのフレームの層ごとの値を足す（カード67 が表示する）。
4. **設定の画面。** スタジオの設定（トラッキング）に、自動まばたきのオン・オフを足す。Environment に保存する。
5. **既存のテストを新しい層で通す。** 表情の閉じ目・アニメーションが優先すること（I-030 の確認）は変えない。

## 触ってよいもの

- `packages/core/src/layers/`、`packages/tracking/src/mapping/`
- `apps/desktop/src/modes/studio/`（`scenes/` と `backgrounds.ts` を除く）
- `apps/desktop/src/services.ts`、`apps/desktop/src/services/trackingLayer.ts`、`apps/desktop/src/services.step1.test.ts`・`services.step2.test.ts`
- `apps/desktop/e2e/step1.e2e.ts`・`step2.e2e.ts`（層の順で変わる確認だけ。ほかの e2e のファイルはそれぞれのカードが持つ）

## 触らないもの

- `packages/tracking/src/source/`（カード71）、`apps/desktop/src/hotkeys/`（カード68）、`apps/desktop/src/diagnostics/`（カード67）。

## テスト（担当: CO）

このカードのテストは、実装の担当（CL）ではなく CO が書く（README の「テストの分担」）。テストのファイルは名前にカードの番号（`.c66.`）を入れ、実装の担当は書き換えない。

- `packages/tracking/src/mapping/autoLayer.c66.test.ts`（または実行部のテスト）: 割り当てに目が無い・「無効」・顔が外れた・目のトラッキングがオフ・カメラ停止中のどれでも、最後の値の EyeOpenL/R がまばたきする。目の値がカメラから来ている間は重ならない。autoBlink がオフなら働かない。表情の閉じ目・アニメーションが優先する。
- `apps/desktop/src/modes/studio/runtime.c66.test.ts`: StudioFrame に層ごとの値がある。まばたきの処理が1か所。
- `apps/desktop/e2e/autoblink.c66.e2e.ts`: カメラを使わずに、本物のアプリで EyeOpen が自動の層から変わる。
- CH・UC-CH: UC-23 の新しい動き。I-030 の CH の書き直し。

## 完了条件

- [ ] 割り当てに目が無い・「無効」・顔が外れた・目のトラッキングがオフ・カメラ停止中のどれでも、自動まばたきが働く（最後の値で確かめる）
- [ ] 目の値がカメラから来ている間は、自動まばたきが重ならない
- [ ] `autoBlink` がオフなら働かない。設定が保存・復元される
- [ ] 表情による閉じ目・アニメーションが、今までどおり自動まばたきより優先する
- [ ] StudioFrame から層ごとの値が読める。まばたきの処理が1か所になっている
- [ ] `pnpm e2e` が通る

## 締めるときに書くもの

- docs/issues.md の I-055 を対応済みに。I-030 に、まばたきを自動の層へ移したことを追記。

## 記録

- 2026-10-07 CL: 実装した。
  - トラッキングの層（packages/tracking/src/mapping/producer.ts）はカメラから来た値だけを出す。目のトラッキングがオフのときと外れたときは EyeOpenL / R を出さない（前は自動まばたきの値と目だけの重み1を入れていた。CC-002 の parameterWeights はもう使わない）。TrackingLayerOptions.autoBlink をやめた。
  - 自動の層（packages/core/src/layers/autoLayer.ts の createAutoLayerProducer）: 前の層ごとの結果（layersSoFar）を見て、トラッキングの層が目の値を持っていなければ、自動まばたきの値を重み1で出す。片目だけ来ていなければ片目だけ。Environment.autoBlink がオフなら出さない。
  - 実行部（apps/desktop/src/modes/studio/runtime.ts）: カメラ停止中にトラッキングの層の代わりに自動まばたきを出していた経路を消し、自動の層を足した（まばたきの処理は1か所）。producer に layersSoFar を渡し、StudioFrame に layers（そのフレームの層）を足した。setAutoBlink を足し、bindStudioEnvironment から Environment.autoBlink を渡す。
  - スタジオの設定（トラッキング）に「自動のまばたき」のチェックを足した（CalibrationSection.tsx）。
- 確かめたこと: core の autoLayer.test.ts 5件（カメラ停止中・目がカメラから来ている間は出さない・割り当てに目が無い・片目・オフ・範囲・目のパラメータが無い）。tracking の producer のテストを新しい動きに書き直した（目の値を出さない5件）。desktop の runtime.test.ts（I-030 の確認: 見失って3秒後もまばたき・表情の閉じ目が優先）と services.step1.test.ts を新しい動きで通した。全体のテスト（`pnpm -r test`）と型検査が通った。Edge（開発用の画面）で、設定のチェックが保存され、オフで自動の層が出ず、オンで出て、カメラ停止中に目が閉じる（7秒で最小 0）ことを確かめた。
- 確かめていないこと: `pnpm e2e`。CO がカード57・64 を作業中でアプリのソースに書きかけがあるので、区切りまでコミットされてから回す。実カメラでの確認（カード70・72 の UC-23）。
- 締めるときに残っていること: docs/issues.md の I-055 を対応済みに、I-030 に自動の層へ移したことを追記（CO が issues.md を書きかけなので、そのコミットの後）。
- 2026-10-07 CO（テスト担当）: runtime.c66.test.ts 7件が通った。目の割り当てなし・無効・顔が外れた・目のトラッキングオフ・カメラ停止の最終の値、カメラの目の値との非重複、オフ、表情・アニメーションの優先、層の一覧と次の producer への受け渡しを確認。
- カメラなしの本物のアプリ用 autoblink.c66.e2e.ts と CH-146〜147・UC-CH-25 を追加。実行前で、実カメラの確認もまだなのでテスト確認・完了にはしていない。
- テスト確認（CO・2026-10-07）: 担当の runtime.c66.test.ts 7件と autoblink.c66.e2e.ts 1件が通った。本物の Tauri/WebView2 で、カメラ停止中に自動の層から目が閉じ、オフにすると出力せず、設定を保存・再読込できることを確認。`pnpm e2e -- --no-build` 全12件も成功し、外部通信の検査も通った。
- 残る確認: 実際の顔をカメラに写して見失ったとき・目の割り当てを変えたときの確認はカード70・72へ残す。今回は単体テストの5経路と、カメラ停止中のネイティブ動作の確認。共通の書式検査は CL 作業中の real-device-plan.md の整形待ちで、カード全体の完了とは分ける。
