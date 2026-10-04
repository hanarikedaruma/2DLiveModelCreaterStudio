# 2D Live Model Creator Studio

2D Liver 向けのモデリング・トラッキングツール。設計書は `files/`、進捗は `docs/status.md`。

## 準備

- Node.js 20 以上、pnpm（`corepack enable`）
- Rust（MSVC）と Visual Studio Build Tools（Tauri のビルドに使う）

## アプリを使う（ワンクリックで起動）

```sh
pnpm app:install     # 本番用にビルドして %LOCALAPPDATA%\Programs\2D Live Model Creator Studio に置き、デスクトップとスタートメニューにショートカットを作る
pnpm app:uninstall   # 置いたアプリとショートカットを消す（環境設定とプロジェクトは残る）
```

デスクトップの「2D Live Model Creator Studio」をダブルクリックすると起動する。コードを変えたあとは、アプリを閉じてから `pnpm app:install` をもう一度実行すると更新される（ビルドせずに置き直すだけなら `pnpm app:install -NoBuild`）。本番用のビルドには、開発中だけのメニュー（サンプルモデルを開くなど）は入らない。

## コマンド

```sh
pnpm install
pnpm lint          # ESLint（パッケージ間の参照の規則を含む）
pnpm typecheck     # 全パッケージの tsc --noEmit
pnpm test          # 全パッケージの Vitest
pnpm tauri dev     # デスクトップアプリを起動
pnpm tauri build   # インストーラーを作る
pnpm --filter @app/desktop dev       # 画面だけをブラウザで開く（http://localhost:1420。Tauri の機能は使えない）
pnpm --filter @app/fixtures generate # テスト用の素材（fixtures/sample-model）を作り直す
pnpm e2e           # 通しのテスト（PSD を作る → VITE_E2E=1 でデバッグビルド → 本物のアプリを Playwright で操作）
pnpm measure       # 計測（基準モデルをスタジオで動かす・大きな PSD のストレステスト）。docs/acceptance-mvp.md 参照
pnpm --filter @app/fixtures generate:reference # 計測用の基準モデル（fixtures/reference-model）を作り直す
```

アプリの中では Ctrl+Shift+D で計測の表示（描画・トラッキングの fps、遅延）を開ける。

## 作業の進め方

- 設計書 `files/implementation-steps-all.md` のカードを番号順に実装する。契約を変えたときは `docs/contract-changes.md` に記録する。
- 各機能は `apps/desktop/src/shell/api.ts` の差し込み口（registerPanel など）で画面に入れる。仮実装を本物に替えるときは `apps/desktop/src/services.ts` だけを書き換える。

## 構成

| パス               | 内容                                               |
| ------------------ | -------------------------------------------------- |
| packages/schema    | データ型・検証・既定値・規則（@app/schema）        |
| packages/contracts | 実行時のインターフェースと仮実装（@app/contracts） |
| packages/core      | 評価・変形・生成・合成・ストア（DOM に依存しない） |
| packages/render    | WebGL2 の描画                                      |
| packages/io        | 取り込み・保存                                     |
| packages/tracking  | 顔の推定とマッピング                               |
| packages/audio     | 音声（リップシンク）                               |
| apps/desktop       | Tauri 2 + React。すべてを組み合わせる              |
| fixtures           | テスト用の素材                                     |
| tools/lint-rules   | 参照の規則のテスト                                 |

パッケージから参照してよいのは `@app/schema` と `@app/contracts` だけ（schema は何も参照しない、contracts は schema だけ）。すべてを組み合わせるのは apps/desktop だけ。
