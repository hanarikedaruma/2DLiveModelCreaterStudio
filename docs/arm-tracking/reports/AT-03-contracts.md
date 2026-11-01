# AT-03 腕・手の契約と保存互換性

2026-11-01 CO。実装済・CL独立確認待ち。基準はschemaVersion **12**、CC-032。[カード](../cards/03-contracts.md)。製品の推定・IK・画面の配線は後続カード。

## 依存と確認

- AT-01は[CO最終確認](AT-01-co-review.md)で条件付き採用。1 Worker、Pose lite→手、Pose先行通知。GPU失敗はCPU Worker、Worker不可は腕だけ利用不可。Workerの外部送信対策はAT-04の必須条件。カメラ25fps・OBSなし・修正前の実機遅延は性能合格の根拠にしない。
- AT-02は[報告](AT-02-rig.md)と[evidence manifest](../evidence/AT-02/manifest.json)の版を使用。
- AT-03の未コミット基準版は[manifest](../evidence/AT-03/manifest.json)。共有checkoutの他担当変更を含めたコミットは作らない。

## 公開APIと責任

型の正本は [schema/arms.ts](../../../packages/schema/src/arms.ts) と [contracts/arms.ts](../../../packages/contracts/src/arms.ts)。両パッケージのindexから公開する。

| 所有     | 入力・操作                                                                                                         | 出力・規則                                                                                            |
| -------- | ------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| AT-04    | `TrackingSource.body?: BodyTrackingCapability`、`configure({enabled,mode,hands})`                                  | `onFrame(BodyTrackingFrame)`、`status/onStatus`。無ければ非対応。別カメラを開かず既存start/stopに従う |
| AT-05    | `BodyAssociation.configure({mirror,calibration})`、`update(frame)`、`reset(generation)`                            | `NormalizedBodyFrame`。本人・左右・ミラー・縦横比をここだけで処理                                     |
| AT-07    | `HandShapeTracker.update(side,hand)`、`reset(generation)`                                                          | 候補・確定形・掌軸。120ms安定はここだけ。unknown時はconfirmedAt/axisObservedAtを更新しない            |
| AT-06    | `ArmIKSolver(input)`、`ArmConstraint(pose,limits,bendSign,fallback)`                                               | FKを満たす制約内姿勢、手首誤差、制限理由。時計・フィルタを持たない                                    |
| AT-09    | `ArmMotionSession.configure(model,settings)`、`update({body,shapes})`、`tick(now)`、`reset(generation,displayed?)` | trackingの腕パラメータだけ。ロスト・平滑化・復帰を管理し、値自体を休止へ戻す                          |
| AT-08    | `ArmRigEvaluator(model,values)`                                                                                    | 合成後の最終静的制約、子→親の回転差分、手の接続変換、opacityゲート。任意時刻の評価は決定的            |
| AT-11/12 | `Services.arms?: ArmService`、setSettings/captureCalibration/clearCalibration                                      | UIはstatus/subscribeを購読。Project/Environmentへの保存はAT-12。AT-11はFakeArmServiceで開発           |

`TrackingFrame`の顔の意味・通知は変更しない。BodyTrackingFrameはPoseだけ／手だけ／両方の通知で、nullは**この通知で更新なし**、空の点列・手配列は**推定済みだが未検出**。更新のない部位をロストにせず、顔の結果で腕の鮮度を更新しない。

各BodySampleはgeneration/frameId/capturedAt/captureSource/completedAt/receivedAtを持つ。単位はページの単調時計ms。WorkerはtimeOrigin差を補正する。Poseと手の完了が分かれるので部位ごとに時刻を保持し、同じframeIdでも別部位の通知を捨てない。AT-04は世代・部位ごとの順序・期限を検査し、AT-05/07/09もreset後の古い世代を受け入れない。generationは停止・再開・設定変更で増加し、古い画像とモデルを解放する。プロジェクト変更時はAT-12がconfigure/resetを一組で行う。

Poseはvisibility付き33点と腰原点のworld点。手はvisibility無し21点、手原点のworld点、左右候補、既成手形の候補。world点が無いときは空配列。値が不正・点数不足ならAT-05/07で欠損にする。SDKの分類スコアを手位置のconfidenceとして使わない。

## 座標・関節

未反転の画像を入力し、観測left/rightは演者自身、モデルL/Rはモデル自身の左右。ミラーONは演者right→モデルL。AT-05は画像の幅・高さでpxへ戻してから肩線・腕長で正規化する。正規化済み観測は各肩原点、**xはモデル外側が正、yは下、校正した上腕＋前腕長が1**。ミラー後の割当と向きはここで完了し、coreで再反転しない。

AT-09が正規化座標×モデルの骨長合計でIK入力pxへ写す。IKのxも外向き、yも下向き。FKをモデル座標へ置く段階でLは+x、Rは−xを用い、肩位置を足す。

角度は度、下向き0、肩を外へ上げる向きが正。肘は非負の曲げ量、固定bendSignにより前腕の合成角は`shoulder + bendSign * elbow`、手はさらにwristを足す。各関節と前腕・手の区間は幅360未満、肘は0以上180未満。初期範囲と休止姿勢はAT-02の結果を使用し、モデルごとに狭められる。

