# AT-04 共有カメラ・推定Worker・モデル同梱

2026-11-01 CL。状態：**実装済・COの独立確認待ち**。[カード](../cards/04-capture-worker.md) / [計画](../README.md)。確認の対象は[AT-04 manifest](../evidence/AT-04/manifest.json)（「AT-04 CL v1」、未コミット）。依存はAT-03「CO v1」の観測の契約（`TrackingSource.body`・`BodyTrackingCapability`・`BodyTrackingFrame`）。AT-03のCL指摘（Environmentの腕の校正の保存）はAT-04の範囲外。

## できたこと

`createMediaPipeTrackingSource()` が `body`（CC-032の`BodyTrackingCapability`）を持つ。顔と同じカメラ・同じ映像のフレームから、Pose（肩・肘・手首）と最大2本の手を1つのWorkerで推定し、顔とは独立に通知する。既定は腕OFF（Workerを作らない）。スタジオの画面・設定への接続はAT-12。

| ファイル                                                                                                                                                                                          | 役割                                                                                                                                                    |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [source/body/tracker.ts](../../../packages/tracking/src/source/body/tracker.ts)                                                                                                                   | `BodyTracker`。configure・status・onFrame・onStatus。Workerの起動と停止、待ち（処理中1枚＋最新1枚）、世代・部位ごとの順序・期限（250ms）の検査、完了fps |
| [source/body/workerCore.ts](../../../packages/tracking/src/source/body/workerCore.ts)                                                                                                             | Workerの中身。GPU→CPUの作り直し、Pose→手の順の推定、Poseを先に送る、軽量の手15fps、各フレームの最後に `done`、画像の解放                                |
| [source/body/worker.ts](../../../packages/tracking/src/source/body/worker.ts)                                                                                                                     | Workerの入口。外部通信の見張りを最初に入れ、MediaPipeの推定器を作る（`ModuleFactory` の入れ直し）                                                       |
| [source/body/guard.ts](../../../packages/tracking/src/source/body/guard.ts)                                                                                                                       | Worker内でページの外へのfetch・XHRを止めて知らせる                                                                                                      |
| [source/body/assets.ts](../../../packages/tracking/src/source/body/assets.ts)                                                                                                                     | 同梱ファイルのURL、blobのURLで包んだモジュールWorkerの作成                                                                                              |
| [source/body/protocol.ts](../../../packages/tracking/src/source/body/protocol.ts)                                                                                                                 | ページとWorkerのメッセージ（公開しない）                                                                                                                |
| [source/source.ts](../../../packages/tracking/src/source/source.ts)・[camera.ts](../../../packages/tracking/src/source/camera.ts)・[capture.ts](../../../packages/tracking/src/source/capture.ts) | 推定元への接続（カメラの開始で接続、停止で解放、各フレームで顔より先に腕へ渡す）、`captureTime` の受け渡し、腕・手を使う間は自動選択で320×240を試さない |
| [assets/](../../../packages/tracking/assets/MODELS.md)                                                                                                                                            | `pose_landmarker_lite.task`・`gesture_recognizer.task`（float16/1）と来歴・SHA-256・利用条件                                                            |

`apps/desktop/vite.config.ts` は変えていない（`worker.format: 'es'` が既にある）。依存（package.json・pnpm-lock.yaml）も変えていない。

## 決めたこと

- **1つのWorker、Pose→手**（AT-01の推奨）。Poseの結果を手の推定の前に送り、各フレームの最後に `done` を送ってページの流量を決める。Pose・手は別の通知（`pose` だけ／`hands` だけ）になり、同じframeIdでも捨てない。
- **待ち**：Workerに渡して `done` を待つのは1枚、処理中に届いたフレームは最新の1枚だけを持ち、置き換えた画像は `close()` して `droppedFrames` に数える。Poseは撮影時刻で30fpsを目安に渡す（撮影間隔の揺れを3/4まで許す）。軽量は手を撮影時刻で15fpsに間引く。
- **時刻**：`captureTime`（WebView2のカメラで入る）を撮影時刻にし、無ければ通知の時刻（`captureSource: 'callback'`）。Workerは `timeOrigin` の差を足して完了時刻をページの時計にする。受け取った時刻は `receivedAt`。
- **捨てる結果**：世代違い・部位ごとの撮影時刻の逆転・撮影から250ms（`ARM_TIMING.resultMaxAgeMs`）を超えたものは届けずに `staleResults` に数える。推定の例外は「その部位の更新なし」（ロストにしない）。
- **世代**：設定の変更・カメラの開始と停止で増やす。腕のON/OFF・手のON/OFFは推定器の組を作り直し（Workerを終わらせて資源を手放す）、軽量⇔通常は手の間隔だけを変える。
- **失敗**：推定器ごとにGPU→CPUで作り直し、理由を `reason` に残す。Workerを作れない・読めない・どちらの推定器も作れないときは `unavailable` にしてWorkerを終わらせる。顔は続ける。重い推定をメインスレッドへ移さない。
- **外部通信**：Workerを **blobのURLで包んで作る**。blobのWorkerは作ったページのCSPを引き継ぐので、TauriがCSPをHTMLの応答にだけ付けても、Worker内のMediaPipeの送信がCSPで止まる。さらにWorker内の見張りでfetch・XHRを止める（二重）。Tauri（src-tauri）は変えていない。
- **解像度の自動選択**：腕・手を使う間は320×240を試さない（手が小さくなりすぎる）。640×480と1280×720を比べる。手の見える大きさの実測による選択はAT-14。

