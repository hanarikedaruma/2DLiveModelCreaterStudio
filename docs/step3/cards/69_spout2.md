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

### CL テストの担当（2026-10-07）

- `apps/desktop/src-tauri/src/output/recovery_c69.rs`（10件。`output/mod.rs` に `#[cfg(all(test, windows))] mod recovery_c69;` の2行を足した）と `apps/desktop/src/output/spout/OutputMethodSection.c69.test.tsx`（6件）を足した。`cargo test` 37件（1件は従来の計測用で ignored）と出力の vitest 44件が通る。
  - Rust: 偽の Backend で、デバイスの消失を 33ms に見つけるとそのフレームは送らず古いデバイスを捨て、100ms 後（133ms）に作り直して最新の素材を同じ画素で送り直し、送信が続く。描画・共有の失敗、素材の転送の失敗でも同じ。続けて失敗すると待ちが 100ms から倍になり 5 秒で止まって試し続け、成功のあとは 100ms に戻る。復旧を待つ間の素材の差し替え・削除・追加を反映する。作り直したデバイスへ素材を送れなければそれも捨てる。古い送り手を消してから作るので同じ名前で登録し直す。受け手が読んでいたフレームは送信にも失敗にも数えない。状態の名前は画面と計測が読む形。本物の D3D11 でも、作り直した共有テクスチャから最新の絵が読める（Spout の送り手は作らない）。
  - 画面: 一覧は「既定のGPU」の後に並び、案内が出る。選んだ GPU を environment.json に保存し、開き直すと同じ GPU で始める。保存した GPU が一覧に無ければ既定に戻して保存し知らせる。Rust 側が見つけられず既定で始めたときも同じ。一覧を読めないときは保存した GPU を消さずに理由を出す。
- **実装の担当（CO）へ修正の検討の依頼**: GPU の識別子が DXGI の LUID（`d3d11.rs` の `adapter_id`）で、LUID は Windows の再起動までしか同じであることが保証されない。PC を再起動すると保存した GPU が一覧に無いとみなされ、既定に戻して null で上書きする見込み（完了条件2の「保存・復元」が、アプリの開き直しでは通るが PC の再起動では通らない）。ベンダー・デバイス・サブシステムの ID と名前などの再起動しても変わらない値で保存し、起動時に LUID へ対応付けるのがよいと考える。あわせて、一時的に GPU が見えないとき（外付けの GPU を外した・ドライバの更新中）に選択を null で上書きしてしまうこと、Rust が既定に戻した知らせが状態の取得（1秒ごと）まで遅れること（`spout_start` の結果の adapterFallback を使っていない）も見てほしい。
- テスト確認はまだ書かない: 上の識別子の扱いの判断、ネイティブの e2e（Spout2 の確認）、CH・UC-CH のあと。復旧中は送り手が Spout の一覧から 100ms 以上消えるので、OBS の受け方はカード72 の実機で見る。

### CO 追加の修正・確認（2026-10-07）

- CLの指摘に対応し、保存するGPUの識別子をVendorId・DeviceId・SubSysId・Revision・名前から作る形式へ変更した。[LUIDの一意性は再起動まで](https://learn.microsoft.com/en-us/windows/win32/api/d3d12/nf-d3d12-id3d12device-getadapterluid)なので、保存の識別子とその起動中の識別子を分ける。旧LUIDで保存した設定も、同じ起動中に一覧にあればそのGPUの新しい識別子へ移す。Native側も旧LUIDを受け付け、移行中に既定のGPUへ切り替わらない。
- 自分の回帰テストは修正前に、LUIDだけ変わった同じGPUの復元と異なるハードウェアの識別のRust2件、旧LUID設定がnullになってしまう画面の1件で失敗を確認した。修正後の出力45件（CLの独立6件を含む）とRust39件（従来の性能専用1件はignored）は成功。
- GPUが一覧に存在しない場合は、カードの計画どおり既定へ戻してnullを保存し、知らせる。Rustが既定へ戻した状態は既存の毎秒の状態取得で通知する。Windows自体の再起動は実施していない。同じハードウェア情報と名前のGPUを複数装着した場合の個体の識別は、この形式では保証できない。
- 追加の修正前のNative確認: NVIDIA RTX4050とAMD Radeon680Mの両方を選び、実際のGPU識別子と送信フレームの増加、各約6秒の送信で失敗0・復旧0を確認した。GPU不在の通知と既定への戻し、1440×1000・800×600の画面も確認。外部プロセスのSpout共有受信はRustの実GPUテストと既存Native e2eで確認した。OBSの実受信はカード72の実機待ち。
