# 胸揺れの見本と比較（2026-10-09 CO）

方式Aは製品の分割パーツ用の変形。方式Bは比較用の試作だけで、製品の物理設定には入れない。

- [傾いた静止姿勢](gravity-comparison.png): 上から物理なし・A・B、左から−90°・−45°・0°・45°・90°。重力の矢印はモデル座標の下向き。白い点は体に固定する頂点。正面には追加の垂れを重ねず、傾いた姿勢は保存した基準との釣り合いを反映する。
- [左右・上下の端と斜め](keys-comparison.png): 同じモデルのBustX/BustYを±1へ動かした完成形。AとBで同じ固定点を保つ。
- [慣性の波形](dynamics.png): 体を30°傾け、横へ4px動かして止める。同じsmoothstep入力で30・60・120fpsを比較。正規化出力が以後ずっと釣り合いの±0.02以内になるまで、停止後約1.57秒。係数はspring 120・damping 5・inertia 1.5・strength 0.5・重力0.3。
- [数値](measurements.json): 面積と波形の最大値・収束時間。自然さの合格判定や3Dの体積の保証としては扱わない。

Bの補助場は`w * alpha * (基礎頂点 - 中心)`。alphaを−0.12..0.12で探し、各三角形の符号と元の10%以上の面積を保ちながら、メッシュ全体の面積との差を小さくする。つなぎ目はA同様に固定する。局所面積や見た目の改善は別の確認が必要で、採用はユーザーの比較後に決める。

見本は[fixtures/chest-model/project.json](../../../fixtures/chest-model/project.json)。衣服で覆った胴体・胸・腕だけの小さなモデルで、胸は胴体の子にして呼吸の変換も継承する。再生用のアニメーションを1つ含む。

再生成:

```powershell
pnpm --filter @app/fixtures exec tsx scripts/generate-chest-model.ts
pnpm --filter @app/fixtures exec tsx scripts/chest-evidence.ts
```

## 残す目視確認

- 制作モデルでの揺れ方・つなぎ目・自然さ（カード97）。
- Aのまま使うか、Bの補助を製品へ入れるか。
- 体の画像へ範囲を指定するモードは今回の対象外。分割パーツの胸は実装する。