## 確認（実装者CL）

| 確認                               | 結果                                                                                                                                |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| 補助試験                           | `packages/tracking/src/source/body/*.test.ts` 28件（見張り3・Worker中身7・ページ側12・結合4・自動選択2）成功。tracking全体182件成功 |
| 型・lint・整形                     | tracking・desktopの型、trackingと確認ページのlint・整形が成功                                                                       |
| 本番のビルド                       | desktopをViteで `.cache` へ組み立て、Worker・2つのモデル・モジュール版WASMが同梱されることを確認                                    |
| 実WebView2（仮のカメラ、人物なし） | [証跡](../evidence/AT-04/fake-2026-10-31T17-09-05-361Z/run.json)。下の表                                                            |

AT-01の試作専用の窓（CSPは製品と同じくHTMLの応答だけ）で、製品の `createMediaPipeTrackingSource` をそのまま動かした（[確認ページ](../../../prototypes/arm-tracking/at04-check/)）。仮のカメラ30fps、PCの外へ出ない設定（存在しないプロキシ・名前解決の失敗）、NetLogを `.cache` に保存。main.lockを取り、その窓だけを開閉した。

| 手順                                 | 結果                                                                                                                                                                                                                                                                                             |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 通常で開始                           | 推定器はPose・手ともGPU。開始から準備まで0.99秒（2回目以降のカメラの止め直しでは0.56〜0.58秒）                                                                                                                                                                                                   |
| 通常（準備の後5秒）                  | 顔30・Pose30・手30（件/秒）、完了fps 30/30                                                                                                                                                                                                                                                       |
| 軽量                                 | 顔30・Pose30・手15、完了fps 30/15。推定器は作り直さない                                                                                                                                                                                                                                          |
| 腕OFF                                | Workerは0、顔は30件/秒で続く                                                                                                                                                                                                                                                                     |
| 腕のON/OFF 5回、カメラの止め直し 5回 | 毎回Workerは0か1で増えない。WebView2のprivateメモリは腕OFFで709〜739MB、ON（カメラの止め直し）で926〜931MBで増え続けない                                                                                                                                                                         |
| 外部通信                             | 推定器を閉じるときのMediaPipeの送信の試み22件をWorker内で止めた。NetLogに `odml.pa.googleapis.com` は無い。ページに関係ないWebView2ランタイム自身の `edge.microsoft.com`（コンポーネント更新）と `config.edge.skype.com`（Edgeの設定配信）は出た（プロキシで止まった。[I-092](../../issues.md)） |

blobで包む方式は、AT-01の試作でも確かめた：HTMLだけにCSPを付けた条件で、blobのWorkerは送り先の無い `127.0.0.1:9` への通信がCSP違反になり（[記録](../evidence/AT-01/fake-blob-csp-blob-2026-10-31T16-55-58-415Z/run.json)）、見張りを外してもNetLogにMediaPipeの送信が出ない（[記録](../evidence/AT-01/fake-netlog-noguard-blob-network-2026-10-31T16-56-30-027Z/network.json)）。

## 未確認・制約

- 実カメラ（人物あり）とOBS同時の性能はAT-14。今回は仮のカメラで、推定は人物の無い画像。
- 製品のアプリ（Tauri）の窓での実行は、AT-12で画面に接続してから。今回はAT-01の試作専用の窓（同じwry・WebView2・同じCSPの値）。
- 起動直後の初回の推定（GPUの準備）の間は、待ちの置き換えと期限切れの結果が出る（通常で開始直後の5秒に置き換え19件・期限切れ2件）。
- `blockedRequests()` は診断・試験用でCC-032の `status` には無い。画面で外部通信を示すならAT-03の契約の追加が要る。
- WebView2ランタイム自身の通信（I-092）は製品の窓で未確認。

## COへ依頼する独立確認

`*.at04.test.ts` で、二重カメラなし、待ちの上限、置き換え・停止時の `close`、世代の切替、古い結果の不採用、顔と腕の独立を仮の推定器で確かめる。実WebView2で同梱モデルのGPU/CPUの経路と外部通信を確かめる（[確認ページ](../../../prototypes/arm-tracking/at04-check/run.mjs)はmain.lockを取って `node prototypes/arm-tracking/at04-check/run.mjs`）。
