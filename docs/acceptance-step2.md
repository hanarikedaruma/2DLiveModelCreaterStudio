# STEP2 の受け入れ（カード54）

確認日: 2026-10-04。途中の実装を引き継ぎ、部品の登録と本物のサービスへの接続を行った。
自動テスト・ブラウザで確認した範囲と、実機の確認を分ける。Tauri・OBS・実マイクでの受け入れは未完了。

## 結合内容

- services.ts: animations・periodic・physics・vowels を本実装に差し替えた。AudioSource の波形を20msにまとめ、同じ vowels を lipSync に接続する。構築時にカメラやマイクは開かない。
- 周期アニメーションのシーン設定・アニメーション登録設定を画面に登録した。起動・読み込み時に標準の呼吸を補い、編集中の Undo 履歴は消さない。
- 物理の producer を実行部の最後に入れた。プロジェクトの読み込みイベントで reset する。
- 編集プレビューの補間は、再生側の evaluateAnimationTrack と共通にした。
- 母音パネルを追加した。6形の標準値、個別登録、上書き確認、Undo/Redo に対応する。
- 計測に母音の窓の先頭から最初の描画までの p95 を追加した。JSON は summary.vowelLatency と samples.vowelLatencies を含む。

## 完成条件

| #   | 項目               | 確認した範囲                                                                                                                              | 残る確認                                             |
| --- | ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| 1   | タイムライン       | animation/Timeline.test.tsx。キーの追加・移動・削除・補間・Undo。Edgeでキー作成と再生                                                     | Tauriでの操作感                                      |
| 2   | アニメーション作成 | AnimationListPanel.test.tsx、commands.test.ts。追加・複製・名前・削除                                                                     | 実モデルでの調整                                     |
| 3   | アニメーション登録 | SettingsPanel.test.tsx。設定変更・保存読み直し・Undo                                                                                      | Tauriで保存                                          |
| 4   | ループ             | anim/player.test.ts、animation/state.test.ts。Edgeでループプレビュー                                                                      | 長時間再生                                           |
| 5   | 周期・呼吸         | anim/periodic.test.ts、studio/periodic/periodic.test.tsx。標準呼吸、加算、フェード、シーン・Undo。Edgeで通常再生中も呼吸                  | 実モデルの自然さ                                     |
| 6   | 開始ブレンド       | anim/player.test.ts。+18から0、services.step2.test.tsで表情を重ねた15から-10への中間値2.5                                                 | 実カメラ                                             |
| 7   | 復帰ブレンド       | anim/player.test.ts。最新トラッキング値へ復帰、途中停止                                                                                   | 実カメラ                                             |
| 8   | 割り込み           | anim/player.test.ts。旧・新レイヤー、restart/ignore、保持                                                                                 | 配信中の操作                                         |
| 9   | 影響範囲           | anim/player.test.ts。グループ外は変えず、加算は顔・体の角度                                                                               | 実モデル                                             |
| 10  | 同時合成           | services.step2.test.ts。表情・通常再生・音量・周期・物理の順とflags、services.step1.test.ts                                               | カメラ・マイク・OBS同時使用                          |
| 11  | 複数表情           | expression.step2.test.ts、ExpressionCards.test.tsx。加算・上書き・順序・解除。Edgeで笑顔と照れ                                            | ホットキーの仕様判断はI-043                          |
| 12  | 母音リップシンク   | audio/vowel/probe.test.ts。16/44.1/48kHz・男女の合成5母音、無音。sampler.test.ts・lipsync/vowels.test.ts。VowelPanel.test.tsxの登録・Undo | 実声での精度、実マイクの遅延100ms以下、雑音条件I-045 |
| 13  | 物理・自動キー     | physics/engine.test.ts、modeling/physics/commands.test.ts・sway.test.ts・PhysicsSection.test.tsx。Edgeで前髪を有効にし、揺れプレビュー    | 実モデルの揺れ・根元                                 |
| 14  | 物理プリセット     | PhysicsSection.test.tsx。髪・布・リボン・アクセサリ、強さ変更・Undo                                                                       | 実モデルでの自然さ                                   |
| 15  | 標準パラメータ     | project/step2Params.test.ts、setup/step2.test.ts。呼吸・腕・髪揺れ、手編集・ロックの維持                                                  | 実モデルの呼吸・腕の可動域                           |

