# カード69 Spout2 の復帰と GPU の選択

| 段              | 担当 | 依存 | 契約 | 実機                           | テスト |
| --------------- | ---- | ---- | ---- | ------------------------------ | ------ |
| 1（部品・並行） | CO   | 65   | —    | ○（OBS。確かめるのはカード72） | CL     |

課題: I-031・I-032。完成条件: S2。

## 目的

GPU のデバイスが失われても Spout2 の出力が自動で戻るようにし、GPU が2つある PC で出力に使う GPU を選べるようにする。新しい出力の方式は作らない。

## 前提

- Spout2 の送り手: `apps/desktop/src-tauri/src/output/`（d3d11.rs・worker.rs）。描画のエラーは1回出力するだけで、デバイスを作り直さない。デバイスは既定のアダプターで作る。
- 設定の画面: `apps/desktop/src/output/spout/OutputMethodSection.tsx`。
- カード65 の Environment.output の GPU の項目。
- 既存のテスト: `src-tauri/src/output/` の `cargo test`（gpu_tests.rs を含む）、`apps/desktop/src/output/` のテスト、e2e の `step1.e2e.ts`（Spout2 の送り手がほかのプロセスから見える）、UC-28。

## 作るもの・直すもの

1. **デバイスの消失からの復帰（I-031）**: デバイスの消失・リセットを見つけたら、デバイスと共有のテクスチャを作り直して送信を続ける。続けて失敗するなら間を空けて試し、画面に状態を出す。
2. **GPU の選択（I-032）**: アダプターの一覧を返す Tauri のコマンド。設定の画面で選び、Environment に保存する。選んだ GPU が無ければ既定に戻して知らせる。OBS と同じ GPU にする案内を出す。
3. **長時間の動作**: 送信の fps・失敗の回数を、既存の計測（`pnpm measure`）で記録できるようにする（カード72 の2時間の確認で使う）。

## 触ってよいもの

- `apps/desktop/src-tauri/src/output/`、`apps/desktop/src-tauri/src/lib.rs`（コマンドの登録の行だけ）
- `apps/desktop/src/output/`
- `apps/desktop/e2e/studio.measure.ts`（送信の記録を足す部分だけ）

## 触らないもの

- 出力ウィンドウの方式（今のまま）。

## テスト（担当: CL）

このカードのテストは、実装の担当（CO）ではなく CL が書く（README の「テストの分担」）。テストのファイルは名前にカードの番号（`.c69.`）を入れ、実装の担当は書き換えない。

- Rust（`apps/desktop/src-tauri/src/output/` に `c69` の名前のテストのモジュール）: デバイスの消失（失敗の差し込み）から作り直して送信が続く。続けて失敗するときに間を空けて試す。
- `apps/desktop/src/output/spout/OutputMethodSection.c69.test.tsx`: アダプターの一覧と選択の保存・復元。無い GPU は既定に戻して知らせる。
- CH: UC-28 に、GPU の選択と復帰を足す。

## 完了条件

- [ ] デバイスの消失を起こすテスト（または失敗の差し込み）で、送信が自動で戻る（`cargo test`）
- [ ] アダプターの一覧と選択が保存・復元され、無い GPU は既定に戻る
- [ ] e2e の Spout2 の確認が引き続き通る
- [ ] 実機（OBS での受信・2時間）はカード72 で確かめる

## 締めるときに書くもの

- docs/issues.md の I-031・I-032 に、実装と自動テストの結果（対応済みはカード72 の実機の後）。

## 記録

### CO 実装（2026-10-07）

- DXGI の実アダプターを LUID で選び、実際に使った GPU を返す。設定を保存・復元し、無い GPU は既定へ戻して画面で知らせる。
- GetDeviceRemovedReason と描画・共有の失敗を検出し、送信者→共有テクスチャ→デバイスの順に破棄して作り直す。100ms から最大5秒の待ち時間、同じ送信名、最新の素材の再送を維持する。素材の保持は圧縮データで行う。
- 復旧中の表示と実送信数・失敗数・復旧数を追加。既存 studio.measure.ts が Rust の実送信数から送信 fps を記録する。状態取得の失敗からの手動再試行も再起動する。
- 自分の回帰テストは追加前に configureAdapter 不在と状態取得後の再試行で失敗を確認。実装後に出力の38件、Rust の27件（GPU 選択・共有受信と復旧の差し込みを含む）が通った。Rust の性能専用1件は従来どおり ignored。
- CL 用公開口: `listSpoutAdapters()`、`SpoutSink.configureAdapter(id|null)` / `telemetry()`。Rust `output::recovery::{Backend,RecoveringOutput}` は時刻と factory を差し込める。`render` の true だけを送信に数え、共有 mutex が使用中なら false。`status()` は state/message/sentFrames/failures/recoveries/sendFps を返す。
- 残り: CL の独立テスト・テスト確認と CH、Edge の2サイズ、全体チェック、Native e2e。OBS の実受信はカード72。2時間の連続動作は今回対象外。
