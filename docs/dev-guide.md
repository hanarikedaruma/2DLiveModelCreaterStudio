# 開発の手引き

カードを実装するときの決まり。設計書は `files/implementation-steps-all.md`（カードごとの節だけを読めばよい）。設計書から形を変えたものは `docs/contract-changes.md` にある（設計書より優先する）。

## コマンド（この PC の PowerShell）

pnpm はリポジトリの中の Corepack で動かす。毎回、先に PATH を足す。

```powershell
$env:PATH = "$PWD\.cache\bin;$env:USERPROFILE\.cargo\bin;$env:PATH"; $env:COREPACK_HOME = "$PWD\.cache\corepack"
pnpm --filter @app/core test        # パッケージのテスト（@app/schema・contracts・core・render・io・tracking・audio・desktop）
pnpm --filter @app/core typecheck   # パッケージの型検査
pnpm exec eslint packages/core/src/eval   # 触ったフォルダだけを lint
pnpm exec prettier --write packages/core/src/eval   # 触ったフォルダだけを整形
```

全体の確認は `pnpm lint`・`pnpm typecheck`・`pnpm test`・`pnpm format:check`。

## 書き方

- TypeScript は strict（`noUncheckedIndexedAccess` あり）。データは不変に扱い、更新は新しいオブジェクトを返す。
- ロジックには必ずユニットテスト（Vitest）を付ける。テストはソースの隣に `*.test.ts(x)` で置く。
- コメント・画面の文言・テストの名前は日本語。まわりのコードの書きぶり（短い常体、「〜する」）に合わせる。
- パッケージから参照してよいのは `@app/schema` と `@app/contracts` だけ。パッケージのテストは `@app/fixtures` も参照してよい（例: `import sample from '@app/fixtures/sample-model/project.json'` を `validateProject` に通す。fixtures を使うパッケージは devDependencies に `@app/fixtures` が要る。いまは core だけ）。
- core は DOM を値として使わない（`window`・`document` などは lint で止める）。
- 各パッケージの `src/index.ts` は、フォルダごとの `index.ts` を `export *` でまとめている。公開する名前はほかのフォルダと重ならないようにする。
- 画面の部品は `apps/desktop/src/shell/api.ts` の差し込み口（registerPanel・registerPanelSection・registerCanvasTool・registerCanvasOverlay・registerCenter・registerSetupScreen・registerMenuItem、useServices・useProject・useDispatch・useEditor・useEnvironment・useDialogs・useCanvas）で入れる。各機能のフォルダの `index.ts` の `register()` で登録する（`apps/desktop/src/modes/index.ts` が呼ぶ）。
- 画面のテストは jsdom と @testing-library/react（例: apps/desktop/src/shell/Shell.test.tsx）。jsdom には 2D/WebGL のコンテキストが無いので、描画はテスト用のレンダラーに差し替える。サービスは `createFakeServices()`（apps/desktop/src/services.ts。仮実装だけで組み立てる）を使い、必要なものだけ上書きする。
- 仮実装を本物に替えるのは結合のカード（MVP は 23・24、STEP1 は 44）。部品のカードは `services.ts` を書き換えない。STEP1 のサービス（audio・lipSync・autoBlink・bodyFollow・expressions・calibration・hotkeys・spout）は、カード44まではアプリの中でも仮実装なので、画面は仮実装で動くように作り、本物はパッケージの中でテストする。
- STEP2（カード45）から `LayerProducer.produce` は `Layer | Layer[] | null` を返す（同じ id のレイヤーは配列の順に合成）。produce の結果を契約の型のまま使うところでは、配列も受け取る（例: `r === null ? [] : Array.isArray(r) ? r : [r]`）。
- 表示の「かんたん／詳細」はI-088・CC-019で廃止した。登録の`level`や`DetailDisclosure`を使わず、詳細項目も常に表示する。`presetOf`はshell/api.tsから、`confirmOverwriteCustom(dialogs, current)`・`useConfirmOverwriteCustom()`（プリセットを選び直すとき、今の値が'custom'なら「個別に調整した値を上書きします」を確かめる）はshell/levelからimportする。
- jsdomで`<Shell>`を描くテストは、描画を何もしないレンダラーに替える（例: apps/desktop/src/shell/Shell.test.tsxの`{ ...createFakeServices(), createRenderer: () => renderer }`）。
- ExpressionController の `apply(null, now)` は、変数に入れた形（`expressions.apply(null, now)`）で呼ぶと ESLint の prefer-spread に取り違えられる（`services.expressions.apply(…)` の形なら出ない）。呼ぶところに `// eslint-disable-next-line prefer-spread -- ExpressionController.apply は Function.prototype.apply ではない` を付ける。

## 部品のカードを並行して作るとき（STEP1 の S1・S2 など）

- 触ってよいのは、カードの「作業場所」と、その中のテスト・CSS だけ。例外として、次の共有のファイルには行を足すだけならよい（ほかの人も同時に書くので、書く直前に読み直し、既存の行は変えない）:
  - 各パッケージの `src/index.ts`（`export * from './フォルダ'` を足す）
  - `apps/desktop/src/modes/index.ts`（自分のフォルダの `register` の import と呼び出しを1行ずつ。コメントは `// カードNN`）
- `@app/schema`・`@app/contracts` の型、`services.ts`、`docs/`、ほかのカードのフォルダは変えない。契約を変えないと作れないと分かったら、変えずに報告する。
- `pnpm e2e`・`pnpm tauri build`・`pnpm tauri dev`・`pnpm measure` は動かさない（まとめ役が動かす）。ビルド済みのアプリ（src-tauri/target/debug/live2d-studio.exe）も起動しない（残っているとまとめ役のビルドが失敗する）。テスト・型検査・lint・整形は自分の触ったところで行う。`pnpm typecheck` がほかの人の作業中のファイルで失敗したら、そのことを報告に書けばよい。
- カードの範囲の外で見つけた不具合や改善は直さずに報告する（まとめ役が docs/issues.md に入れる）。
- 終わったら、次を日本語で報告する: 作った・変えたファイル、完了条件ごとの確認（✅ 何で確かめたか / 🟡 確かめられない理由と手順）、カードから変えたところと理由、実機や手で確かめることが残るもの、範囲の外で見つけた課題、結合（カード44）で必要なこと（services.ts で差し替えるもの、登録の呼び出しなど）。

## 確認の記録

カードの完了条件ごとに、何で確かめたか（✅）、確かめられなかったもの（🟡 と理由・手順）を `docs/status.md` に書く。確かめていないことを「できた」と書かない。

## 開発中の確認の道具

- ブラウザ: `.claude/launch.json` の `desktop-web`（Vite の開発サーバー、http://localhost:1420）。開発中は `window.__studio` に `{ services, environment }` が入る。
- メニューの「サンプルモデルを開く」で fixtures/sample-model を開ける。キャンバスの「座標の確認」ツールで、押した点のキャンバス座標が確認用パネルに出る。
- Tauri: `pnpm tauri dev`（Vite も同じポート 1420 を使うので、ブラウザ用の開発サーバーは止めてから）。
- Tauri の画面の中の確認: PowerShell で `$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = "--remote-debugging-port=9223"` を付けて `pnpm tauri dev` を起動し、`node tools/dev/cdp-eval.mjs "<式>"` で WebView の中の JS を評価する（例: `window.__studio.environment.get()`）。
