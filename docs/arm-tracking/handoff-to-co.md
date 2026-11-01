# COへの連絡（CLから）

## 2026-11-01：AT-09をCLが引き継ぐ

ユーザーが「残分を一部引き継いでください。それがCOにもわかるようにしておいてください」と指示した。CLは **AT-09（モデルへの追従・平滑化・ロストと復帰）** の実装を引き継ぐ。

| 項目            | 変更前 | 変更後                                                                                                                                |
| --------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| AT-09の実装     | CO     | **CL**（2026-11-01 着手）                                                                                                             |
| AT-09の独立確認 | CL     | **CO**                                                                                                                                |
| 変更範囲        | 同じ   | `packages/core/src/joint/tracking/**` と `*.at09.test.ts`（CLの補助試験は `*.test.ts`）、`packages/core/src/index.ts` の export 行1行 |

選んだ理由：COの残りのうち、AT-09だけがカードに「契約の仮観測で単独開発する」とあり、`joint/tracking/` は COが作業中のAT-06（`joint/math/`）と別のフォルダで、ファイルが重ならない。AT-08（eval・deformの共通経路）とAT-10（モデリング画面）は、AT-06・08の結果と共有の経路に強く依存するので、COのまま残す。

AT-06との関係：AT-09はIKを `ArmIKSolver`（CC-032）として外から受け取り、試験では単純な仮のIKを使う。AT-06の確認済みの版ができたら、既定のIKをAT-06の解に差し替えて試験を流し直し、その版をAT-09のカードに記録する。`joint/math/` には手を入れない。AT-06の独立確認はこれまでどおりCLが行う。

同日、AT-09を実装した（[報告](reports/AT-09-motion-session.md)、「AT-09 CL v1」）。COに独立確認（`*.at09.test.ts`）をお願いする。AT-06が確認済みになったら、CLが `solveArmIK`・`constrainArmPose` で試験を流し直す。

COは引き続き AT-03（CL指摘2件の修正と、AT-11からの契約の追加3つ）、AT-06・08・10・13・15、AT-04・05・07・11 の独立確認を担当する。

## 2026-11-01：独立確認と契約の追加の依頼

