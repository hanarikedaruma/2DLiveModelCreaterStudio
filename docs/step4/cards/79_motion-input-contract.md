# カード79 動きと入力の契約

| 段              | 担当 | 依存              | 契約 | 実機 | テスト |
| --------------- | ---- | ----------------- | ---- | ---- | ------ |
| 2（契約・直列） | CL   | 75・78（77 の腕） | ○    | —    | CO     |

候補: #6・#7・#8・#11・#16（と、カード95 を行うなら #10）。完成条件: M3〜M6・M9（M8）の土台。範囲はカード75 の結果で直す。

2026-10-08: ユーザーの胸揺れの先行実装方針に合わせ、胸に必要な契約だけはカード98内でCOが先行して実装する。他の入力の契約や本カード全体の着手条件は変えない。以下の胸の項目は未実装で、最新の出力の割り当て・所有・修復・方式切替・移行の規則は [設計再確認](../chest-sway-design-review.md) を優先する。

## 目的

顔が外れたときの振る舞いの選択（カード86）、自動の視線・待機の動き（カード87）、表情の入力の拡張と舌（カード88）、腕のトラッキング（カード95）、胸揺れ（カード98）が要る型と規則を、まとめて先に決める。

## 前提

- Environment: `packages/schema/src/types.ts`。STEP3 で `autoBlink` と出力の GPU を足した。
- 顔が外れたときの「止める」（hold）は `packages/tracking/src/mapping/lostWeight.ts` にあるが、設定が無い。
- 自動の層 `auto`: STEP3 のカード65・66。
- TrackingFrame（`packages/contracts/src/index.ts`、10項目）と TrackingInput（`packages/schema/src/types.ts`）。
- カード75 の分析（`docs/step4/measurements/`）、カード77 の腕の推定の報告（行う場合）。
- 物理: `Physics`（`packages/schema/src/types.ts`）。種類は hair・cloth・ribbon・accessory、方向が both でも出力は1つ、入力の一覧は両方の向きに共通。胸揺れの設計は [カード98](98_chest-sway.md) の「設計」。

## 決めること・作るもの

1. **顔が外れたときの振る舞い**: Environment に `lostBehavior: 'returnToFront' | 'hold'`（既定 'returnToFront'）。
2. **自動の視線・待機の動きの設定**: オン・オフと強さ。モデルによって合う動きが違うなら Project、PC ごとの好みなら Environment に置く（カード75 の結果で決め、理由を CC に書く）。
3. **表情の入力**: TrackingFrame と TrackingInput に、カード75 で「標準」「カスタム」と決めた項目を足す（左右別の眉・口角など）。舌が動くなら舌の入力と、舌のパラメータ（標準に足すか、ユーザー定義で受けるか）。
4. **腕の入力**（カード95 を行うときだけ）: 腕の角度の入力（肩・肘の左右）。
5. **胸揺れの物理（I-061。カード98 の設計）**: 足すだけにする（省略したときは今と同じ動き）。
   - `Physics['preset']` に `'chest'`。
   - `Physics.deform?: 'swing' | 'bounce'`（自動で作るキーの形。省略は swing）。種類の値の表（presets）とは分けて持つ（詳細で値を変えても方式は変わらない）。
   - `Physics.verticalOutputParameterId?: Id | null`（both/verticalの上下を出すパラメータ。省略・nullならbothは従来の左右だけ、verticalは従来の主出力へ出す）。新しい項目の左右・上下に同じIDを指定せず、方向変更で出力IDを付け替えない。読込修復で無い上下出力をnullにして知らせ、パラメータ削除と利用判定も両出力を見る。
   - `inputs[].axis?: 'horizontal' | 'vertical'`（その入力を使う振り子の向き。省略は両方）。
   - 標準パーツ `'chest'`（胸。任意）と表示名。体の前・腕の後ろ。
   - 標準パラメータ `BustX`（胸揺れ 左右）・`BustY`（胸揺れ 上下）。グループ sway、−1..1。開いたときに足す標準パラメータ（`standardParametersFor`）には入れない（使うときだけ足す）。
   - （範囲のモードを行うとき。カード73 で決める）`Physics.region?: { center: Vec2; radius: Vec2 } | null`（キャンバス座標の楕円）。
   - 検証（`validate.ts`）: 種類・方式・軸の値、左右と上下のIDの重複、半径が正。構造の検証と参照切れの修復を分け、無い上下出力が修復前の検証で拒否されないようにする。出力の所有と固定範囲・メッシュ対応・自動キーの記録も先行契約で確定する。
6. **前の版の扱い**: 足すだけで、前の版のプロジェクトは何もしなくても開ける。schemaVersion を上げるなら変換を足す。
7. **仮実装と契約の変更記録**（CC）。

## 触ってよいもの

- `packages/schema/`、`packages/contracts/`、`docs/contract-changes.md`
- `packages/io/src/project/repair.ts` と、そのテスト（胸揺れの上下の出力先の修復だけ）

## 触らないもの

- 実装（カード86・87・88・95・98）。

## テスト（担当: CO）

このカードのテストは、実装の担当（CL）ではなく CO が書く（STEP3 の README の「テストの分担」）。ファイルの名前に `.c79.` を入れ、実装の担当は書き換えない。

- `packages/schema/src/motion.c79.test.ts`: lostBehavior・自動の動きの設定・新しい TrackingInput（舌・腕は行う分）の保存・読み込み・既定値の補い・不正な値。前の版のプロジェクトが開ける。
- `packages/schema/src/physics.c79.test.ts`: 胸揺れの項目（chest・deform・verticalOutputParameterId・axis・region）の保存・読み込み・不正な値。新しい項目の無い前の版の物理が今と同じ値で開ける。BustX・BustY が開いたときに足されない。
- `packages/io/src/project/repair.c79.test.ts`: 無いパラメータを指す verticalOutputParameterId を、開くときに外して知らせる。

## 完了条件

- [ ] 型・検証・既定値の補いのテスト。前の版のプロジェクトが開ける
- [ ] 既存のテストが通る
- [ ] CC がある

## 記録

（作業中に書く）
