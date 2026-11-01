# AT-01 証跡の一覧

[報告](../../reports/AT-01-inference.md) / [カード](../../cards/01-inference-spike.md) / [試作](../../../../prototypes/arm-tracking/inference/README.md)

各フォルダの `run.json` に、環境（`environment`）・ビルドしたファイルと窓のexeのSHA-256（`manifest`）・条件ごとの結果（`results[].summary`）・コンソールの警告とエラー（`errors`）がある。集計の定義は [metrics.ts](../../../../prototypes/arm-tracking/inference/src/metrics.ts) の先頭。実カメラの映像・画面は保存していない。

| フォルダ                                                       | 内容                                                                                                                                                                                                                         | 版         |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| `fake-smoke-2026-10-31T06-17-16-071Z`                          | 仮のカメラの異常系。**修正前**：モジュールWorkerで手の推定器が「ModuleFactory not set.」で作れない記録                                                                                                                       | 初版       |
| `fake-smoke-2026-10-31T06-19-27-987Z`                          | 同上。ModuleFactoryの修正後。計測窓が短く（1秒後から3秒）初回の推定準備に重なる                                                                                                                                              | 中間       |
| `fake-cspall-csp-2026-10-31T06-20-47-769Z`                     | CSPを全応答に付けた比較（WorkerにもCSPが効く）                                                                                                                                                                               | 中間       |
| `fake-perf-2026-10-31T06-21-12-862Z`                           | 仮のカメラ11条件。**修正前**：手15fpsの間引きが撮影間隔の揺れで約11fpsになる、Poseを先に送らない                                                                                                                             | 中間       |
| `fake-guided-2026-10-31T06-30-38-431Z`                         | 案内つき収録の流れの確認（各区間1秒、人物なし）                                                                                                                                                                              | 中間       |
| `fake-perf-2026-10-31T06-31-26-174Z`                           | 仮のカメラ12条件（間引きの修正・Poseを先に送る）。`C-normal.png` は画面の例                                                                                                                                                  | 中間       |
| `fake-cycles-2026-10-31T06-36-05-249Z`                         | 開始と停止10回のメモリ（1 Worker）                                                                                                                                                                                           | 中間       |
| `camera-perf-2026-10-31T07-26-54-872Z`                         | **実カメラ**12条件（eMeet C980 Pro）                                                                                                                                                                                         | 実カメラ版 |
| `camera-workers-2026-10-31T07-32-13-348Z`                      | **実カメラ**、2 Worker・手だけCPU・顔なし等の7条件                                                                                                                                                                           | 実カメラ版 |
| `camera-guided-2026-10-31T07-35-45-231Z`                       | **実カメラ**の案内つき収録・1回目（案内どおり15/19区間）。照合は撮り直し後の方法で解析し直した（`analysis.md`・`analysis.json`）。回帰用の点列は2回目に置き換え、1回目の分は `.cache/arm-tracking/points-v1/` へ移した       | 実カメラ版 |
| `camera-repeat-2026-10-31T07-38-54-219Z`                       | **実カメラ**、1 Workerと2 Workerを交互に3回                                                                                                                                                                                  | 実カメラ版 |
| `fake-2workers-smoke-2026-10-31T07-41-38-790Z`                 | 2 Workerの異常系（計測窓が短い）                                                                                                                                                                                             | 実カメラ版 |
| `fake-2workers-cycles-2026-10-31T07-42-36-131Z`                | 開始と停止10回のメモリ（2 Worker）                                                                                                                                                                                           | 実カメラ版 |
| `fake-smoke-2026-10-31T07-50-39-626Z`                          | 1 Workerの異常系（5秒窓、開始から最初の結果までの時間、生の時刻つき）                                                                                                                                                        | 現在の版   |
| `fake-2workers-smoke-2026-10-31T07-51-58-292Z`                 | 2 Workerの異常系（同上）                                                                                                                                                                                                     | 現在の版   |
| `camera-guided-2026-10-31T09-35-27-242Z`                       | **実カメラ**の案内つき収録・2回目（案内を短く大きくし、鏡像のプレビューを大きくして撮り直し。案内どおり16/19区間）。照合（`analysis.md`・`analysis.json`）と回帰用の点列（`points-*.json`、案内どおりの区間だけ各2秒）       | 現在の版   |
| `fake-netcheck-network-2026-10-31T09-49-18-929Z`               | 外へ出ない設定（存在しないプロキシ・名前解決の失敗）の確認。Workerの `.invalid` への要求がプロキシで止まる（`network.json`）。`run.json` の `browserArgs` にあるNetLogの場所は、後で `.cache/arm-tracking/netlogs/` へ移した | 現在の版   |
| `fake-netlog-guard-network-2026-10-31T09-50-28-103Z`           | NetLog：Workerの見張りあり・CSPはHTMLだけ                                                                                                                                                                                    | 現在の版   |
| `fake-netlog-noguard-csphtml-network-2026-10-31T09-51-47-064Z` | NetLog：見張りなし・CSPはHTMLだけ（製品と同じ）。MediaPipeの送信がネットワークへ出る                                                                                                                                         | 現在の版   |
| `fake-netlog-noguard-cspall-network-2026-10-31T09-53-04-909Z`  | NetLog：見張りなし・CSPは全応答                                                                                                                                                                                              | 現在の版   |
| `co-review/`                                                   | COの独立確認の記録（COが作成）                                                                                                                                                                                               | —          |

