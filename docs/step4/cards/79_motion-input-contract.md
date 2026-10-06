# カード79 動きと入力の契約

| 段              | 担当 | 依存              | 契約 | 実機 | テスト |
| --------------- | ---- | ----------------- | ---- | ---- | ------ |
| 2（契約・直列） | CL   | 75・78（77 の腕） | ○    | —    | CO     |

候補: #6・#7・#8・#11（と、カード95 を行うなら #10）。完成条件: M3〜M6（M8）の土台。範囲はカード75 の結果で直す。

## 目的

顔が外れたときの振る舞いの選択（カード86）、自動の視線・待機の動き（カード87）、表情の入力の拡張と舌（カード88）、腕のトラッキング（カード95）が要る型と規則を、まとめて先に決める。

## 前提

- Environment: `packages/schema/src/types.ts`。STEP3 で `autoBlink` と出力の GPU を足した。
- 顔が外れたときの「止める」（hold）は `packages/tracking/src/mapping/lostWeight.ts` にあるが、設定が無い。
- 自動の層 `auto`: STEP3 のカード65・66。
- TrackingFrame（`packages/contracts/src/index.ts`、10項目）と TrackingInput（`packages/schema/src/types.ts`）。
- カード75 の分析（`docs/step4/measurements/`）、カード77 の腕の推定の報告（行う場合）。

## 決めること・作るもの

1. **顔が外れたときの振る舞い**: Environment に `lostBehavior: 'returnToFront' | 'hold'`（既定 'returnToFront'）。
2. **自動の視線・待機の動きの設定**: オン・オフと強さ。モデルによって合う動きが違うなら Project、PC ごとの好みなら Environment に置く（カード75 の結果で決め、理由を CC に書く）。
3. **表情の入力**: TrackingFrame と TrackingInput に、カード75 で「標準」「カスタム」と決めた項目を足す（左右別の眉・口角など）。舌が動くなら舌の入力と、舌のパラメータ（標準に足すか、ユーザー定義で受けるか）。
4. **腕の入力**（カード95 を行うときだけ）: 腕の角度の入力（肩・肘の左右）。
5. **前の版の扱い**: 足すだけで、前の版のプロジェクトは何もしなくても開ける。schemaVersion を上げるなら変換を足す。
6. **仮実装と契約の変更記録**（CC）。

## 触ってよいもの

- `packages/schema/`、`packages/contracts/`、`docs/contract-changes.md`

## 触らないもの

- 実装（カード86・87・88・95）。

## テスト（担当: CO）

このカードのテストは、実装の担当（CL）ではなく CO が書く（STEP3 の README の「テストの分担」）。ファイルの名前に `.c79.` を入れ、実装の担当は書き換えない。

- `packages/schema/src/motion.c79.test.ts`: lostBehavior・自動の動きの設定・新しい TrackingInput（舌・腕は行う分）の保存・読み込み・既定値の補い・不正な値。前の版のプロジェクトが開ける。

## 完了条件

- [ ] 型・検証・既定値の補いのテスト。前の版のプロジェクトが開ける
- [ ] 既存のテストが通る
- [ ] CC がある

## 記録

（作業中に書く）