基準関節位置は未変形モデルpx。骨長とreferencePoseが同じ位置を表すことを診断する。専用の肩→肘→手首グループは直接の親子、基礎変換は恒等。AT-08は保存した基準姿勢からの差分を関節位置で適用し、前回変形済み頂点への積み重ねはしない。祖先の回転・正の等倍率は許可。ワープ・負倍率・非等倍率、専用関節への既存変形キーの併用は診断し、AT-10で明示的に解決する。

手形の各画像は手首グループ配下に置き、未変形モデル空間のwrist/fingerDirectionを保存する。AT-08は素材のwristを基準関節のwristへ、指方向をreferencePoseの手方向へ剛体変換してから関節差分を適用する。素材を反転・負倍率化しない。掌面は固定で、左右それぞれの素材を使う。

## 保存・読込

- `Model.armRigs?`: 基準位置・骨長・基準/休止姿勢・可動域・専用グループ・手の接続・パラメータID。enabledはリグ適用のスイッチ。
- `Project.armTracking?`: modeと左右別enabled/gain/smoothing/handMode/restHand。省略は両側OFF。カメラ追従とリグ適用は別。
- `Environment.armCalibration?`: 省略/nullは未校正。カメラID・幅高fps、肩の軸と幅、演者左右の骨長・基準手首。カメラ条件を照合して再校正案内を出すのはAT-05/11。顔のcalibrationと独立。
- 世代・時刻・フィルタ・認識ID・現在の候補は保存しない。
- v11→12は版番号だけ更新する。リグ・腕パラメータ・追従設定・キー・描画順を自動作成しない。旧ArmL/Rは従来の意味を保つ。
- `armParameterIds(side)`と`armParameters(rig)`はAT-10の明示的セットアップで使う。標準パラメータの一括追加に腕を混ぜない。肩/肘/手首は度、手形4重みは0..1。
- `inspectArmRigs(model)`は骨長/角度/参照/循環/重複所有/手形欠損/変形競合を分ける。非休止形の欠損は警告、休止形欠損や参照切れはエラー。保存済みの構造が壊れたJSON（NaN、必須フィールド欠落など）は従来どおり型検証エラー。
- IOは意味上不正なリグを**削除せずenabled=false**にし、その側の追従もOFFにする。残した設定から診断を再表示できる。反対側と顔は維持。2度目の修復は変更しない。

手形は登録済みの最大重みを1つ選び、同点はopen→fist→point→peace。全0・未知・非登録の形は有効な休止形へ戻す。描画順はAT-10の明示的編集だけで保存し、カメラONでは変更しない。

## 時間処理

`ARM_TIMING`は初期値：結果期限250ms、腕保持200ms、休止への戻り500ms、復帰200ms、形確定120ms、形保持500ms、1tickの最大dt 50ms。実測調整は所有カードで根拠を残す。AT-07は候補確定、AT-09は腕/手首/手形別の長期ロスト、AT-08は時間を使わない最終制約。手だけ欠損しても腕を止めず、片側のロストを反対側へ伝播させない。

## 検証・引継ぎ

CO補助試験17件と関連全251件が成功。全workspaceのtypecheck成功。lint・整形を変更範囲に実施。schemaVersionの現行値を明示する既存試験だけ12へ更新し、未知版は13へ更新。既存voice.testのクロージャ内optional参照の型エラーを非null表明で修正（テストの実行内容・製品音声処理は不変）。

CLは`*.at03.test.ts`で独立に旧ファイル・Environment・round-trip・片側参照切れ・循環・重複・角度・顔だけの経路を検証し、カードへ対象manifestと結果を追記する。合格後にAT-04→AT-05を担当する。COはAT-06を担当。契約の変更が必要ならAT-03を再開してCOが直列編集する。

## CO v3（2026-11-01、CL指摘を修正）

- defaults.armCalibration=nullを追加し、実際のenvironment.jsonの再読込でも校正が残るよう修正。CLの既存独立試験29件を再実行して成功。schemaVersion期待値の更新漏れも修正した。
- ArmServiceにsettings/cancelCalibration/diagnostics/onDiagnosticsと診断型、Fakeにも同じ操作を追加。取消しは以前の校正を保持し、診断の通知は状態通知と分離する。
- HandShapeResult.pointDirectionを任意追加。AT-07の指さし候補の方向（同じ肩空間）。無効はnull。AT-09が採用するなら最新の候補・観測時刻を使い、潰れた軸は更新しない。
- 祖先自身の頂点キーは許可し、重複診断を除いた。非等倍率・ワープの制限は維持。旧ArmL/Rの二重適用と腕の流れ線を診断する。
- AT-08の共通経路にTargetDeltas.armsを任意追加。リグ無しの既存実装には追加しない。
- 共通契約に合わせ、AT-11の異常系試験は診断メソッドを明示的に欠かせる入力に変更した（期待値は維持）。元のFake自体は全操作を持つ。独立確認はCLへ依頼する。