## ブラウザ確認

Edge / Playwright、1440×1000・800×600。サンプルモデルを実際にセットアップし、母音6形の登録、前髪の物理設定とプレビュー、顔左右の0秒30・2秒-30のキー作成、ループ再生、スタジオ再生・呼吸・笑顔と照れの同時適用を確認した。ページ例外なし。

幅800pxでプレビューが消える不具合を修正した。狭い中央領域ではプレビューとスライダーを上下に配置し、ツールバーは横スクロール、時間目盛りは両端だけにする。
再実行用: `.cache/step2-browser.mjs`。画像: `.cache/step2-animation-1440.png`・`step2-animation-800.png`・`step2-studio-1440.png`・`step2-studio-800.png`。

## 実機で残る確認

1. モデリングで母音の形を登録し、スタジオでマイクを開始。あ・い・う・え・おと無音を確認する。
2. 計測表示で「母音処理→描画」のp95が100ms以下か確認し、JSONを保存する。この数値は音声窓の先頭から描画までであり、マイク機器・OS入力バッファの遅延は含まない。音声の時計は最初の波形受信時に合わせる。
3. 実カメラで顔を動かしながら、表情2つ・アニメーション・呼吸・物理を重ね、割り込み・解除・シーン切り替えを確認する。
4. 基準PCでOBS 1080p60録画中に `pnpm measure -- studio`。docs/studio-check.md の顔移動・ミラー・遮蔽・クロマキーも再確認する。

## 本物のアプリでの確認（2026-10-05）

- 全体の検査: `pnpm format:check`・`pnpm lint`・`pnpm typecheck`・`pnpm test`（10プロジェクト・1,911件）が通った。
- `pnpm e2e`（VITE_E2E のデバッグビルドで Tauri を再ビルドして本物のアプリを起動）: 10件のうち9件が通り、1件を飛ばした。
  - MVP の5件（モデリングの通し、異常終了の後の復元、顔の推定と外への通信×2、計測の表示）と STEP1 の3件（本物のサービスの動き、Spout2 の送り手がほかのプロセスから見える、マイクの音量が本番の CSP の下で 10ms ごとに届く）が通った。
  - STEP2 の通しのテスト apps/desktop/e2e/step2.e2e.ts が通った: スタジオで実際に描いたフレームのパラメータを読み、シーンで有効にした標準の呼吸で Breath が動く（周期アニメーション）、表情で顔を急に向けると物理の producer が髪揺れ（HairFront）を動かす、アニメーションを再生すると FaceAngleX が −20 へ遷移し、止めると戻る（再生と遷移）ことを確かめた。カメラ・マイクは使わない。
  - STEP1 のグローバルホットキーのテストは、夜の実行では PC がロックされていてキーの入力が届かなかった（ロック中はキーの入力がロック画面に行く）。テストはロック中を見分けて、キーの入力の確認だけを飛ばすようにした。朝、ロックが解除された状態で STEP1・STEP2 の通しのテストを再実行し、5件すべて（OS のキーの入力が届くことを含む）通った。
  - 通しのテストが起動時の新しいプロジェクトの自動保存（unsaved/）を残していたので、STEP1 のテストも自動保存を止めて後片付けするようにした（残っていた空のプロジェクト3つは消した）。
- この確認のため、開発中と通しのテストのときだけ `window.__studio.studio.runtime`（スタジオの実行部）を出すようにした（apps/desktop/src/main.tsx。ふだんの本番のビルドには入らない）。
- 計測（`pnpm measure -- studio`）は、PC がロックされていて描画の速さが正しく測れないので行っていない。

MVP と STEP1 の受け入れの自動の項目は引き続き通る。過去の実機の結果を今回の再確認済みとは扱わない。