「実カメラ版」は、COの途中確認で見つかった開始・停止の不具合と描画時刻の付け方を直す前の版。推定・受け渡し・集計は現在の版と同じで、違いは開始途中の停止の扱いと「撮影→描画」の付け方（修正前は描く前に置き換わった結果にも描画時刻を付けたので、値が長めに出る）。異常系（07:50・07:51）の後に変えたのは、案内つき収録の画面（`index.html`、`main.ts` の案内の表示とやり直し、`scenarios.ts`）・照合（`analyze.ts`・`analyze-cli.ts`・`record.ts`）・実行スクリプトの画面保存の扱いで、推定・受け渡し・集計は変えていない。

## 現在の版（未コミット）のソース

`prototypes/arm-tracking/inference/` からの相対パス。

| ファイル                 | SHA-256                                                            |
| ------------------------ | ------------------------------------------------------------------ |
| `index.html`             | `2c946f6f22f8e48d443848d25dd3c93999eef1ad278ed763264f2d1228c99a68` |
| `vite.config.mjs`        | `da7f906c7f6e4fff959d42b63b4ba18b1902eab363a85a1e791363ef74dd3e5a` |
| `run.mjs`                | `0af38a0164b860a3a6d8206c984d5ef593189d8486f168319ed3147eaaffde97` |
| `tsconfig.json`          | `52425de42e9734b94576b871c5d7b47a7475684064b9b1280d12aa6ca0b7250e` |
| `tsconfig.worker.json`   | `d7d0fb8cbf61c8f2ade7772fe2455d66c98ab28cb77e1dee1cc7dc7cd9879189` |
| `src/main.ts`            | `6bbe2a90652d1581f7d42723fb75d7d4a3b6e6e0ee33c35bea8d7e2e0de59554` |
| `src/worker.ts`          | `49d2de4ceb86632211fe278f3e2bd1d42d7808d17d30b391abec8139a4b083bc` |
| `src/protocol.ts`        | `e56669c43a84d76bd4ac2d2f4cee45ae332f73221d7b21ba19e12f28a8f1738a` |
| `src/queue.ts`           | `9799552868db83b80994780fceaa56ad30cc64a850b8d968bf16a6ac592a892e` |
| `src/metrics.ts`         | `47731f536dc4b1ec03239357346fe4230ff81e0029ea030d1081534bcb2c6186` |
| `src/record.ts`          | `fd25bb354d4eec7670c7fe206691190390545c5348ca49dd47fe817555e9e437` |
| `src/scenarios.ts`       | `4503cb2c7561a3b6636d4359009b9336941d0488238e524ee462db2dbe2cda11` |
| `src/load.ts`            | `5d76bb94f62c1d407cc40a711388143b58ce78f2a0cff2013fbb000762669753` |
| `src/analyze.ts`         | `2f25267554c8a3321f14110e7b3a579b20bb7f8b25f5611bb982f4c65a06ad5c` |
| `src/analyze-cli.ts`     | `6f64a8c4c2bd7189902e6c04f87c86baa96ddcdc53bfdcbec895addf04d6a6e5` |
| `src/metrics.cl.test.ts` | `287e16770d6ad277f6cf4f017d37003a6c36a1e4e0583fed7d18b8608f1eb237` |
| `src/analyze.cl.test.ts` | `48c68986deb3b5f83be466998e041bcd748345e2dd633dbc9829824325f668d2` |
| `host/Cargo.toml`        | `cb1c7376ecdfab15cf519143b759b2f35351b33cbb0290bd2a5d7c5a4541be71` |
| `host/src/main.rs`       | `44fdbc5f41cf9e87a38a7b3363db8253853448d7f5aef3a420039a7098af66c3` |

窓のexe（`.cache/arm-tracking/host-target/release/at01-host.exe`）は `28f814dc65776a108aa7ef50f091885f7804e3df80c66142bc112ccda2eab176`。HEADは `6c3e78c`（試作は未コミット）。

## リポジトリの外に置いたもの

- モデル：`.cache/arm-tracking/models/`（SHA-256は報告）。
- 案内つき収録の全体（点列だけで映像は含まない）：1回目 `.cache/arm-tracking/recordings/at01-guided-2026-10-31T07-35-51-857Z.json`（14.5MB、SHA-256 `e7528b9fc94f33ff68893a031bf25d8321e4c1eedba1042f06945607f98c7393`）、2回目 `.cache/arm-tracking/recordings/at01-guided-2026-10-31T09-35-34-877Z.json`（16.5MB、SHA-256 `e91e21fce8571e87194c74dec16fc09e9c8fac0d3ae0c4c55425dc9faa302564`）。
- NetLogの本体：`.cache/arm-tracking/netlogs/`。
- 仮のカメラの画面：`.cache/arm-tracking/screens/`（1枚約1.2MB のため移動。案内の画面の確認は `screens/fake-ui/`）。
