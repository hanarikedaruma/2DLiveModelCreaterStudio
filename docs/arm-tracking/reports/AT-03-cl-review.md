# AT-03 CL独立確認

2026-11-01 CL。対象は[AT-03 manifest](../evidence/AT-03/manifest.json)の「AT-03 CO v1」（13ファイルのSHA-256が現物と一致することを確認）。[報告](AT-03-contracts.md)・CC-032の約束から期待値を別に計算し、COの補助試験・実装の式は写していない。

## 結果：不合格1件（Environmentの腕の校正が読み直しで消える）と既存の試験の更新漏れ1件、他は合格

| 試験ファイル                                                                                                | 件数 | 結果        |
| ----------------------------------------------------------------------------------------------------------- | ---- | ----------- |
| [packages/schema/src/arms.at03.test.ts](../../../packages/schema/src/arms.at03.test.ts)                     | 16   | 全て成功    |
| [packages/io/src/project/arms.at03.test.ts](../../../packages/io/src/project/arms.at03.test.ts)             | 5    | 全て成功    |
| [packages/contracts/src/fakes/arms.at03.test.ts](../../../packages/contracts/src/fakes/arms.at03.test.ts)   | 5    | 全て成功    |
| [apps/desktop/src/shell/environment.at03.test.ts](../../../apps/desktop/src/shell/environment.at03.test.ts) | 3    | **1件失敗** |

再現：`node node_modules/vitest/vitest.mjs run src/shell/environment.at03.test.ts`（apps/desktop で実行）。関連パッケージの全試験（schema 136件・io 177件・contracts 59件・desktop/shell 102件）は、上の1件を除いて成功。4パッケージの型検査・変更範囲のlint・整形も成功。

### 不合格：保存した腕の校正が、environment.json の読み直しで捨てられる

- 現象：`armCalibration` を含む environment.json を `parseEnvironment` で読むと、結果の `armCalibration` が `undefined` になる（失敗した試験「保存した腕の校正は、読み直しても同じ」）。アプリを開き直すたびに腕の校正が消え、毎回やり直しになる。
- 原因：`apps/desktop/src/shell/environment.ts` の `parseEnvironment` は、`createDefaultEnvironment()` にあるキーだけを1つずつ検証して残す。`packages/schema/src/defaults.ts` の既定値に `armCalibration` が無いので、読んだ値が結果へ入らない（`voice` は既定値にあるので残る）。
- 期待：保存した校正は同じ値で読める。壊れた校正は未校正に戻し、他の設定を失わない（この2点は現状でも成功）。
- 直し方の案（COの判断）：既定値に `armCalibration: null` を足すと、既存の「キーごとに検証し、不正なら既定値」の仕組みで両方を満たせる。CC-032の「省略/nullは未校正」とも合う。契約本体はCOの直列所有なので、CLは直していない。

### 追加（同日、デスクトップ全体の試験で見つけた）：既存の試験が保存形式11を決め打ちしている

- 現象：`apps/desktop/src/modes/animation/SettingsPanel.test.tsx` の「現在の姿勢からの実験設定をUndo・プリセット切替・保存後の再読込で保つ（I-060）」が `expected 12 to be 11` で失敗する（39行目 `expect(loaded.project.schemaVersion).toBe(11)`）。
- 原因：AT-03で保存形式を12に上げたが、この既存の試験の現行値が11のまま（HEADから未変更）。製品の動作の不具合ではなく、試験の期待値の更新漏れ。
- デスクトップ全体（175ファイル・1,410件）では、この1件と上の腕の校正の1件だけが失敗し、他は成功。AT-04の変更とは無関係（AT-04の変更前の状態でも同じ値になる）。

## 合格した確認

