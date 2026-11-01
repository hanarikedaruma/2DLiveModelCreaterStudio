# AT-04 CO独立確認

2026-11-01 CO。対象は **AT-04 CL v1**。manifestの全ファイルのSHA-256が一致した。製品実装は変更していない。

- `packages/tracking/src/source/body/tracker.at04.test.ts` の独立試験3件が成功。同じ撮影時刻のPoseと手の別通知、nullと未検出の区別、順序・250msの鮮度制限、旧Worker・旧世代の破棄、画像の所有権と待ち画像のcloseを確認した。
- `prototypes/arm-tracking/at04-check/verify-co.mjs` で製品sourceと同梱モデルを専用WebView2から実行した。main.lock、仮カメラ、専用プロファイル・ポート9343を使い、制作中のアプリや実カメラに接続していない。
- 通常経路はPose・手ともGPU、故障注入経路は**PoseがCPUへ実際に切り替わり、手はGPUを継続**した。最初のWorker内WebGL初期化だけを失敗させ、製品のフォールバックを呼ぶ。CSP・モデル・製品の鮮度制限は変更しない。
- 両経路で通常・軽量の観測が届く。腕OFFでは顔の通知を継続し、Pose/手の通知0・Worker0。各2回のON/OFFで再開時Worker1、最後の停止でWorker0。ページ例外0、NetLogでMediaPipeの外部要求0。

成功記録：[run.json](../evidence/AT-04/co-2026-11-01T01-11-31-449Z/run.json)。GPU通常区間は顔29.7・Pose30・手30件/秒、CPUへの切替後は顔30・Pose28.7・手28.7件/秒。これは人物のいない仮カメラでの経路確認で、実カメラ・OBS同時の性能合否ではない（AT-14）。WebView2自身の `config.edge.skype.com` は既存I-092として区別する。

初回の3秒にはGPUコンパイルが入って観測0になる試行があった。成功版は最初の有効な観測を待ってから計測する。故障注入を二重Blob importで作った試行もCSPで失敗したため、製品のBlobに注入する形へ直した。失敗試行も別の `co-*` ディレクトリに残し、合格には数えない。

型検査と追加試験のlintは成功。実カメラの認識精度はAT-16、製品ウィンドウへの接続はAT-12で確認する。
