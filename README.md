# 2D Live Model Creator Studio

2D Liver 向けのモデリング・トラッキングツール。設計書は `files/`、進捗は `docs/status.md`。

## 準備

- Node.js 20 以上、pnpm（`corepack enable`）
- Rust（MSVC）と Visual Studio Build Tools（Tauri のビルドに使う）

## 取り込み用の素材を作る

[立ち絵から取り込み用パーツを生成するプロンプト集](docs/part-image-prompts.md)に、キャラクター情報の入力欄、AIへの進行用プロンプト、立ち絵用と素材ごとのプロンプトをまとめている。入力 → 立ち絵の作成・確定 → 素材の順次生成 → 取り込み・動作確認・保存の順で進める。各パーツは同じ立ち絵を参照し、同じキャンバスサイズの透明 PNG として1枚ずつ生成する。

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

パネルと作業エリアの境目はドラッグして大きさを変えられる。境目にフォーカスして矢印キーで16pxずつ（Shiftで64px）、ダブルクリックでその境目を既定に戻す。大きさはモードごとに覚える。☰ の［パネルの配置を元に戻す］は、たたみを保ってすべての大きさを戻す。アニメーションのタイムライン・スライダー、スタジオの下の列も同じ操作で変更できる。

表示の［かんたん］［詳細］は廃止し、ワープ・生成方式・トラッキングの割り当て・数値設定を直接使える。方向グリッドと任意の組み合わせは「組み合わせの補正」で選ぶ。手で追加・編集したキーはロックされ、作り直しから保護される。動きを自動で作る機能の名前は［自動セットアップ］。

## 作業の進め方

- 設計書 `files/implementation-steps-all.md` のカードを番号順に実装する。契約を変えたときは `docs/contract-changes.md` に記録する。
- 各機能は `apps/desktop/src/shell/api.ts` の差し込み口（registerPanel など）で画面に入れる。仮実装を本物に替えるときは `apps/desktop/src/services.ts` だけを書き換える。

## AI音声とリップシンク

スタジオの［音声・リップシンク］でマイクと出力先を選び、［音声と口の動きを開始］を押す。Seed-VC Tinyを標準にし、大型AIも選べる。声の明るさ・厚み・柔らかさ、雑音対策、最大8個のフィルタを同じ画面で設定する。口は最終出力の再生時刻に合わせる。

声とフィルタはプロジェクト保存に含み、［声設定を保存］で別モデルにも渡せる。独自参照WAVは取り込んでから使う。配信では既存の仮想音声デバイスへ出力し、OBSや通話ソフトで対応する録音側を選ぶ。Mute中は口も閉じ、［元の声を試聴］は時刻を合わせたBypassを使う。

AIを使うにはPython 3.12とCUDA対応NVIDIA GPU・準備済みモデルが必要。[音声エンジンの準備](tools/voice-engine/README.md)と[統合計画](docs/liver-voice-changer-integration-plan.md)を参照。AI未準備でも既存のマイクによるリップシンクは使える。

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
