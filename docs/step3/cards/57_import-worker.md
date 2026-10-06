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

（作業中に書く）
