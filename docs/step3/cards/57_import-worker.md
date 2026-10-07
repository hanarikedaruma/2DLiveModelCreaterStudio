# カード57 PSD の取り込みを Worker へ・素材のメモリ

| 段              | 担当 | 依存 | 契約                                      | 実機 | テスト |
| --------------- | ---- | ---- | ----------------------------------------- | ---- | ------ |
| 1（部品・並行） | CO   | 55   | —（`contracts/src/assets.ts` の中身だけ） | —    | CL     |

課題: I-004・I-003。

## 目的

大きな PSD の取り込み中に画面が止まらないようにし（今は 9.2秒止まる）、取り込んだ後のメモリを減らす。

## 前提

- 取り込み: `packages/io/src/import/`（ag-psd の readPsd をメインスレッドで同期に呼ぶ）。
- 素材の置き場: `packages/contracts/src/assets.ts` の createAssetRepository。素材ごとに PNG・ImageBitmap・ImageData を持ち続ける。
- CSP は `worker-src 'self' blob:` を許している（`apps/desktop/src-tauri/tauri.conf.json`）。
- 既存の計測: `pnpm measure` の stress（`apps/desktop/e2e/stress.measure.ts`、fixtures/stress/stress-4000x6000-100.psd）。前の値は docs/measurements/stress-2026-10-03T07-27-18-443Z.json。
- 既存のテスト: `packages/io/src/import/*.test.ts`、UC-02・UC-03（tests/usecase/usecases.md）。

## 作るもの・直すもの

1. **取り込みを Web Worker で動かす。** PSD・PNG の解析・トリミング・PNG への符号化を Worker に移す。Importer の型（`importFiles`）は変えない。
2. **進み具合。** 取り込み中はファイル・レイヤーの進み具合を出し、画面は操作できる。途中で取り消せる。
3. **素材のメモリ（I-003）。** ImageData はメッシュを作るときだけ作って捨てる。置き場の公開の型は変えない。
4. **大きな chunk の警告。** ag-psd・fast-png を Worker 側の chunk に分ける。警告が残るなら理由を記録に書く。
5. **計測。** 既存の stress の計測に、メインスレッドが止まった最長の時間を足し、前後で取り込みの時間・最長の止まり・割り当て後のメモリを比べる。

## 触ってよいもの

- `packages/io/src/import/`（`reload.ts` を除く）
- `packages/contracts/src/assets.ts`（中身だけ。export の型は変えない）
- `apps/desktop/src/modes/modeling/assets/`（`reload/` を除く。進み具合の表示）
- `apps/desktop/vite.config.ts`（Worker と chunk の設定）
- `apps/desktop/e2e/stress.measure.ts`
- `apps/desktop/e2e/modeling.e2e.ts` の準備・後始末（保存済みのパネルの折りたたみに左右されず、本物のWorkerから保存・再読込までを確かめるため）
- `apps/desktop/src/shell/canvas/CanvasHost.tsx` の素材画像をレンダラーへ渡す部分と、その回帰テスト（2026-10-07 の計測に基づく範囲の補足。未割り当ての画像を一括でGPUへ上げる停止を除く）

## 触らないもの

- `packages/contracts/src/index.ts`（型。カード58・65）、`packages/io/src/project/`（カード58）、`reload.ts`・`assets/reload/`（カード62）。

## テスト（担当: CL）

このカードのテストは、実装の担当（CO）ではなく CL が書く（README の「テストの分担」）。テストのファイルは名前にカードの番号（`.c57.`）を入れ、実装の担当は書き換えない。

- `packages/io/src/import/importer.c57.test.ts`: Worker の経路と前の経路で、同じ PSD・PNG から同じ素材（位置・大きさ・ハッシュ）と警告が出る（sample-model の PSD、usecases.md の警告用の PSD）。途中で取り消すと素材が1つも増えない。
- `packages/contracts/src/assets.c57.test.ts`: 素材の置き場が ImageData を持ち続けない（メッシュを作るときだけ作る）。
- `apps/desktop/src/modes/modeling/assets/import.c57.test.tsx`: 取り込み中に進み具合が出て、画面を操作できる。
- 計測: stress の計測で、最長の止まりが 100ms 未満かを確かめて記録する。
- CH・UC-CH: UC-02・UC-03 を Worker の後の動きで回す手順。

## 完了条件

- [ ] stress の取り込み中、メインスレッドが 100ms 以上続けて止まらない
- [ ] 取り込みの結果（素材・位置・警告）が前と同じ（既存のテストと、Worker の経路のテスト）
- [ ] 割り当て後のメモリが前より減る（数値を記録）
- [ ] `pnpm e2e` で本物のアプリが PSD を取り込める。外へ通信しない確認も通る

