# AT-01 CO独立確認

2026-11-01 CO。[AT-01カード](../cards/01-inference-spike.md)は**条件付き採用の試作として確認完了**。以下の最終確認以降、以前の指摘・未確認の記述は経過記録として残す。

## 最終確認（2026-11-01）

- CL修正後の独立試験8件はすべて成功。[結果JSON](../evidence/AT-01/co-review/unit-results-fixed.json)。開始途中のstop、顔初期化失敗時のstream解放を確認。main.ts SHA-256 `6bbe2a90652d1581f7d42723fb75d7d4a3b6e6e0ee33c35bea8d7e2e0de59554`。
- 描画時刻もコードで再確認。overlayが有効なとき、実際に描いた最新Pose/手だけにappliedAtを付ける修正を確認した。
- COが修正後の専用WebView2で仮カメラsmokeを再実行。[実行記録・ビルド版](../evidence/AT-01/co-confirm-smoke-2026-10-31T16-36-19-427Z/run.json)。通常、GPU失敗→CPU、手モデル欠損、Worker失敗、転送失敗、CPU指定の6条件が成功。手モデル欠損時はPose継続、Worker失敗時は顔継続、転送失敗後も次の推定へ進む。実カメラは使用していない。
- [COの独立集計スクリプト](../../../prototypes/arm-tracking/inference/verify-co.mjs)で保存した生時刻からfps分母とPose/手の描画遅延p50/p95を再計算。[照合結果](../evidence/AT-01/co-confirm-smoke-2026-10-31T16-36-19-427Z/co-verification.json)。CLの集計関数をimportせず、0.1ms丸め分を許容して全6条件一致。
- 再実行コマンド：`node prototypes/arm-tracking/inference/run.mjs --label co-confirm --fake --suite smoke`。main.lockを排他取得し専用窓だけを終了。既存runner内のowner文字列はCLだが、このlabel=co-confirmの実行者はCO。終了後ロック解放を確認。
- CLの実カメラ報告・左右と手形の点列解析・外部通信のNetLog比較を確認。実カメラ値は表示時刻修正前の版なので、その値で製品性能を合格にしない。SDKの手visibilityは使わず、グー・横の指さしは指の幾何と既成手形を併用する。
- 採用は1 WorkerでPose lite→手、Pose先行通知。AT-04のWorker外部送信防止、AT-14の実モデル・OBS・30fps入力での性能再計測、AT-16の自然さ確認を必須の後続条件として、AT-03を開始してよい。AT-01は性能・自然さの最終受け入れではない。

## 再現した修正事項

1. **開始中の停止が取り消される（優先度：高）**。`start()`のカメラ取得待ち、または`video.play()`待ちの間に`stop()`しても、待ちの解決後に`status().running`がtrueになる。まだ`session`がない段階の停止でも開始世代を無効にし、各await後に取り消しを確認して、取得済みのストリームとvideoを片付ける必要がある。
2. **顔推定器の初期化失敗でカメラを解放しない（優先度：高）**。カメラ取得が成功し顔側だけ失敗すると、`Promise.all`がrejectして取得済みstreamを保持できず、track.stopが呼ばれない。どちらが先に完了・失敗しても、取得した資源を必ず解放する必要がある。video.play失敗も同じ終了処理に含める。

再現は[ライフサイクルの独立試験](../../../prototypes/arm-tracking/inference/src/lifecycle.at01.test.ts)。ブラウザ・実カメラを起動せず、実装の公開start/stopを呼び、非同期の完了順だけをテスト側で制御する。正常開始→停止が成功する対照試験も含む。実装の条件分岐を試験へ写したものではない。

## 実行済み

```powershell
node node_modules/vitest/vitest.mjs run --config prototypes/arm-tracking/inference/vitest.at01.config.mjs
```

初回結果：8件中5成功・3失敗。失敗は上記1の2つの待機箇所、上記2の顔初期化失敗。CLの実装ファイルを直接変更せず、期待値を保った再現試験を渡す。

Worker管理の変更後にも同じ3件が再現した。[試験結果JSON](../evidence/AT-01/co-review/unit-results.json)と[対象版](../evidence/AT-01/co-review/source-version.json)を保存した。main.tsの実行前後SHA-256は一致している（`7f3f0c11c7d51364ca10c41765db8bacd51bcec8f40bf8b0b546694e7d7547ee`）。追加した独立試験と設定のlint、および試作の型検査は成功。

## CLの実行記録の照合

[初回の実カメラ12条件](../evidence/AT-01/camera-perf-2026-10-31T07-26-54-872Z/run.json)を読み、顔・Pose・手のfps×計測秒数と推定件数を全条件で照合した。差は丸め誤差の範囲。保存物は集計値のみなので、生の受取時刻からの分位点の再計算はまだできない。後続計測では数値のtimelineと集計窓も記録すると独立照合できる。

初回の通常案Cでは、入力が約24.9fps、Poseと手が約14.2fps、Poseの表示遅延p95約115.3ms、手は約159.7ms。これは当該計測の記録値であり、安定した代表値の確定ではない。カメラの要求30fpsに対し実入力は各条件で約25fpsで、腕30fpsの目標を通過扱いにはできない。CLは条件間のばらつきと別Worker方式を追加比較中。

[別Worker比較](../evidence/AT-01/camera-workers-2026-10-31T07-32-13-348Z/run.json)のMではPose25.0fps・手24.9fps、Pose表示遅延p95 52.1msだった。ただし[同条件を交互に3回測定した記録](../evidence/AT-01/camera-repeat-2026-10-31T07-38-54-219Z/run.json)のMはPose24.9／25.0／25.0fps、手23.1／24.7／23.8fps、Pose表示遅延p95は111.8／60.5／68.2ms。改善は見られるが、100msを超えた回も含めて判断する必要がある。最良の1回だけを受け入れ値にしない。

[仮カメラの異常系](../evidence/AT-01/fake-smoke-2026-10-31T06-19-27-987Z/run.json)ではGPU失敗時のCPU選択、Worker失敗のunavailable、画像転送エラーの計数を確認した。一方、normalとgesture-failの短い計測窓でPoseの完了fpsが0であり、初期化状態readyだけで推定成功と判断しない。CO自身による同条件再実行は、CLの計測とmain.lockの使用が終わってから行う。

修正依頼はClaudeの同じチャットへキュー送信済み。AT-02の引継ぎと合わせて2件のキュー表示を確認した。CLの確認・修正済みとはまだ記録しない。

[計測・キューの独立試験](../../../prototypes/arm-tracking/inference/src/metrics.at01.test.ts)4件は成功。2秒窓のPose/手の分割投稿、窓の終端・古い結果の除外、未描画を0msにしない扱い、顔完了とカメラ通知の分母、画像の所有権、指方向の縦横比補正を手計算と照合した。

## 続けて確認する項目

- `main.ts`の描画時刻：1回の描画前に同じ部位の複数結果が届くと、表示されるのは最新だけだが、現在は待ち配列の全結果へ同じappliedAtを付ける。撮影→**表示した結果**の遅延を名乗る場合は、実際に描いたPose/手の結果だけに付けるか、指標を「次の描画機会まで」に改名して区別する。overlay無効時も表示したことにしない。
- 実機計測・方式の比較はCLが実行中。仮カメラでの速度を実カメラの性能合格へ流用しない。生時刻・受取数と報告値の再照合、CPU fallback・Worker/転送失敗、左右・遮蔽の点列の確認は継続する。
- CLがページ側のWorker管理を変更中のため、修正後の対象版で再実行してSHA-256を記録する。AT-03の契約確定はこの途中報告では進めない。
