# 腕・手の技術見本（AT-08）

`node fixtures/node_modules/tsx/dist/cli.mjs fixtures/scripts/generate-arm-tracking.ts` で再生成する。キャラクターの素材を加工せず、幾何の帯と左右の色で接続を確認する。

- `project.json`: 直線の基準画像、左右各4種類の手。
- `bent-reference.json`: 肩25・肘65・手首10度の基準画像。
- `no-rig.json`: 腕の保存項目が無い対照。
- `missing-left.json`: 左手の参照が切れた対照。右腕と顔は継続する。
- `preview.png`: 製品のBindingEvaluator→DeformPipelineで描いた見本。

アプリで開く場合は目的のJSONを別の試験フォルダの`project.json`にコピーし、`assets/`も同じフォルダへコピーする。ここは生成物なので、ユーザーの制作モデルを保存しない。