## 締めるときに書くもの

- docs/issues.md の I-003・I-004 を対応済みに（数値を添えて）。docs/acceptance-mvp.md のストレステストの表に新しい値。

## 記録

- 2026-10-07 CL（テストの担当）: カード57 のテストを書いた（作業フォルダにあり、まだコミットしていない。CO の実装のコミットの後に CL がコミットする）。CO の書きかけの実装で全部通っている。
  - `packages/io/src/import/importer.c57.test.ts` 4件: Worker の経路と前の経路で同じ素材・警告（警告の出る PSD・大きさの違う PNG）、呼び出し元のバイト列を変えない、進み具合（ファイル・レイヤー）と終わったら消える、取り消しで ImportCancelledError・Worker を止める・次の取り込みができる。
  - `packages/contracts/src/assets.c57.test.ts` 2件: put では ImageData を取り出さない、既定の decodePng は画素を要求されるまで OffscreenCanvas を使わない。
  - `apps/desktop/src/modes/modeling/assets/import.c57.test.tsx` 2件: 取り込み中の進み具合の表示とモードの切り替え、「取り込みを取り消す」。
  - 残り: stress の計測の最長の止まり（CO が計測を足したあと照合する）、CH・UC-CH。

- 2026-10-07 CO: PNG・PSD の解析、トリミング、符号化を import.worker.ts へ移した。Node のテストは同じ解析部を直接呼ぶ。Importer の契約は維持し、io の任意の操作口（importControlsOf）で進捗と取り消しを扱う。
- ファイルとレイヤー、画像の準備の進捗をセットアップ・素材トレイに表示。取り消しと別のプロジェクトへ切り替えた場合は、素材追加のコマンドを確定しない。入力は4 MiB ごとに画面へ制御を返してコピーし、元のバイト列を保つ。Worker は成功・失敗・取り消しで終了する。
- 素材の既定の decodePng は ImageData を getter で都度作る。put は ImageBitmap と PNG を持ち、ImageData を作らない。公開の型を変えていない。
- 自分の回帰テスト: メモリの1件と画像準備中の取り消しの1件が変更前に失敗することを確認し、変更後に成功。Worker の転送・取り消し・再試行・実行時/起動時エラー4件、進捗UI1件も確認。CL の importer.c57.test.ts 4件も通った。既存の io 全142件と全体の型検査も通った（後から追加したテストは最終検査で再確認する）。
- stress.measure.ts に Long Tasks API の最長処理と16ms のタイマーの最大間隔を追加した。未対応の API は null として、0ms の成功を報告しない。
- 未確認: 本物の Worker（Tauri/WebView2）の e2e、1440×1000・800×600 の画面、stress の時間・最長停止・割り当て後のメモリ、CL の全受け入れテストと全体の最終検査。数値未取得なので I-003・I-004 はまだ対応済みにしていない。
- 2026-10-07 CO: 全体の単体テストは成功（カード65の既知の不一致1件は修正待ちで skip）。型検査と Tauri ビルドは CL の作成中の mirrorCopy.c64.test.ts の Binding の型が原因で停止。自分の進捗UIテストの型は修正済み。format:check は CL の importer.c57.test.ts の整形待ち。実アプリ e2e・stress は、このビルドが通ってから行う。
- 2026-10-07 CO: Edge の開発画面で100枚を取り込み、解析後の確定時に1023msの Long Task が残ることを確認した。CPU の記録では、未割り当ての画像のGPUテクスチャの作成と、100枚のサムネイルの Blob・URL の準備が主な処理だった。README とこのカードの範囲を補足して、CanvasHost は割り当て中の画像だけをレンダラーへ渡すようにし、サムネイルの Blob・URL は画像ごとに別のタスクで準備する。消えたサムネイルの予定とURLは解放する。
- この停止対策の回帰テスト3件は変更前にすべて失敗し、変更後に成功。割り当て・画像の差し替え・Undo/Redo・別プロジェクトへの切り替え、サムネイルの準備と取消を確認した。既存の素材画面9件・Shell27件と合わせた39件も通った。再計測と実アプリでの検証は続ける。
- 2026-10-07 CL（テストの担当）: 上の3つのテストのファイル（8件）は CO の実装のコミットの後にコミットした（10b0221）。最新の実装（90a9c24）でも8件とも通る。CH-148〜CH-150 と UC-CH-26（UC-02・UC-03 を Worker の後で回す手順と stress の計測）を tests/usecase/changes.md に書いた。
- テスト確認はまだ書かない: 完了条件1・3（stress の最長の止まり・割り当て後のメモリ）と4（`pnpm e2e` の本物のアプリでの取り込み・外へ通信しない確認）が未確認。CO の計測と e2e の結果を見て照合する。
