# 検証環境の記録

調べた日: 2026-10-02（S1・カード01）

## この PC

| 項目   | 結果                                                              |
| ------ | ----------------------------------------------------------------- |
| OS     | Windows 11 Home（64bit）                                          |
| CPU    | AMD Ryzen 7 7735HS（8コア16スレッド）                             |
| GPU    | NVIDIA GeForce RTX 4050 Laptop GPU と AMD Radeon 680M（内蔵）     |
| メモリ | 15.2 GB                                                           |
| カメラ | HD Webcam（認識あり）                                             |
| マイク | Microphone Array（AMD）、Razer Seiren Mini、Sound Blaster Play! 3 |
| OBS    | あり（`C:\Program Files\obs-studio`）                             |

基準PC（カード25: 6コア12スレッド級、RTX 3060級、16GB）とは同じではない。GPU は 3060 より下、メモリはわずかに少ない。この PC で計測した値は参考値として扱い、基準PCでの結果の代わりにはしない。

## 道具

| 道具                           | 状態                                                                 | 影響                                                                           |
| ------------------------------ | -------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Node.js                        | v24.19.0                                                             | —                                                                              |
| npm                            | 11.17.0                                                              | —                                                                              |
| Corepack                       | 0.35.0                                                               | pnpm はこれで動かす                                                            |
| pnpm                           | 未インストール（グローバル）                                         | Corepack で 9.15.4 をリポジトリの中（`.cache/corepack`）に取得して使う         |
| Git                            | 2.53.0                                                               | —                                                                              |
| Rust（rustup・cargo・rustc）   | 1.99.0（stable-x86_64-pc-windows-msvc）。2026-10-02 に winget で導入 | 入ったが、下の「スマート アプリ コントロール」のためビルドを実行できない       |
| Visual Studio Build Tools 2022 | 17.14（C++ によるデスクトップ開発）。2026-10-02 に winget で導入     | Rust の MSVC のリンカーに使う                                                  |
| WebView2 Runtime               | 154.0.4258.48                                                        | —                                                                              |
| Microsoft Edge                 | あり                                                                 | Playwright は `channel: 'msedge'` で、ブラウザをダウンロードせずに使える見込み |
| Google Chrome                  | あり                                                                 | 同上（`channel: 'chrome'`）                                                    |
| msedgedriver                   | なし                                                                 | 使わない（通しのテストは WebView2 の CDP 経由で Playwright から操作する）      |
| tauri-driver                   | なし                                                                 | `cargo install tauri-driver` が要る（ビルドが動くことが前提）                  |

## スマート アプリ コントロール（2026-10-02 に判明。2026-10-03 にユーザーがオフにした）

この PC は Windows の「スマート アプリ コントロール」がオン（`HKLM\SYSTEM\CurrentControlSet\Control\CI\Policy` の `VerifiedAndReputablePolicyState` = 1）。Rust はビルドのたびに署名の無い実行ファイル（build script やアプリ本体）を作るので、それが止められる。

- 症状: `cargo check` が「アプリケーション制御ポリシーによってこのファイルがブロックされました。 (os error 4551)」で止まる。イベントログ（Microsoft-Windows-CodeIntegrity/Operational）に `target\debuguild\...uild-script-build` のブロックが残る
- 影響: `cargo check`・`pnpm tauri dev`・`pnpm tauri build`・tauri-driver を使う通しのテスト（カード23）・Spout2（カード41）
- 影響しないもの: Node 側（Vitest・ESLint・tsc・Vite のビルド・ブラウザでの確認）
- 解消のしかた（どれもユーザーが決める）:
  1. スマート アプリ コントロールをオフにする（Windows セキュリティ → アプリとブラウザーの制御 → スマート アプリ コントロールの設定）。Windows の版によっては、一度オフにするとクリーンインストールしないとオンに戻せない
  2. この PC ではネイティブのビルドをせず、ビルドとネイティブの確認は CI（GitHub Actions の windows-latest）や別の PC で行う
