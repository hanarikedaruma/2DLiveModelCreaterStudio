# 同梱する推定モデル

アプリに同梱し、実行時にネットワークへ取りに行かない。配布元は Google の MediaPipe の公式（`https://storage.googleapis.com/mediapipe-models/`）。版を固定し、更新するときはこの表と SHA-256 を直す。

| ファイル                    | 配布元のパス                                       | 大きさ    | SHA-256                                                            | 使う所                |
| --------------------------- | -------------------------------------------------- | --------- | ------------------------------------------------------------------ | --------------------- |
| `face_landmarker.task`      | `face_landmarker/face_landmarker/float16/1/`       | 3,758,596 | `64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff` | 顔（カード15）        |
| `pose_landmarker_lite.task` | `pose_landmarker/pose_landmarker_lite/float16/1/`  | 5,777,746 | `59929e1d1ee95287735ddd833b19cf4ac46d29bc7afddbbf6753c459690d574a` | 肩・肘・手首（AT-04） |
| `gesture_recognizer.task`   | `gesture_recognizer/gesture_recognizer/float16/1/` | 8,373,440 | `97952348cf6a6a4915c2ea1496b4b37ebabc50cbbf80571435643c455f2b0482` | 手の点と手形（AT-04） |

- 腕・手の2つは 2026-10-31 にユーザーの了承を得て取得した。MD5 は配布元の `x-goog-hash` と一致。
- 利用条件：Pose のモデルカード（BlazePose GHUM 3D）と、手の点のモデルカード（Hand Tracking Lite/Full、2021年10月）は Apache License 2.0。手形の分類のモデルカード（2022年）には利用条件の記載がない。2026-10-31 にユーザーが「同梱する」と決めた（[AT-01 の報告](../../../docs/arm-tracking/reports/AT-01-inference.md)）。
- WASM は `@mediapipe/tasks-vision` 1.0.1（Apache-2.0）の `wasm/` をそのまま使う。顔はメインスレッドで `vision_wasm_internal`、腕・手はモジュール Worker で `vision_wasm_module_internal` を使う。
- MediaPipe は利用状況を `odml.pa.googleapis.com` へ送ろうとする。顔はページの CSP で、腕・手は Worker を blob の URL で包んで CSP を引き継がせることと、Worker 内の見張りで止める（[source/body/](../src/source/body/)）。