- **旧版と既定値**：保存形式は12。11のファイルは版だけが上がり、腕のリグ・パラメータ・追従設定・描画順を足さない。旧ArmL/R（−1..1）はそのまま。13は読まない。標準パラメータの表（MVP・STEP2）と新しいプロジェクトに新しい腕のパラメータは入らない。追従設定の既定は両側OFF。11のフォルダを開くと変換前の写し（`project.v11.*.json`）を残す。
- **保存の往復**：両腕のリグ・追従設定はJSONの往復とフォルダの保存→読込で同じになり、修復も起きない。NaN・必須の欠落は従来どおり型の検証で止まる。
- **片側の参照切れ（IO）**：Rの手首グループを消すと、Rのリグを消さずに `enabled: false` にし、Rの追従をOFFにする。Lのリグ・追従設定、顔の割当、描画順、パラメータは変わらない。2度目の修復は何も変えない。追従設定の無いプロジェクトでは追従設定を作らない。リグの無い側の追従ONはOFFにする。
- **診断（片側だけ）**：骨長0・関節位置との不一致、角度（幅360・逆順・肘180・組合せ制約の外の休止姿勢・基準角と関節位置の食い違い）、Lの肩→肘→手首の循環（Rは無傷）、参照（手首グループ・手の画像の置き場所・制御先のパラメータ）、所有の重複（同じ側の2リグ・手の画像の共有・パラメータの共有・旧ArmLを制御先）、手形の欠け（休止形以外は警告、休止形はエラー）、変形（祖先の回転・正の等倍率は許可、祖先の非等倍率・ワープと専用関節の基礎変換は診断）。bendSign −1 も、基準姿勢から求めた関節位置と一致すれば診断しない。
- **Environmentの校正の値**：省略・nullは未校正、正しい校正は検証を通る、肩の軸が単位でない・左向き・骨長0は通さない。顔の校正とは独立。
- **顔だけの経路**：`body` を持たない既存の推定元（FakeTrackingSource）は顔の通知をそのまま出す。仮の腕の推定は、設定のたびに世代を増やして古い世代を捨て、Poseだけ・手だけの通知を分けて届け、null（更新なし）と空（推定済み・未検出）を区別し、同じframeIdの別部位を捨てない。手を止めた設定では手の通知を出さない。腕のサービスの状態は写しで返る。

## 判断を求める点（不合格ではない）

1. **親が画像パーツで頂点のキーがあると、両腕が無効になる**：腕の親（`parentPartId`）が胴体の画像で、その画像に呼吸などの頂点のキー（vertices）があると、両腕が「腕の頂点変形は初版の対象外」で無効になる。変形パイプライン（`packages/core/src/deform/pipeline.ts`）では頂点の差分はそのメッシュ自身にだけ効き、子の腕は動かさない（祖先のワープは子孫に効くので、ワープの診断は妥当）。祖先の頂点キーまで診断の対象にするかはCOの判断。実モデル（AT-15）で胴体に頂点キーがあると腕が使えなくなる。
2. **祖先の非等倍率のキー**：胴体のグループに呼吸で縦だけを拡大するキー（scale.y ≠ scale.x）があると腕が無効になる。設計どおり（非等倍率は腕を潰すので対象外）だが、実モデルでよくある作りなので、AT-10の画面で理由と直し方を示す必要がある。
3. **診断の重複**：腕の親子が循環すると、同じ診断が複数回出る（Lだけで9件、`cycle:sh-l` が2回）。修復の文言は重複を除くので保存には影響しないが、診断の画面（AT-10/11）が騒がしくなる。

## 後続への影響

AT-04が使う部分（`TrackingSource.body`・`BodyTrackingCapability`・`BodyTrackingFrame`・時刻と世代の約束・`FakeBodyTracking`）は合格。不合格の1件はEnvironmentの保存で、AT-04の範囲外。AT-04は契約に沿って着手する。AT-03の完了は、COの修正と、この試験の再実行の後にする。

## 追加の依頼（AT-11から、契約の追加）

2026-11-01 CL。不合格ではない。AT-11の画面（ユーザーが設計の判断7で「COへ依頼し、届くまでは仮サービスで同じ形を持って作る」を選んだ）が要る3つを、`ArmService` に足してほしい。形と理由は[AT-11報告](AT-11-studio-ui.md#coへの依頼契約の追加)。

1. `settings(): ArmTrackingSettings`（設定の読み出し。`FakeArmService` の private `settings` は名前を変える必要がある）
2. `cancelCalibration(): void`（途中の手順の記録を捨て、前の校正を残す）
3. `diagnostics(): ArmDiagnostics | null` と `onDiagnostics(listener)`（撮影時刻・画像の大きさ・Poseの肩肘手首・手の手首・左右の採用した点と目標／実際の手首・制限の理由）

## 確認の対象（試験ファイルのSHA-256）

| ファイル                                          | SHA-256                                                            |
| ------------------------------------------------- | ------------------------------------------------------------------ |
| `packages/schema/src/arms.at03.test.ts`           | `c33f08149a5833aab046d8b838aa846fb892dea12541544792196a6c97b96357` |
| `packages/io/src/project/arms.at03.test.ts`       | `e299feebb104766b2e8d41f55449cec51a7d916d72f32d69d6c2ae1988b3b0ad` |
| `packages/contracts/src/fakes/arms.at03.test.ts`  | `068e967df19b9e7c9bf98e6c2c75d6597dbdfd98cebee55336a302a166e76bf9` |
| `apps/desktop/src/shell/environment.at03.test.ts` | `5b0ab467776dffc74fef7adba1ffd6fb0d71bfec58fa56ad1e22c5fe60cc9247` |

照合した製品側：`apps/desktop/src/shell/environment.ts` `81239721…abe0`、`packages/schema/src/defaults.ts` `08a1f471…5651`（どちらもAT-03 manifestの対象外で、HEAD `6c3e78c` から未変更）。
