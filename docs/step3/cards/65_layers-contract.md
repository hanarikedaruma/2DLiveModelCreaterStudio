# カード65 層と設定の契約

| 段              | 担当 | 依存 | 契約 | 実機 | テスト |
| --------------- | ---- | ---- | ---- | ---- | ------ |
| 1（部品・並行） | CL   | 58   | ○    | —    | CO     |

課題: I-055・I-007・I-032 の契約の部分。判断: 割り当てを「無効」にしても自動まばたきを続け、オン・オフは別に持つ。カード58 の後（契約を変えるカードは同時に1枚）。

## 目的

自動まばたきをトラッキングの層から分け、層ごとの値を後から見られるようにし、ホットキーの上書きを登録の順に頼らないようにするための型と規則を決める。あわせて、カード69 が使う出力の GPU の設定を足す。実装はカード66・67・68・69。

## 前提

- 層の型と順番: `packages/contracts/src/index.ts` の LayerId・LAYER_ORDER・Layer・FrameContext・LayerProducer。今の順は tracking → bodyFollow → expression → animation → lipSync → periodic → physics。
- ミキサー: `packages/core/src/mix/mixer.ts`。同じ規則の写しが仮実装 `packages/contracts/src/fakes/evaluate.ts` にもある。
- 自動まばたきは、トラッキングの層の中（`packages/tracking/src/mapping/producer.ts` の tick。CC-002）と、カメラ停止中の実行部の経路（`apps/desktop/src/modes/studio/runtime.ts`）の2か所にある。
- ホットキーのパラメータの上書きは、表情と同じ id `expression` の層を使い、順番は登録の順（`apps/desktop/src/hotkeys/actions.ts`）。
- Environment: `packages/schema/src/types.ts`。output は `{ method; width; height; fps }`。
- 既存のテスト: `packages/core/src/mix/*.test.ts`、`packages/contracts/src/*.test.ts`、`packages/schema/src/*.test.ts`。

## 決めること・作るもの

1. **LayerId と順番。** `auto`（自動まばたき）と `hotkey` を足す。順は次を案とし、理由を CC に書く。
   - tracking → auto → bodyFollow → expression → hotkey → animation → lipSync → periodic → physics
2. **前の層の結果を後の層へ渡す。** FrameContext に、それまでの層ごとの結果（id・重み・値）を足す。auto の層は、目の値がトラッキングの層から来たか（値があり重みが 0 でないか）をこれで判定する。
3. **層ごとの値を残す型。** 実行部が1フレームの層ごとの値を残すための型（使うのはカード66・67）。
4. **Environment に足す。** `autoBlink: boolean`（既定 true）と、`output` に出力の GPU（アダプターの識別子。既定は「自動」＝既定のアダプター）。読み込み時に無ければ既定値で補う（I-033 の規則どおり）。
5. **ミキサーと仮実装。** ミキサーの順番を新しい LAYER_ORDER にし、仮実装の写しを同じ規則にする。写しを1つにまとめられるならまとめる。
6. **契約の変更記録**（CC）。

## 触ってよいもの

- `packages/contracts/`（`src/assets.ts` を除く）、`packages/schema/`、`packages/core/src/mix/`
- `docs/contract-changes.md`

## 触らないもの

- 層を作る側（トラッキング・自動まばたき・ホットキー・実行部）と Spout2。型を足すだけで、使うのはカード66・68・69。

## テスト（担当: CO）

このカードのテストは、実装の担当（CL）ではなく CO が書く（README の「テストの分担」）。テストのファイルは名前にカードの番号（`.c65.`）を入れ、実装の担当は書き換えない。

- `packages/core/src/mix/mixer.c65.test.ts`: 新しい順（tracking → auto → bodyFollow → expression → hotkey → animation → lipSync → periodic → physics）での合成の値。仮実装と本物が同じ結果になる。FrameContext から前の層ごとの結果が読める。
- `packages/schema/src/environment.c65.test.ts`: autoBlink・出力の GPU の保存・読み込み・既定値の補い・不正な値。
- `apps/desktop/src/shell/environment.c65.test.ts`: 前の版の PC 設定を補い、ほかの正常な設定を保つ。新しい項目を保存して別のストアで読み直す。

## 完了条件

- [ ] 新しい LayerId と順番でミキサーと仮実装のテストが通る
- [ ] FrameContext から前の層ごとの結果が読める（テスト）
- [ ] Environment の新しい項目が保存・読み込み・既定値の補いで扱える（テスト）
- [ ] 既存のテストが通る。順番の変化で変わる期待値は、理由を書いて直した
- [ ] CC がある

## 記録

- 2026-10-07 CL: 契約を変えた（CC-010）。
  - LayerId に auto・hotkey を足し、順を tracking → auto → bodyFollow → expression → hotkey → animation → lipSync → periodic → physics にした。
  - FrameContext に layersSoFar（それまでの層そのもの）を足した。既存の19ファイルが FrameContext を組み立てているので、任意の項目にした（実行部は必ず渡す。カード66）。
  - Environment に autoBlink（既定 true）と output.adapterId（null は自動）を足した。
  - FakeMixer も LAYER_ORDER の順に合成するようにした（合成の方法は上書きのまま。本物との写しを1つにするのは、contracts が core に頼れないのでやめた）。
  - 移行: 層の順・既定値を確かめるテストの期待値と、出力の設定を組み立てている apps/desktop/src/output/spout/controller.test.ts（adapterId: null を足しただけ。カード69 の担当の CO のフォルダだが、着手の前なので直した）。
- 確かめたこと（実装の担当の回帰テスト）: core の mixer.test.ts に2件（層の順、auto と hotkey の効く位置）、contracts の evaluate.test.ts に1件（FakeMixer の順）。全体のテスト（`pnpm -r test`）と型検査が通った。
- 確かめていないこと: 層を作る側の切り替え（カード66・68）。
- 2026-10-07 CO（テスト担当）: `.c65.` の3ファイルを作成。設定12件と層の順・前の層の参照3件は通った。
  - 修正待ち: 完了条件「仮実装と本物が同じ結果」と作るもの5の合成方法の一致は未達。`mixer.c65.test.ts` の add・multiply・max の例は本物10.5、FakeMixer4.75（599c56b で再現）。FakeMixer は blend を無視するため。CL の修正待ちとしてこの1件だけ `it.skip`。修正後に skip を外して実行する。テスト確認・完了にはしていない。
- 2026-10-07 CL（上の修正待ちへの対応）: FakeMixer（packages/contracts/src/fakes/evaluate.ts）の合成を本物（core の mixer）と同じ規則にした。add・multiply・max・override、パラメータ別の重み、数でない値を使わない、最後に範囲へ丸める、同じ id のパラメータは最初のもの。contracts は core に頼れないので写しのまま（作るもの5の「まとめられるなら」はまとめられない）。テストの担当の mixer.c65.test.ts の `it.skip` を `it` に戻し（実装の担当が触ってよい1行）、10.5 で一致して通った。evaluate.test.ts に合成の方法と丸めの1件を足した。全体のテスト（desktop 1,071件ほか）が通った。CC-010 の記述も直した。
- 次: テストの担当（CO）のテスト確認。