- 独立確認待ち：[AT-09](reports/AT-09-motion-session.md)（「AT-09 CL v1」）、[AT-04](reports/AT-04-capture-worker.md)（「AT-04 CL v1」）、[AT-05](reports/AT-05-association.md)（「AT-05 CL v1」）、[AT-07](reports/AT-07-hand-shapes.md)（「AT-07 CL v1」）、[AT-11](reports/AT-11-studio-ui.md)（「AT-11 CL v1」）。対象の版は `evidence/AT-0x/manifest.json`。
- AT-03：[CLレビュー](reports/AT-03-cl-review.md)の不合格1件・更新漏れ1件の修正と、末尾の「追加の依頼（AT-11から、契約の追加）」（`ArmService` に `settings()`・`cancelCalibration()`・`diagnostics()`＋`onDiagnostics()`）。
- AT-07：契約に指さしの向きの欄が無いので `HandShapeEstimate.pointDirection` で返している。AT-08・09が使うなら契約へ移すかを決めてほしい（[報告](reports/AT-07-hand-shapes.md#契約との差coへ)）。

## 2026-11-01：AT-03再確認・AT-06・08・10の独立確認の結果と、AT-05・09の修正

結果は [CL独立確認の報告](reports/AT-06-08-10-cl-review.md)。

- **AT-03 CO v3：合格**（前回の2件は修正済み、追加の契約4件も確認）。**AT-06 CO v1：合格**。**AT-08 CO v1：合格**。
- **AT-10 CO v1：不合格2件**。(1) 腕の設定があると、自動セットアップの再実行で後から足した素材（後ろ髪）が最前面に入る（`preserveArmSetup` が描画順を丸ごと戻す）。(2) キャンバスを押して離すだけで、選んでいる関節・確認中の手首が押した所へ跳ぶ（当たり判定・ドラッグの閾値が無い）。再現の試験は `setup/arms/arms.at10.test.ts` と `modeling/arms/ArmPanel.at10.test.tsx`（失敗のまま置いてある）。判断を求める点も報告にある（手の指方向の既定と基準の手首の角度）。
- AT-10 の実ブラウザでの操作（1440×1000・800×600）：COが外した後に `main.lock` を取って確認した。横はみ出し0・代表姿勢・手振り・ドラッグ・保存とUndo・コンソールのエラー0。指摘2は実機でも再現した。ロックは外してある。
- **AT-09 → CL v2**：COの `session.at09.test.ts`「明示reset無しでも、新世代の観測後に旧世代へ戻らない」が失敗した（新しい世代の後に遅れて届いた古い世代の観測を受け付けていた）。`update` で現在の世代より古い観測を捨てるよう直し、CO の3件と CL の補助試験（試験用のIKと、AT-06 の `solveArmIK`・`constrainArmPose` の両方で20件ずつ）が成功。
- **AT-05 → CL v2**：同じ種類の問題（新しい世代の後の古い世代の通知を処理していた）を直し、補助試験を1件足した。COの独立確認はv2でお願いする。
- AT-11：画面の診断の型を契約（`ArmDiagnostics` ほか）へ差し替えた（動きは同じ。「AT-11 CL v2」、`service.ts` だけ変わった）。
- （COから修正済みと連絡あり）COの作業中の試験の型エラー：`packages/tracking/src/hands/tracker.at07.test.ts` 15行目（`fist: []` が `never[]` になる）、`apps/desktop/src/modes/studio/arms/ArmsSection.at11.test.tsx` 29・38行目（`getByRole` に `exact` は無い）。試験の実行は成功している。

## 2026-11-01：AT-10 CO v2 の再確認は合格

前回の CL 独立試験19件が期待値を変えずに成功し、指摘2件は解消。追加の再確認6件（標準の並べ直し、基準の手首の角度と可動域外の拒否、印の近く＋3pxのドラッグ、顔・反対の腕の確認値の保護、指方向の初期値）と、実ブラウザ2サイズ（`main.lock` を取って確認し、外した）も成功。[報告](reports/AT-06-08-10-cl-review.md#at-10-co-v2-の再確認2026-11-01合格)。CLの確認待ちは無い。これでAT-12の直接依存（AT-04・05・07・08・09・10・11）は全て両者の確認が揃った。

## 2026-11-01：コミットとpush（ユーザーの指示）

ユーザーの指示で、CLが腕・手のトラッキングの作業（AT-01〜11 の確認済みの版、COの AT-02・03・06・08・10 を含む、AT-12 の設計）を `main` にコミットして push した（`c38fa1b`）。ブランチは切り替えていない。`tools/model-authoring/raster.py`（腕と無関係の未コミットの変更）は含めていない。各 manifest の `baseCommit: 6c3e78c`・`uncommitted: true` は、この時点の作業ツリーの版を表す（ファイルの SHA-256 は変わらない）。CLは続けて AT-12 を実装する（ユーザーが設計の4項目を推奨どおり判断）。

## 2026-11-01：AT-12 を実装した（独立確認の依頼）

[報告](reports/AT-12-integration.md)・[manifest](evidence/AT-12/manifest.json)（「AT-12 CL v1」）。ユーザーが設計の4項目を推奨どおり判断した（設定はUndo可、体の推定は必要な間だけ、開発用の入口は削除、校正のホットキーは無し）。カードのとおり `*.at12.test.ts` と、実アプリで fixture を使ったカメラ → モデル → 配信 sink の確認をお願いする。

- **AT-09 → CL v3**：上書きされた側だけ表示中の姿勢からつなぐ `resumeFrom` を足した（既存の約束は不変、補助試験2件）。この追加分の再確認もお願いする。
- `dev/index.tsx`：AT-11 で足した開発用の入口を消した（AT-11 manifest に注記）。
