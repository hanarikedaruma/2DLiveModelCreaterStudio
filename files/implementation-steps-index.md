# 実装手順（2D Liver モデリング・トラッキングツール）

設計書（第2版）を、番号順に実装すれば完成するカードに分けたもの。1枚のカードが1つの作業単位で、そのカードだけを読めば実装できる。

## 使い方

- 作業のたびに、そのカード1枚だけを読み込ませる（AIに渡す場合も同じ）。ほかのカードや設計書は読ませなくてよい。
- 番号の小さい順に進める。段階の境目では、前の段階のカードがすべて終わっていること。
- 同じ段階のカードは互いに依存せず、触るフォルダも重ならない。分担して並行に作れる。
- カードの「前提」に書いた型・関数・差し込み口は、その時点で必ずある。名前と形を変えないこと。
- 形を変える必要が出たときは、契約のカード（02・03・05、26、45）を直し、同じ型を「前提」に載せているカードも同じように直す。

## 段階の考え方

- 契約（02・03・05・26・45）: 型とインターフェースと仮実装を先に決める。これで部品のカードが互いを待たずに作れる。
- 部品（M1・S1・S2・T1）: 契約だけに依存して作る。ほかの部品は仮実装のまま動かして確かめる。
- 結合（M2・S3・T2）: 仮実装を本物に差し替え、完成条件を確かめる。

## 技術の前提

| 項目 | 採用 |
| --- | --- |
| デスクトップ | Tauri 2（Windows 10 / 11 を優先） |
| 画面 | React + TypeScript + Vite |
| 描画 | WebGL2（乗算済みアルファ） |
| 顔の推定 | MediaPipe Face Landmarker（PCの中で実行） |
| PSD の読み込み | ag-psd |
| テスト | Vitest、Playwright |
| Spout2 出力 | Rust（wgpu）と Spout2 SDK |

## 階層


### MVP


#### M0 基盤

直列。前の番号のカードが終わってから始める。

| 番号 | カード | 担当の目安 | ファイル |
| --- | --- | --- | --- |
| 01 | リポジトリと開発環境 | 基盤 | `1_MVP/M0_foundation/01_repo-setup.md` |
| 02 | データスキーマ（型・検証・既定値・規則） | 基盤 | `1_MVP/M0_foundation/02_schema.md` |
| 03 | 実行時の契約と仮実装 | 基盤 | `1_MVP/M0_foundation/03_contracts.md` |
| 04 | ストアとコマンド（Undo / Redo） | 基盤 | `1_MVP/M0_foundation/04_store.md` |
| 05 | アプリの枠（モード・パネル・差し込み口） | 基盤 | `1_MVP/M0_foundation/05_app-shell.md` |

#### M1 部品

同じ段階の 06〜22 と並行して作れる（触るフォルダは重ならない）。

| 番号 | カード | 担当の目安 | ファイル |
| --- | --- | --- | --- |
| 06 | バインディングの評価 | コア | `1_MVP/M1_parts/06_binding-eval.md` |
| 07 | 変形パイプライン | コア | `1_MVP/M1_parts/07_deform-pipeline.md` |
| 08 | 中間キーの生成（線形・奥行き） | コア | `1_MVP/M1_parts/08_key-generation.md` |
| 09 | パラメータの合成（ミキサー） | コア | `1_MVP/M1_parts/09_mixer.md` |
| 10 | メッシュの自動生成 | コア | `1_MVP/M1_parts/10_mesh-generator.md` |
| 11 | かんたんセットアップ（たたき台の生成） | コア | `1_MVP/M1_parts/11_auto-setup.md` |
| 12 | WebGL2レンダラー（マスク・背景を含む） | 描画 | `1_MVP/M1_parts/12_renderer.md` |
| 13 | PNG・PSDの取り込み | 入出力 | `1_MVP/M1_parts/13_importer.md` |
| 14 | 保存・読み込み・自動保存 | 入出力 | `1_MVP/M1_parts/14_project-io.md` |
| 15 | カメラと顔の推定 | トラッキング | `1_MVP/M1_parts/15_face-tracking.md` |
| 16 | マッピング・スムージング・外れたときの復帰 | トラッキング | `1_MVP/M1_parts/16_tracking-layer.md` |
| 17 | 素材トレイと標準パーツの割り当て | 画面 | `1_MVP/M1_parts/17_assets-assign.md` |
| 18 | キャンバス編集（選択・変形・ピボット） | 画面 | `1_MVP/M1_parts/18_canvas-edit.md` |
| 19 | パラメータパネルとキー編集 | 画面 | `1_MVP/M1_parts/19_parameter-panel.md` |
| 20 | パーツ構造・描画順・マスクの設定 | 画面 | `1_MVP/M1_parts/20_structure.md` |
| 21 | メッシュ編集 | 画面 | `1_MVP/M1_parts/21_mesh-edit.md` |
| 22 | スタジオ画面と出力ウィンドウ | 画面 | `1_MVP/M1_parts/22_studio.md` |

#### M2 結合

直列。

