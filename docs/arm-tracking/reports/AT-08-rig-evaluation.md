# AT-08 共通の関節評価と手形表示

2026-11-01 CO。**実装済・CL独立確認待ち**。[カード](../cards/08-rig-evaluation.md)、[対象manifest](../evidence/AT-08/manifest.json)。

evaluateArmRigsが合成後の値へ静的制約を適用し、TargetDeltas.armsに関節差分、手の接続変換、表示ゲート、診断を返す。BindingEvaluatorが生成し、DeformPipelineが手首→肘→肩→体の祖先へ各1回適用する。基準画像が曲がっていても同じ関節へ接続し、以前の頂点へ回転を蓄積しない。

手のwrist/fingerDirectionは、素材自身と手首より下の基礎変換の後・専用手首の前のモデル空間。素材のwristをリグの基準wristへ正の等倍率1の剛体変換で接続する。左右のUVや倍率を反転しない。手形は登録済みの最大重みを1つ選び、同点はopen→fist→point→peace。全0・非有限は休止形。ゲートは既存opacity/visibleと乗算し、保存値を変えない。固定drawOrderを使う。

不正な腕はその側のゲートを0にし、顔と反対側を継続する。腕の循環は評価用の写しだけで切る。外部の負倍率・非等倍率・腕の頂点差分も描画を止める。旧ArmL/Rの同時変形、腕の流れ線は診断対象。祖先自身の頂点キーは子へ伝播しないので許可する。

モデリング、アニメーション、studio/runtime、配信出力、hairDynamics/frameの髪・胸・肩接触の補助評価は、同じBindingEvaluator→DeformPipelineを通るため、個別の腕後処理は追加していない。

CO補助7件成功：基準角2種類、接続・骨長、親の12度回転/0.85倍/呼吸移動、繰返しの一致、合成後の極端値、手形・opacity・visible、片側の欠損/反転/循環、リグ無し。関連208件成功。[正式fixture](../../../fixtures/arm-tracking/README.md)に4種類の保存形式と[共通評価の画像](../../../fixtures/arm-tracking/preview.png)を生成した。これは幾何の技術見本。実素材と自然さの受け入れはAT-15/16。

CLは*.at08.test.tsで親・接続・手形・旧ArmL/R・合成後の制約を独立確認する。AT-10はこの経路で実装済み。
