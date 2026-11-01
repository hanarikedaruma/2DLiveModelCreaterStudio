# AT-02 分割腕・固定掌面の技術試作

カメラなしの幾何学的な見本。製品コードからは参照しない。キャラクターの画像素材やユーザーの制作プロジェクトは含まない。

- [報告・契約候補](../../../docs/arm-tracking/reports/AT-02-rig.md)
- [操作用見本](../../../docs/arm-tracking/evidence/AT-02/preview.html)：ブラウザでローカルファイルを開く。サーバー・通信不要。
- [16姿勢](../../../docs/arm-tracking/evidence/AT-02/poses.png) / [手振り](../../../docs/arm-tracking/evidence/AT-02/wave.png) / [指さし・顔の前への遷移](../../../docs/arm-tracking/evidence/AT-02/transitions.png)

## 再生成と検証

リポジトリの依存を導入済みのWindowsで、ルートから実行する。既存のfixturesのtsx・canvas、desktopのPlaywrightを使い、依存は追加していない。PNGの文字はWindowsのMeiryoを使用する。

```powershell
node fixtures/node_modules/tsx/dist/cli.mjs prototypes/arm-tracking/rig/generate.ts
node node_modules/typescript/bin/tsc -p prototypes/arm-tracking/rig/tsconfig.json
node node_modules/vitest/vitest.mjs run prototypes/arm-tracking/rig/kinematics.co.test.ts
node node_modules/eslint/bin/eslint.js prototypes/arm-tracking/rig
node node_modules/prettier/bin/prettier.cjs --check prototypes/arm-tracking/rig docs/arm-tracking
node prototypes/arm-tracking/rig/check-preview.mjs
```

最後の操作確認は `.cache/locks/main.lock` を排他的に取得する。別の作業が使用中なら終了する。専用のheadless EdgeでローカルHTMLだけを開き、制作アプリやユーザーのブラウザには接続しない。通常のサンドボックスでブラウザが終了する環境では、このコマンドの実行権限が必要になる。自分が取得したロックだけを終了時に解放する。

生成先は `docs/arm-tracking/evidence/AT-02/`。`manifest.json` に生成元と出力のSHA-256、`preview-check.json` に操作確認時のHTML・確認スクリプトのSHA-256を記録する。生成されたHTML・SVG・JSONは直接編集しない。

## 見るところ

姿勢メニューで肘・手首・合成角度の限界、顔の前、曲がった基準角を比べる。緑はモデルの左、橙は右。各手の親指にある紫の点と掌の線は固定する。手振りを再生し、パー・グー・指さし・ピースを切り替える。手首の白い点をドラッグすると、到達できない目標でも骨長と関節範囲を優先する。

`kinematics.co.test.ts` は実装者COの補助試験。CLの独立確認は別に行い、カードへ記録する。