- 2026-10-03: ユーザーがオフにした（`VerifiedAndReputablePolicyState` = 0）。`cargo check`・`pnpm tauri dev` が動くようになった
- オフにする前の確認の方法: 画面は Vite の開発サーバー（`.claude/launch.json` の `desktop-web`、http://localhost:1420）をブラウザで開いて確かめる。Tauri に依存するところ（ファイルの読み書き・ダイアログ・グローバルホットキー・ウィンドウ）は未確認として残す

## 書き込み先についての決まり

作業はリポジトリのフォルダの中だけに書き込む。そのため、次のものをリポジトリの中に置いている（どれも .gitignore 済み）。

- `.npmrc`: pnpm の store・cache・state を `.pnpm-store`・`.cache/` に置く
- `COREPACK_HOME=<repo>/.cache/corepack`: Corepack が取得する pnpm 本体
- `.cache/bin/pnpm.cmd`: `corepack pnpm` を呼ぶだけの中継。スクリプトの中の `pnpm` を解決するため、PATH の先頭に足して使う

ふだんの開発では `corepack enable` で pnpm を入れれば、上の中継は要らない。

### この環境でのコマンドの実行方法（PowerShell）

```powershell
$env:PATH = "$PWD\.cache\bin;$env:PATH"
$env:COREPACK_HOME = "$PWD\.cache\corepack"
pnpm install
pnpm lint; pnpm typecheck; pnpm test
```

## 検証の方法の割り振り（いまの見込み）

| 対象                                      | 方法                                                                                                                 | 状態                                                                                                                                        |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| ロジックのテスト・lint・型検査            | Vitest・ESLint・tsc                                                                                                  | 実行できる                                                                                                                                  |
| WebGL2 のピクセルのテスト（カード12）     | Vitest のブラウザモードか Playwright（Edge/Chrome。GPU あり）                                                        | 実行できる見込み。カード12で確かめる                                                                                                        |
| `cargo check`・`tauri build`・`tauri dev` | Rust（導入済み）                                                                                                     | 実行できる（2026-10-03〜）                                                                                                                  |
| Tauri の画面の中の確認                    | `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9223` を付けて `pnpm tauri dev`、CDP で JS を評価する | 実行できる（カード01・05で使った）                                                                                                          |
| 画面の確認（Tauri に依存しないところ）    | Vite の開発サーバー＋ブラウザ                                                                                        | 実行できる（カード05で確かめた）                                                                                                            |
| 通しのテスト（カード23）                  | `pnpm e2e`。WebView2 の CDP 経由で Playwright から操作（tauri-driver・msedgedriver は使わない）                      | 実行できる（2026-10-03。2件とも通った）                                                                                                     |
| カメラ（カード15・24）                    | 実機のカメラあり                                                                                                     | 推定が動くこと（29.6fps）と外へ通信しないことは通しのテストで確かめた。顔の動き・左右・覆ったときは人が手で確かめる（docs/studio-check.md） |
| マイク（STEP1 カード37）                  | 実機のマイクあり                                                                                                     | 同上                                                                                                                                        |
| OBS へのウィンドウキャプチャ              | OBS あり。ただし Tauri アプリを起動できる必要がある                                                                  | ネイティブのビルドが動くまでは確かめられない                                                                                                |
| 基準PCでの性能（カード25）                | 基準PC＋OBS                                                                                                          | **この PC は基準PCと違う**。参考値までしか取れない                                                                                          |
| CI（GitHub Actions）                      | リポジトリが GitHub に無い（git も未初期化）                                                                         | **実行できない**                                                                                                                            |

## ユーザーへの依頼事項

1. ~~Rust を入れる~~ → 2026-10-02 に導入した（Rust 1.99・VS 2022 Build Tools）。
2. ~~スマート アプリ コントロールをどうするか決める~~ → 2026-10-03 にオフにした。
3. CI を回すなら、GitHub のリポジトリを用意する。