| 番号 | カード | 担当の目安 | ファイル |
| --- | --- | --- | --- |
| 23 | モデリングの結合 | 結合 | `1_MVP/M2_integration/23_integrate-modeling.md` |
| 24 | スタジオの結合 | 結合 | `1_MVP/M2_integration/24_integrate-studio.md` |
| 25 | 計測とMVPの受け入れ | 結合 | `1_MVP/M2_integration/25_mvp-acceptance.md` |

### STEP1


#### S0 契約の拡張

直列。

| 番号 | カード | 担当の目安 | ファイル |
| --- | --- | --- | --- |
| 26 | STEP1の契約の拡張 | 基盤 | `2_STEP1/S0_contracts/26_contracts-step1.md` |

#### S1 部品

同じ段階の 27〜41 と並行して作れる（触るフォルダは重ならない）。

| 番号 | カード | 担当の目安 | ファイル |
| --- | --- | --- | --- |
| 27 | かんたん/詳細の切り替え | 画面 | `2_STEP1/S1_parts/27_ui-level.md` |
| 28 | メッシュの密度と変形の転写 | コア | `2_STEP1/S1_parts/28_mesh-transfer.md` |
| 29 | ワープ | コア | `2_STEP1/S1_parts/29_warp.md` |
| 30 | 2Dパラメータと組み合わせキー | 画面 | `2_STEP1/S1_parts/30_params-2d.md` |
| 31 | 生成方式の追加と、中間キーの編集・ロック・再補間 | コア | `2_STEP1/S1_parts/31_generation-more.md` |
| 32 | 合成モードとPSDの合成・クリッピング | 描画 | `2_STEP1/S1_parts/32_blend-modes.md` |
| 33 | 反転マスクと複数のマスク元 | 画面 | `2_STEP1/S1_parts/33_masks-more.md` |
| 34 | 不透明度のキー・標準パラメータの追加・ユーザー定義パラメータ | 画面 | `2_STEP1/S1_parts/34_params-more.md` |
| 35 | キャリブレーション・トラッキング簡易設定・追加の入力 | トラッキング | `2_STEP1/S1_parts/35_calibration.md` |
| 36 | 自動まばたきと体の追従 | コア | `2_STEP1/S1_parts/36_auto-motion.md` |
| 37 | 音量のリップシンク | 入出力 | `2_STEP1/S1_parts/37_lipsync-volume.md` |
| 38 | 表情 | コア | `2_STEP1/S1_parts/38_expressions.md` |
| 39 | シーンと背景プリセット | 画面 | `2_STEP1/S1_parts/39_scenes.md` |
| 40 | グローバルホットキー | 入出力 | `2_STEP1/S1_parts/40_hotkeys.md` |
| 41 | Spout2出力 | ネイティブ | `2_STEP1/S1_parts/41_spout2.md` |

#### S2 部品

42 と 43 は並行して作れる。

| 番号 | カード | 担当の目安 | ファイル |
| --- | --- | --- | --- |
| 42 | かんたんセットアップの拡張 | コア | `2_STEP1/S2_parts/42_auto-setup-step1.md` |
| 43 | PSDの再読み込み | 入出力 | `2_STEP1/S2_parts/43_psd-reload.md` |

#### S3 結合

直列。

| 番号 | カード | 担当の目安 | ファイル |
| --- | --- | --- | --- |
| 44 | STEP1の結合と受け入れ | 結合 | `2_STEP1/S3_integration/44_step1-acceptance.md` |

### STEP2


#### T0 契約の拡張

直列。

| 番号 | カード | 担当の目安 | ファイル |
| --- | --- | --- | --- |
| 45 | STEP2の契約の拡張 | 基盤 | `3_STEP2/T0_contracts/45_contracts-step2.md` |

#### T1 部品

同じ段階の 46〜53 と並行して作れる（触るフォルダは重ならない）。

| 番号 | カード | 担当の目安 | ファイル |
| --- | --- | --- | --- |
| 46 | アニメーション画面（タイムライン・登録） | 画面 | `3_STEP2/T1_parts/46_animation-editor.md` |
| 47 | アニメーションの再生と遷移 | コア | `3_STEP2/T1_parts/47_animation-player.md` |
| 48 | 周期アニメーション | コア | `3_STEP2/T1_parts/48_periodic.md` |
| 49 | 物理演算 | コア | `3_STEP2/T1_parts/49_physics-engine.md` |
| 50 | 物理のかんたんUIと揺れの自動作成 | 画面 | `3_STEP2/T1_parts/50_physics-ui.md` |
| 51 | 母音のリップシンク | 入出力 | `3_STEP2/T1_parts/51_lipsync-vowels.md` |
| 52 | 表情の同時適用 | コア | `3_STEP2/T1_parts/52_expressions-stack.md` |
| 53 | 呼吸・腕の標準パラメータと自動セットアップ | コア | `3_STEP2/T1_parts/53_auto-setup-step2.md` |

#### T2 結合

直列。

| 番号 | カード | 担当の目安 | ファイル |
| --- | --- | --- | --- |
| 54 | STEP2の結合と受け入れ | 結合 | `3_STEP2/T2_integration/54_step2-acceptance.md` |
