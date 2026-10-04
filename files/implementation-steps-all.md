# 実装手順（2D Liver モデリング・トラッキングツール）

設計書（第2版）を、番号順に実装すれば完成するカードに分けたもの。1枚のカードが1つの作業単位で、そのカードだけを読めば実装できる。

## 使い方

- 作業のたびに、そのカード1枚だけを読み込ませる（AIに渡す場合も同じ）。ほかのカードや設計書は読ませなくてよい。
- 番号の小さい順に進める。段階の境目では、前の段階のカードがすべて終わっていること。
- 同じ段階のカードは互いに依存せず、触るフォルダも重ならない。分担して並行に作れる。
- カードの「前提」に書いた型・関数・差し込み口は、その時点で必ずある。名前と形を変えないこと。
- 形を変える必要が出たときは、契約のカード（02・03・05、26、45）を直し、同じ型を「前提」に載せているカードも同じように直す。

## 段階の考え方

- 契約（02・03・05・26・45）: 型とインターフェースと仮実装を先に決める。これで部品のカードが互いを待たずに作れる。
- 部品（M1・S1・S2・T1）: 契約だけに依存して作る。ほかの部品は仮実装のまま動かして確かめる。
- 結合（M2・S3・T2）: 仮実装を本物に差し替え、完成条件を確かめる。

## 技術の前提

| 項目 | 採用 |
| --- | --- |
| デスクトップ | Tauri 2（Windows 10 / 11 を優先） |
| 画面 | React + TypeScript + Vite |
| 描画 | WebGL2（乗算済みアルファ） |
| 顔の推定 | MediaPipe Face Landmarker（PCの中で実行） |
| PSD の読み込み | ag-psd |
| テスト | Vitest、Playwright |
| Spout2 出力 | Rust（wgpu）と Spout2 SDK |

## 階層


### MVP


#### M0 基盤

直列。前の番号のカードが終わってから始める。

| 番号 | カード | 担当の目安 | ファイル |
| --- | --- | --- | --- |
| 01 | リポジトリと開発環境 | 基盤 | `1_MVP/M0_foundation/01_repo-setup.md` |
| 02 | データスキーマ（型・検証・既定値・規則） | 基盤 | `1_MVP/M0_foundation/02_schema.md` |
| 03 | 実行時の契約と仮実装 | 基盤 | `1_MVP/M0_foundation/03_contracts.md` |
| 04 | ストアとコマンド（Undo / Redo） | 基盤 | `1_MVP/M0_foundation/04_store.md` |
| 05 | アプリの枠（モード・パネル・差し込み口） | 基盤 | `1_MVP/M0_foundation/05_app-shell.md` |

#### M1 部品

同じ段階の 06〜22 と並行して作れる（触るフォルダは重ならない）。

| 番号 | カード | 担当の目安 | ファイル |
| --- | --- | --- | --- |
| 06 | バインディングの評価 | コア | `1_MVP/M1_parts/06_binding-eval.md` |
| 07 | 変形パイプライン | コア | `1_MVP/M1_parts/07_deform-pipeline.md` |
| 08 | 中間キーの生成（線形・奥行き） | コア | `1_MVP/M1_parts/08_key-generation.md` |
| 09 | パラメータの合成（ミキサー） | コア | `1_MVP/M1_parts/09_mixer.md` |
| 10 | メッシュの自動生成 | コア | `1_MVP/M1_parts/10_mesh-generator.md` |
| 11 | かんたんセットアップ（たたき台の生成） | コア | `1_MVP/M1_parts/11_auto-setup.md` |
| 12 | WebGL2レンダラー（マスク・背景を含む） | 描画 | `1_MVP/M1_parts/12_renderer.md` |
| 13 | PNG・PSDの取り込み | 入出力 | `1_MVP/M1_parts/13_importer.md` |
| 14 | 保存・読み込み・自動保存 | 入出力 | `1_MVP/M1_parts/14_project-io.md` |
| 15 | カメラと顔の推定 | トラッキング | `1_MVP/M1_parts/15_face-tracking.md` |
| 16 | マッピング・スムージング・外れたときの復帰 | トラッキング | `1_MVP/M1_parts/16_tracking-layer.md` |
| 17 | 素材トレイと標準パーツの割り当て | 画面 | `1_MVP/M1_parts/17_assets-assign.md` |
| 18 | キャンバス編集（選択・変形・ピボット） | 画面 | `1_MVP/M1_parts/18_canvas-edit.md` |
| 19 | パラメータパネルとキー編集 | 画面 | `1_MVP/M1_parts/19_parameter-panel.md` |
| 20 | パーツ構造・描画順・マスクの設定 | 画面 | `1_MVP/M1_parts/20_structure.md` |
| 21 | メッシュ編集 | 画面 | `1_MVP/M1_parts/21_mesh-edit.md` |
| 22 | スタジオ画面と出力ウィンドウ | 画面 | `1_MVP/M1_parts/22_studio.md` |

#### M2 結合

直列。

| 番号 | カード | 担当の目安 | ファイル |
| --- | --- | --- | --- |
| 23 | モデリングの結合 | 結合 | `1_MVP/M2_integration/23_integrate-modeling.md` |
| 24 | スタジオの結合 | 結合 | `1_MVP/M2_integration/24_integrate-studio.md` |
| 25 | 計測とMVPの受け入れ | 結合 | `1_MVP/M2_integration/25_mvp-acceptance.md` |

### STEP1


#### S0 契約の拡張

直列。

| 番号 | カード | 担当の目安 | ファイル |
| --- | --- | --- | --- |
| 26 | STEP1の契約の拡張 | 基盤 | `2_STEP1/S0_contracts/26_contracts-step1.md` |

#### S1 部品

同じ段階の 27〜41 と並行して作れる（触るフォルダは重ならない）。

| 番号 | カード | 担当の目安 | ファイル |
| --- | --- | --- | --- |
| 27 | かんたん/詳細の切り替え | 画面 | `2_STEP1/S1_parts/27_ui-level.md` |
| 28 | メッシュの密度と変形の転写 | コア | `2_STEP1/S1_parts/28_mesh-transfer.md` |
| 29 | ワープ | コア | `2_STEP1/S1_parts/29_warp.md` |
| 30 | 2Dパラメータと組み合わせキー | 画面 | `2_STEP1/S1_parts/30_params-2d.md` |
| 31 | 生成方式の追加と、中間キーの編集・ロック・再補間 | コア | `2_STEP1/S1_parts/31_generation-more.md` |
| 32 | 合成モードとPSDの合成・クリッピング | 描画 | `2_STEP1/S1_parts/32_blend-modes.md` |
| 33 | 反転マスクと複数のマスク元 | 画面 | `2_STEP1/S1_parts/33_masks-more.md` |
| 34 | 不透明度のキー・標準パラメータの追加・ユーザー定義パラメータ | 画面 | `2_STEP1/S1_parts/34_params-more.md` |
| 35 | キャリブレーション・トラッキング簡易設定・追加の入力 | トラッキング | `2_STEP1/S1_parts/35_calibration.md` |
| 36 | 自動まばたきと体の追従 | コア | `2_STEP1/S1_parts/36_auto-motion.md` |
| 37 | 音量のリップシンク | 入出力 | `2_STEP1/S1_parts/37_lipsync-volume.md` |
| 38 | 表情 | コア | `2_STEP1/S1_parts/38_expressions.md` |
| 39 | シーンと背景プリセット | 画面 | `2_STEP1/S1_parts/39_scenes.md` |
| 40 | グローバルホットキー | 入出力 | `2_STEP1/S1_parts/40_hotkeys.md` |
| 41 | Spout2出力 | ネイティブ | `2_STEP1/S1_parts/41_spout2.md` |

#### S2 部品

42 と 43 は並行して作れる。

| 番号 | カード | 担当の目安 | ファイル |
| --- | --- | --- | --- |
| 42 | かんたんセットアップの拡張 | コア | `2_STEP1/S2_parts/42_auto-setup-step1.md` |
| 43 | PSDの再読み込み | 入出力 | `2_STEP1/S2_parts/43_psd-reload.md` |

#### S3 結合

直列。

| 番号 | カード | 担当の目安 | ファイル |
| --- | --- | --- | --- |
| 44 | STEP1の結合と受け入れ | 結合 | `2_STEP1/S3_integration/44_step1-acceptance.md` |

### STEP2


#### T0 契約の拡張

直列。

| 番号 | カード | 担当の目安 | ファイル |
| --- | --- | --- | --- |
| 45 | STEP2の契約の拡張 | 基盤 | `3_STEP2/T0_contracts/45_contracts-step2.md` |

#### T1 部品

同じ段階の 46〜53 と並行して作れる（触るフォルダは重ならない）。

| 番号 | カード | 担当の目安 | ファイル |
| --- | --- | --- | --- |
| 46 | アニメーション画面（タイムライン・登録） | 画面 | `3_STEP2/T1_parts/46_animation-editor.md` |
| 47 | アニメーションの再生と遷移 | コア | `3_STEP2/T1_parts/47_animation-player.md` |
| 48 | 周期アニメーション | コア | `3_STEP2/T1_parts/48_periodic.md` |
| 49 | 物理演算 | コア | `3_STEP2/T1_parts/49_physics-engine.md` |
| 50 | 物理のかんたんUIと揺れの自動作成 | 画面 | `3_STEP2/T1_parts/50_physics-ui.md` |
| 51 | 母音のリップシンク | 入出力 | `3_STEP2/T1_parts/51_lipsync-vowels.md` |
| 52 | 表情の同時適用 | コア | `3_STEP2/T1_parts/52_expressions-stack.md` |
| 53 | 呼吸・腕の標準パラメータと自動セットアップ | コア | `3_STEP2/T1_parts/53_auto-setup-step2.md` |

#### T2 結合

直列。

| 番号 | カード | 担当の目安 | ファイル |
| --- | --- | --- | --- |
| 54 | STEP2の結合と受け入れ | 結合 | `3_STEP2/T2_integration/54_step2-acceptance.md` |


---

# 01. リポジトリと開発環境

> このカードだけで実装できるように、必要な仕様・型・約束をすべて書いている。ほかのカードや設計書を読む必要はない。「前提」に書いたものは、このカードの時点で必ずある。名前と形を変えないこと。

| 項目 | 内容 |
| --- | --- |
| フェーズ / 段階 | MVP / M0 基盤 |
| 並行作業 | 直列。前の番号のカードが終わってから始める |
| 担当の目安 | 基盤 |
| 作業場所 | リポジトリ全体 |

## 目的

全員が同じ構成・同じ規則で作業できる土台を作る。

## 前提（このカードの時点ですでにあるもの）

なし（最初のカード）。

### リポジトリの約束

- pnpm ワークスペースのモノレポ。TypeScript は strict、テストは Vitest。
- パッケージ: `@app/schema`（packages/schema。データ型・検証・既定値・規則）、`@app/contracts`（packages/contracts。実行時のインターフェースと仮実装）、`@app/core`（packages/core。評価・変形・生成・合成・ストア。DOMに依存しない）、`@app/render`（packages/render。WebGL2）、`@app/io`（packages/io。取り込み・保存）、`@app/tracking`（packages/tracking）、`@app/audio`（packages/audio）、`apps/desktop`（Tauri 2 + React）。
- パッケージから参照してよいのは `@app/schema` と `@app/contracts` だけ（同じパッケージの中は自由）。すべてを組み合わせるのは apps/desktop だけ。
- データは不変に扱い、更新は新しいオブジェクトを返す。
- ロジックには必ずユニットテストを付ける。

## 作るもの

- pnpm ワークスペースを作り、`packages/schema`・`contracts`・`core`・`render`・`io`・`tracking`・`audio` と `apps/desktop`・`fixtures` を置く。各パッケージは空の `src/index.ts` とテスト1件だけ。パッケージ名は `@app/schema` などにする。
- `apps/desktop` は Tauri 2 + React 18 + Vite + TypeScript。Windows 10 / 11（64bit）でビルド・起動できる。
- TypeScript strict、ESLint、Prettier、Vitest を全体に入れ、`pnpm test`・`pnpm lint` で全パッケージを回す。
- 参照の規則を ESLint の import 制限で強制する（schema → なし、contracts → schema、ほかのパッケージ → schema と contracts、apps/desktop → すべて）。
- Tauri のプラグイン: fs、dialog、global-shortcut、window-state。WebView2 でカメラとマイクを使えるようにする（権限の確認をアプリ側で許可する）。
- CI（GitHub Actions、windows-latest）: install → lint → test → tauri build。

## 作らないもの

画面と機能。

## 完了条件

- [ ] `pnpm test` と `pnpm lint` が全パッケージで通る
- [ ] `pnpm tauri dev` で空のウィンドウが開く
- [ ] 禁止した参照（例: core から render）を書くと lint が失敗する
- [ ] CI が通る


---

# 02. データスキーマ（型・検証・既定値・規則）

> このカードだけで実装できるように、必要な仕様・型・約束をすべて書いている。ほかのカードや設計書を読む必要はない。「前提」に書いたものは、このカードの時点で必ずある。名前と形を変えないこと。

| 項目 | 内容 |
| --- | --- |
| フェーズ / 段階 | MVP / M0 基盤 |
| 並行作業 | 直列。前の番号のカードが終わってから始める |
| 担当の目安 | 基盤 |
| 作業場所 | packages/schema/src/ |

## 目的

全カードが使うデータの形を確定させる。STEP2 までの項目を最初から含め、後から形を変えないようにする。

## 前提（このカードの時点ですでにあるもの）

pnpm モノレポと、空の `packages/schema` がある。

### リポジトリの約束

- pnpm ワークスペースのモノレポ。TypeScript は strict、テストは Vitest。
- パッケージ: `@app/schema`（packages/schema。データ型・検証・既定値・規則）、`@app/contracts`（packages/contracts。実行時のインターフェースと仮実装）、`@app/core`（packages/core。評価・変形・生成・合成・ストア。DOMに依存しない）、`@app/render`（packages/render。WebGL2）、`@app/io`（packages/io。取り込み・保存）、`@app/tracking`（packages/tracking）、`@app/audio`（packages/audio）、`apps/desktop`（Tauri 2 + React）。
- パッケージから参照してよいのは `@app/schema` と `@app/contracts` だけ（同じパッケージの中は自由）。すべてを組み合わせるのは apps/desktop だけ。
- データは不変に扱い、更新は新しいオブジェクトを返す。
- ロジックには必ずユニットテストを付ける。

### 座標と値の約束

- 座標はキャンバス（元のPSD・PNG）のピクセル。原点は左上、x は右、y は下が正。
- 回転は度。画面上の時計回りが正。
- L / R はキャラクター自身から見た左右。画面では L が右側に描かれる。
- FaceAngleX はキャラクターが画面の右を向くと正、FaceAngleY は上を向くと正、FaceAngleZ は時計回りが正。EyeBallX は画面の右を見ると正、EyeBallY は上を見ると正。
- 基準状態 = 素材を配置しただけの状態 = 全パラメータがデフォルト値の状態。素材は「目を開け、口を閉じた」状態で描かれている前提。
- キーは基準状態からの差分。位置・回転・頂点は加算、拡縮・不透明度は倍率（1 = 変化なし）。

## 作るもの

- `types.ts` に下の型を、コメントも含めてそのまま定義する。
- `validate.ts`: zod で `validateProject(json: unknown): Project`。失敗したら項目のパス（例: `model.parts[3].pivot.x`）を含むエラーを投げる。
- `migrate.ts`: `SCHEMA_VERSION = 1`。`migrate(json)` は変換表（`{ [版]: (json) => json }`。v1 では空）で現在の版まで順に変換する。現在より新しい版はエラー。`loadProjectJson(text)` = 解析 → migrate → validate。
- `defaults.ts`: `createEmptyProject(name)`（MVP の標準パラメータと全パラメータグループ入り。lipSync は mouthSource 'max'・strength 'standard'・vowels 空。setupHints は両方 null。studio は空のシーン1つ）。`ensureStandardParameters(model, phase)`（足りない標準パラメータだけを足す。'step1' は MVP と STEP1、'step2' はすべて）。
- `rules.ts`: 下の「規則」を定義する。
- `ids.ts`: `newId()`（ULID）。

### 基本の型（@app/schema）

```ts
export type Id = string;
export interface Vec2 { x: number; y: number }
export type BlendMode = 'normal' | 'multiply' | 'screen' | 'add';
export type ParameterGroupId = 'face' | 'eye' | 'brow' | 'mouth' | 'cheek' | 'body' | 'armL' | 'armR' | 'sway' | 'other';
export type ModeId = 'modeling' | 'animation' | 'studio';
export type UiLevel = 'easy' | 'detail';
export function newId(): string;   // ULID
```

### Asset（@app/schema）

```ts
export interface Asset {
  id: Id;
  path: string;                    // 例: assets/<id>.png
  hash: string;                    // png の SHA-256（16進）
  width: number; height: number;   // トリミング後のサイズ
  offset: Vec2;                    // トリミング後の左上のキャンバス座標
  canvasSize: { width: number; height: number };
  source: { kind: 'psd' | 'png'; file: string; layerName?: string; layerPath?: string[]; hidden?: boolean };
  sourceBlendMode: BlendMode;
  sourceOpacity: number;           // 0..1
}
```

### Part と StandardPartType（@app/schema）

```ts
export interface Part {
  id: Id;
  name: string;
  kind: 'image' | 'group';
  standardType: StandardPartType | null;   // 自由パーツは null
  assetId: Id | null;                      // image のみ
  meshId: Id | null;                       // image のみ
  parentId: Id | null;
  position: Vec2;                          // 初期値 {x: 0, y: 0}
  rotation: number;                        // 度。初期値 0
  scale: Vec2;                             // 初期値 {x: 1, y: 1}
  pivot: Vec2;                             // 回転・拡縮の中心（キャンバス座標）
  opacity: number;                         // 0..1
  blendMode: BlendMode;
  depth: number;                           // 奥行き。手前が正（-1..1 が目安）
  mask: { sourcePartIds: Id[]; inverted: boolean } | null;
  physicsId: Id | null;
  visible: boolean;
  locked: boolean;
}
export type StandardPartType =
  | 'face' | 'earL' | 'earR' | 'cheek'
  | 'eyeWhiteL' | 'irisL' | 'highlightL' | 'upperLidL' | 'lowerLidL' | 'eyeWholeL'
  | 'eyeWhiteR' | 'irisR' | 'highlightR' | 'upperLidR' | 'lowerLidR' | 'eyeWholeR'
  | 'browL' | 'browR'
  | 'upperLip' | 'lowerLip' | 'mouthInside' | 'teeth' | 'tongue' | 'mouthWhole'
  | 'frontHair' | 'sideHairL' | 'sideHairR' | 'backHair'
  | 'neck' | 'torso' | 'armL' | 'armR'
  // 変形グループ（かんたんセットアップが作る）
  | 'bodyRoot' | 'armRootL' | 'armRootR' | 'neckRoot' | 'headRoot'
  | 'faceGroup' | 'eyeGroupL' | 'eyeGroupR' | 'mouthGroup';
```

### Mesh（@app/schema）

```ts
export interface Mesh {
  id: Id;
  vertices: Vec2[];                // 基準状態の頂点（キャンバス座標）
  uvs: Vec2[];                     // 0..1（素材画像の中の位置）
  triangles: [number, number, number][];
  density: 'light' | 'standard' | 'smooth' | 'custom';
  edited: boolean;                 // 手で編集したか
}
```

### Warp（@app/schema）

```ts
export interface Warp {
  id: Id;
  partId: Id;                      // ワープを付ける group パーツ
  columns: number; rows: number;   // 格子の分割数
  bounds: { x: number; y: number; width: number; height: number };   // キャンバス座標
  points: Vec2[];                  // (columns+1)×(rows+1) 個、行優先。基準状態の制御点
}
```

### Parameter と ParameterGroup（@app/schema）

```ts
export interface ParameterGroup { id: ParameterGroupId; name: string }
export interface Parameter {
  id: Id;                          // 標準は 'FaceAngleX' など。ユーザー定義は任意の文字列
  name: string;                    // 表示名
  groupId: ParameterGroupId;
  min: number; max: number; default: number;
  standard: boolean;
}
```

### Binding と ParameterKey（@app/schema）

```ts
export type Channel = 'transform' | 'vertices' | 'warpPoints';
export interface TransformDelta { position: Vec2; rotation: number; scale: Vec2; opacity: number }
// position・rotation は加算、scale・opacity は倍率（1 = 変化なし）
export interface Binding {
  id: Id;
  target: { type: 'part' | 'mesh' | 'warp'; id: Id };   // transform → part、vertices → mesh、warpPoints → warp
  channel: Channel;
  parameterIds: Id[];              // 1 または 2
  keyValues: number[][];           // パラメータごとのキー位置（昇順。デフォルト値を必ず含む）
  keys: ParameterKey[];
  generation: 'linear' | 'depth' | 'rotate' | 'surface' | 'ease';
  divisions: number | null;        // 中間キーの分割数（自動なら null）
}
export interface ParameterKey {
  coords: number[];                // parameterIds と同じ順の値
  delta: TransformDelta | Vec2[];  // transform は TransformDelta、それ以外は頂点・制御点ごとの差分
  source: 'manual' | 'auto' | 'generated' | 'combined';
  locked: boolean;
}
```

### Model と Project（@app/schema）

```ts
export interface Model {
  parts: Part[];
  meshes: Mesh[];
  warps: Warp[];
  drawOrder: Id[];                 // 画像パーツの id。背面 → 前面
  parameters: Parameter[];
  parameterGroups: ParameterGroup[];
  bindings: Binding[];
  lipSync: LipSync;
  setupHints: { closedLineL: Vec2[] | null; closedLineR: Vec2[] | null };   // かんたんセットアップ用（閉じた目の線。STEP1で使う）
}
export interface Project {
  schemaVersion: number;           // 現在は 1
  id: Id;
  name: string;
  assets: Asset[];
  model: Model;
  expressions: Expression[];
  animations: Animation[];
  physics: Physics[];
  trackingMappings: TrackingMapping[];   // 空なら既定のマッピング
  studio: { scenes: Scene[]; activeSceneId: Id | null; hotkeys: Hotkey[] };
}
```

### Expression（@app/schema）

```ts
export type BlendOp = 'override' | 'add' | 'multiply' | 'max';
export interface Expression {
  id: Id; name: string;
  entries: { parameterId: Id; value: number; blend: BlendOp }[];
  fadeIn: number; fadeOut: number;          // 秒
}
```

### LipSync（@app/schema）

```ts
export interface LipSync {
  mouthSource: 'max' | 'micOnly' | 'cameraOnly';
  strength: 'low' | 'standard' | 'high';
  vowels: { vowel: 'closed' | 'a' | 'i' | 'u' | 'e' | 'o'; values: Record<Id, number> }[];   // STEP2で使う
}
```

### Animation（@app/schema）

```ts
export interface Animation {
  id: Id; name: string;
  duration: number;                // 秒
  speed: number; loop: boolean;
  periodic: boolean;               // 周期アニメーションか
  tracks: { parameterId: Id; keyframes: { time: number; value: number; curve: 'linear' | 'smooth' | 'step' }[] }[];
  affectedGroups: ParameterGroupId[];      // 空なら自動（トラックのあるグループ）
  restart: 'restart' | 'ignore';
  transition: {
    preset: 'auto' | 'quick' | 'natural' | 'slow' | 'custom';
    blendIn: number; blendOut: number;     // 秒
    curve: 'linear' | 'smooth';
    blendMode: 'override' | 'addToTracking';
    keepLipSync: boolean; keepPhysics: boolean; returnToTracking: boolean;
  };
}
```

### Physics（@app/schema）

```ts
export interface Physics {
  id: Id; partId: Id;              // 根元の位置はこのパーツの pivot
  preset: 'hair' | 'cloth' | 'ribbon' | 'accessory';
  strength: number;                // 0..1（かんたん設定の「揺れ方」）
  direction: 'horizontal' | 'vertical' | 'both';
  length: number;                  // px
  spring: number; damping: number; gravity: number; inertia: number; range: number;
  inputs: { parameterId: Id; weight: number }[];
  outputParameterId: Id;
}
```

### TrackingMapping（@app/schema）

```ts
export type TrackingInput = 'faceYaw' | 'facePitch' | 'faceRoll' | 'eyeOpenL' | 'eyeOpenR' | 'eyeBallX' | 'eyeBallY'
  | 'mouthOpen' | 'mouthForm' | 'mouthWidth' | 'browY';
export interface TrackingMapping {
  input: TrackingInput; parameterId: Id;
  inputRange: [number, number]; outputRange: [number, number];
  invert: boolean; curve: 'linear' | 'smooth';
  smoothing: number;               // 0..1
  deadZone: number;                // 入力の単位
}
```

### Scene と Hotkey（@app/schema）

```ts
export interface Scene {
  id: Id; name: string;
  background: { type: 'transparent' } | { type: 'color'; color: string } | { type: 'image'; path: string };   // path はプロジェクトからの相対パス
  modelTransform: { position: Vec2; scale: number };   // 出力画面での位置（px）と倍率
  expressionIds: Id[];             // シーンに切り替えたときに適用する表情
  periodicAnimationIds: Id[];      // STEP2で使う
}
export interface Hotkey {
  id: Id;
  keys: string;                    // 例: 'Ctrl+Shift+1'
  action: 'expression' | 'scene' | 'background' | 'animation' | 'parameter' | 'pauseTracking' | 'recalibrate';
  targetId: Id | null;
  mode: 'toggle' | 'hold';
}
```

### Environment（@app/schema。PCごとの設定でプロジェクトの外に保存）

```ts
export interface Environment {
  cameraDeviceId: string | null;
  mirror: boolean;
  calibration: { neutral: { yaw: number; pitch: number; roll: number }; eyeClosed: { l: number; r: number }; mouthOpenMax: number } | null;
  microphoneDeviceId: string | null;
  silenceThreshold: number;        // dBFS
  trackingPreset: 'stable' | 'standard' | 'large' | 'custom';
  output: { method: 'window' | 'spout2'; width: number; height: number; fps: number };
  uiLevel: Record<ModeId, UiLevel>;
  lastProjectDir: string | null;
}
```

### スキーマの関数（@app/schema）

```ts
export const SCHEMA_VERSION = 1;
export function validateProject(json: unknown): Project;       // 失敗時は項目のパス付きのエラー
export function migrate(json: unknown): unknown;               // 古い版を現在の版へ変換
export function loadProjectJson(text: string): Project;        // 解析 → migrate → validate
export function createEmptyProject(name: string): Project;     // MVPの標準パラメータ入り
export function ensureStandardParameters(model: Model, phase: 'mvp' | 'step1' | 'step2'): Model;
```

### 規則（@app/schema の rules.ts）

```ts
export const STANDARD_PARAMETERS: Parameter[];                      // 標準パラメータの表（standard: true）
export const PARAMETER_GROUPS: ParameterGroup[];                    // face 顔 / eye 目 / brow 眉 / mouth 口 / cheek 頬 / body 体 / armL 左腕 / armR 右腕 / sway 揺れもの / other その他
export const STANDARD_PART_NAMES: Record<StandardPartType, string>; // 日本語の表示名（例: eyeWhiteL → 白目 L）
export const STANDARD_DRAW_ORDER: StandardPartType[];               // 背面 → 前面（下記）
export const DEFAULT_DEPTH: Partial<Record<StandardPartType, number>>;   // 下記
export const PARALLAX_RATIO = 0.08;
// 奥行きによる移動量（px）。faceWidth は standardType 'face' の素材の幅
export function depthParallaxOffset(depth: number, value: number, faceWidth: number, axis: 'x' | 'y'): number {
  const d = depth * (value / 30) * faceWidth * PARALLAX_RATIO;
  return axis === 'x' ? d : -d;    // y は上が負
}
```

- STANDARD_DRAW_ORDER（背面 → 前面）: backHair, torso, armL, armR, neck, earL, earR, face, cheek, mouthInside, teeth, tongue, upperLip, lowerLip, mouthWhole, eyeWhiteL, eyeWhiteR, eyeWholeL, eyeWholeR, irisL, irisR, highlightL, highlightR, lowerLidL, lowerLidR, upperLidL, upperLidR, browL, browR, sideHairL, sideHairR, frontHair
- DEFAULT_DEPTH: frontHair 1.0 / browL・browR 0.6 / 目のパーツ（eyeWhite・iris・highlight・upperLid・lowerLid・eyeWhole の L・R）0.5 / 口のパーツ（upperLip・lowerLip・mouthInside・teeth・tongue・mouthWhole）0.5 / sideHairL・sideHairR 0.4 / cheek 0.4 / face 0.2 / earL・earR −0.5 / backHair −1.0

### 標準パラメータ（STANDARD_PARAMETERS）

| id | 表示名 | group | min | max | default | フェーズ |
| --- | --- | --- | --- | --- | --- | --- |
| FaceAngleX | 顔 左右 | face | -30 | 30 | 0 | MVP |
| FaceAngleY | 顔 上下 | face | -30 | 30 | 0 | MVP |
| FaceAngleZ | 顔 傾き | face | -30 | 30 | 0 | MVP |
| EyeOpenL / EyeOpenR | 目 開閉 L / R | eye | 0 | 1 | 1 | MVP |
| EyeBallX / EyeBallY | 瞳 左右 / 上下 | eye | -1 | 1 | 0 | MVP |
| MouthOpen | 口 開閉 | mouth | 0 | 1 | 0 | MVP |
| EyeSmileL / EyeSmileR | 目 笑顔 L / R | eye | 0 | 1 | 0 | STEP1 |
| BrowYL / BrowYR | 眉 上下 L / R | brow | -1 | 1 | 0 | STEP1 |
| BrowFormL / BrowFormR | 眉 形 L / R（困り〜怒り） | brow | -1 | 1 | 0 | STEP1 |
| MouthForm | 口 形（への字〜笑顔） | mouth | -1 | 1 | 0 | STEP1 |
| MouthWidth | 口 横幅（すぼめ〜横に開く） | mouth | -1 | 1 | 0 | STEP1 |
| Cheek | 頬染め | cheek | 0 | 1 | 0 | STEP1 |
| BodyAngleX / BodyAngleY / BodyAngleZ | 体 左右 / 上下 / 傾き | body | -10 | 10 | 0 | STEP1 |
| Breath | 呼吸 | body | 0 | 1 | 0 | STEP2 |
| ArmL / ArmR | 腕 L / R | armL / armR | -1 | 1 | 0 | STEP2 |
| HairFront / HairSide / HairBack | 髪揺れ 前 / 横 / 後ろ | sway | -1 | 1 | 0 | STEP2 |

## 作らないもの

実行時の処理（評価・描画など）。

## 完了条件

- [ ] createEmptyProject の結果が validateProject を通る
- [ ] 型が違う項目でパス付きのエラーになる
- [ ] v1 の migrate が何も変えず、v2 のファイルはエラーになる
- [ ] ensureStandardParameters が足りないものだけを足す
- [ ] STANDARD_PARAMETERS が表と一致する（id・範囲・デフォルト値・グループ）
- [ ] depthParallaxOffset の符号（奥行きが正で値が正のとき、x は正・y は負）


---

# 03. 実行時の契約と仮実装

> このカードだけで実装できるように、必要な仕様・型・約束をすべて書いている。ほかのカードや設計書を読む必要はない。「前提」に書いたものは、このカードの時点で必ずある。名前と形を変えないこと。

| 項目 | 内容 |
| --- | --- |
| フェーズ / 段階 | MVP / M0 基盤 |
| 並行作業 | 直列。前の番号のカードが終わってから始める |
| 担当の目安 | 基盤 |
| 作業場所 | packages/contracts/src/、fixtures/sample-model/ |

## 目的

部品どうしをつなぐインターフェースを確定させ、仮実装を用意する。これで部品のカードが互いを待たずに作れる。

## 前提（このカードの時点ですでにあるもの）

`@app/schema` に型・検証・既定値・規則がある（下に抜粋）。

### リポジトリの約束

- pnpm ワークスペースのモノレポ。TypeScript は strict、テストは Vitest。
- パッケージ: `@app/schema`（packages/schema。データ型・検証・既定値・規則）、`@app/contracts`（packages/contracts。実行時のインターフェースと仮実装）、`@app/core`（packages/core。評価・変形・生成・合成・ストア。DOMに依存しない）、`@app/render`（packages/render。WebGL2）、`@app/io`（packages/io。取り込み・保存）、`@app/tracking`（packages/tracking）、`@app/audio`（packages/audio）、`apps/desktop`（Tauri 2 + React）。
- パッケージから参照してよいのは `@app/schema` と `@app/contracts` だけ（同じパッケージの中は自由）。すべてを組み合わせるのは apps/desktop だけ。
- データは不変に扱い、更新は新しいオブジェクトを返す。
- ロジックには必ずユニットテストを付ける。

### Model と Project（@app/schema）

```ts
export interface Model {
  parts: Part[];
  meshes: Mesh[];
  warps: Warp[];
  drawOrder: Id[];                 // 画像パーツの id。背面 → 前面
  parameters: Parameter[];
  parameterGroups: ParameterGroup[];
  bindings: Binding[];
  lipSync: LipSync;
  setupHints: { closedLineL: Vec2[] | null; closedLineR: Vec2[] | null };   // かんたんセットアップ用（閉じた目の線。STEP1で使う）
}
export interface Project {
  schemaVersion: number;           // 現在は 1
  id: Id;
  name: string;
  assets: Asset[];
  model: Model;
  expressions: Expression[];
  animations: Animation[];
  physics: Physics[];
  trackingMappings: TrackingMapping[];   // 空なら既定のマッピング
  studio: { scenes: Scene[]; activeSceneId: Id | null; hotkeys: Hotkey[] };
}
```

### Binding と ParameterKey（@app/schema）

```ts
export type Channel = 'transform' | 'vertices' | 'warpPoints';
export interface TransformDelta { position: Vec2; rotation: number; scale: Vec2; opacity: number }
// position・rotation は加算、scale・opacity は倍率（1 = 変化なし）
export interface Binding {
  id: Id;
  target: { type: 'part' | 'mesh' | 'warp'; id: Id };   // transform → part、vertices → mesh、warpPoints → warp
  channel: Channel;
  parameterIds: Id[];              // 1 または 2
  keyValues: number[][];           // パラメータごとのキー位置（昇順。デフォルト値を必ず含む）
  keys: ParameterKey[];
  generation: 'linear' | 'depth' | 'rotate' | 'surface' | 'ease';
  divisions: number | null;        // 中間キーの分割数（自動なら null）
}
export interface ParameterKey {
  coords: number[];                // parameterIds と同じ順の値
  delta: TransformDelta | Vec2[];  // transform は TransformDelta、それ以外は頂点・制御点ごとの差分
  source: 'manual' | 'auto' | 'generated' | 'combined';
  locked: boolean;
}
```

### スキーマの関数（@app/schema）

```ts
export const SCHEMA_VERSION = 1;
export function validateProject(json: unknown): Project;       // 失敗時は項目のパス付きのエラー
export function migrate(json: unknown): unknown;               // 古い版を現在の版へ変換
export function loadProjectJson(text: string): Project;        // 解析 → migrate → validate
export function createEmptyProject(name: string): Project;     // MVPの標準パラメータ入り
export function ensureStandardParameters(model: Model, phase: 'mvp' | 'step1' | 'step2'): Model;
```

## 作るもの

- `index.ts` に下のインターフェースをそのまま定義する（スキーマの型は `@app/schema` から import する）。
- `fakes/` に下の仮実装を作る。
- `assets.ts` に `createAssetRepository()` の本物の実装（PNG を createImageBitmap で画像にし、ImageData は OffscreenCanvas で取り出す）。
- `fixtures/sample-model/`: 生成スクリプト（Node + @napi-rs/canvas）で単純な図形のテスト用素材を作る。キャンバスは 1000×1500px。顔・耳・白目・瞳・ハイライト・上下まぶた・眉・上下唇・口の中・歯・舌・前髪・横髪・後ろ髪・首・胴体・腕を、目を開け口を閉じた状態で描く。標準パーツへの割り当てだけ済んだ project.json（階層・バインディングなし）も出力する。

### 評価の契約（@app/contracts）

```ts
export type ParamValues = Record<string, number>;
export interface TargetDeltas {
  transforms: Record<string, TransformDelta>;   // partId → 合成済みの差分
  vertices: Record<string, Float32Array>;        // meshId → [dx0, dy0, dx1, dy1, ...]
  warpPoints: Record<string, Float32Array>;      // warpId → 制御点の差分（同じ並び）
}
export interface BindingEvaluator { evaluate(model: Model, params: ParamValues): TargetDeltas }
```

### 変形の契約（@app/contracts）

```ts
export interface DrawItem {
  partId: string; assetId: string;
  positions: Float32Array;         // 変形後の頂点（キャンバス座標）[x0, y0, x1, y1, ...]
  uvs: Float32Array;               // [u0, v0, ...]（0..1）
  indices: Uint32Array;
  opacity: number;                 // 親まで掛けた最終値
  blendMode: BlendMode;
  mask: { sourcePartIds: string[]; inverted: boolean } | null;
}
export interface DeformedModel {
  items: DrawItem[];               // 描画順（背面 → 前面）。非表示のパーツは含めない
  byPartId: Record<string, DrawItem>;
}
export interface DeformPipeline { deform(model: Model, deltas: TargetDeltas): DeformedModel }
```

### 合成の契約（@app/contracts）

```ts
export type LayerId = 'tracking' | 'bodyFollow' | 'expression' | 'animation' | 'lipSync' | 'periodic' | 'physics';
export const LAYER_ORDER: LayerId[] = ['tracking', 'bodyFollow', 'expression', 'animation', 'lipSync', 'periodic', 'physics'];
export interface Layer {
  id: LayerId;
  weight: number;                     // 0..1
  values: ParamValues;                // このレイヤーが担当するパラメータの値だけ
  blend?: Record<string, BlendOp>;    // パラメータごとの合成方法。無ければ override
}
export interface ParameterMixer { mix(parameters: Parameter[], layers: Layer[]): ParamValues }

// スタジオの1フレームの文脈。producer は LAYER_ORDER の順に呼ばれる
export interface FrameContext {
  now: number; dt: number;            // ミリ秒
  project: Project;
  mixedSoFar: ParamValues;            // それまでのレイヤーを合成した値
  flags: { lipSyncWeight: number; physicsActive: boolean };   // 前のレイヤーが後のレイヤーへ伝える値（初期値 1・true）
}
export interface LayerProducer { id: LayerId; produce(ctx: FrameContext): Layer | null }
```

### 描画の契約（@app/contracts）

```ts
export type Background = { type: 'transparent' } | { type: 'color'; color: string } | { type: 'image'; image: ImageBitmap };
export interface ViewTransform { scale: number; offset: Vec2 }   // 画面座標（CSSピクセル）= キャンバス座標 × scale + offset
export interface Renderer {
  init(canvas: HTMLCanvasElement): void;
  setTextures(images: Record<string, ImageBitmap>): void;       // assetId → 画像
  render(model: DeformedModel, view: ViewTransform, background: Background): void;
  dispose(): void;
}
```

### ストアの契約（@app/contracts）

```ts
export interface Command { label: string; apply(project: Project): Project }   // 純粋関数
export interface ProjectStore {
  get(): Project;
  subscribe(listener: (project: Project) => void): () => void;
  dispatch(command: Command): void;                                          // 1回の Undo 単位
  transaction(label: string, run: (dispatch: (c: Command) => void) => void): void;   // まとめて1回の Undo
  undo(): void; redo(): void; canUndo(): boolean; canRedo(): boolean;
  load(project: Project): void;                                              // 履歴を消して置き換える
}
export interface EditorState {
  mode: ModeId;
  uiLevel: Record<ModeId, UiLevel>;
  selectedPartIds: string[];
  activeParameterIds: string[];        // 編集中のパラメータ（0〜2個）
  editorParamValues: ParamValues;      // モデリング中のプレビュー値（無いパラメータはデフォルト値）
}
export interface EditorStore { get(): EditorState; set(patch: Partial<EditorState>): void; subscribe(l: (s: EditorState) => void): () => void }
```

### 素材の置き場の契約（@app/contracts）

```ts
export interface AssetRepository {
  put(assetId: string, png: Uint8Array): Promise<void>;   // 画像も作って保持する
  getPng(assetId: string): Uint8Array | undefined;
  getImage(assetId: string): ImageBitmap | undefined;
  getImageData(assetId: string): ImageData | undefined;   // メッシュ生成などに使う
  all(): Record<string, Uint8Array>;
  subscribe(listener: () => void): () => void;
}
export function createAssetRepository(): AssetRepository;   // 本物の実装
```

### 取り込み・保存の契約（@app/contracts）

```ts
export interface FileSystem {          // パスは / 区切りの絶対パス
  readText(path: string): Promise<string>; writeText(path: string, data: string): Promise<void>;
  readBinary(path: string): Promise<Uint8Array>; writeBinary(path: string, data: Uint8Array): Promise<void>;
  exists(path: string): Promise<boolean>; mkdir(path: string): Promise<void>;
  list(dir: string): Promise<string[]>; remove(path: string): Promise<void>; rename(from: string, to: string): Promise<void>;
}
export interface ImportedAsset { asset: Asset; png: Uint8Array }   // png はトリミング済み
export interface ImportWarning { kind: 'canvasMismatch' | 'noTransparency' | 'resolution' | 'needsMerge'; assetIds: string[]; layerNames: string[]; message: string }
export interface Importer { importFiles(files: { name: string; data: Uint8Array }[]): Promise<{ assets: ImportedAsset[]; warnings: ImportWarning[] }> }
export interface ProjectIO {
  save(dir: string, project: Project, assetPngs: Record<string, Uint8Array>): Promise<void>;
  load(dir: string): Promise<{ project: Project; assetPngs: Record<string, Uint8Array> }>;
}
export interface AutoSaver { start(dir: string): void; stop(): void; findRecoverable(dir: string): Promise<string | null> }
```

### メッシュ生成の契約（@app/contracts）

```ts
export interface MeshGenerator {
  generate(alpha: ImageData, offset: Vec2, density: 'light' | 'standard' | 'smooth'):
    { vertices: Vec2[]; uvs: Vec2[]; triangles: [number, number, number][] };   // 頂点はキャンバス座標
}
```

### 生成・セットアップの契約（@app/contracts）

```ts
export interface KeyGenerator {
  linear(binding: Binding, divisions?: number): Binding;
  depthParallax(model: Model, parameterId: 'FaceAngleX' | 'FaceAngleY'): Binding[];   // 作り直した transform バインディング
}
export interface AutoSetup { plan(project: Project): { command: Command; warnings: string[] } }
```

### キー編集の契約（@app/contracts）

```ts
export type TransformChange = { dPosition?: Vec2; dRotation?: number; scaleFactor?: Vec2; opacityFactor?: number; dPivot?: Vec2 };
export type PointsTarget = { kind: 'mesh'; meshId: string } | { kind: 'warp'; warpId: string };
export interface KeyEditor {
  // EditorState の activeParameterIds と editorParamValues に応じて、基準状態かキーを変えるコマンドを返す
  transformEdit(project: Project, editor: EditorState, partIds: string[], change: TransformChange): Command | 'needsKey';
  pointsEdit(project: Project, editor: EditorState, target: PointsTarget, moves: { index: number; d: Vec2 }[]): Command | 'needsKey';
  addKeyAtCurrentValue(project: Project, editor: EditorState, target: { partId: string } | PointsTarget): Command;
}
```

### トラッキングの契約（@app/contracts）

```ts
export interface TrackingFrame {
  time: number;                    // ミリ秒（performance.now）
  detected: boolean;
  faceYaw: number;                 // 度。ユーザーが自分の右を向くと正
  facePitch: number;               // 度。上を向くと正
  faceRoll: number;                // 度。ユーザーが自分の右へ傾けると正
  eyeOpenL: number; eyeOpenR: number;   // 0..1。ユーザー自身の左目・右目
  eyeBallX: number;                // -1..1。ユーザーが自分の右を見ると正
  eyeBallY: number;                // -1..1。上を見ると正
  mouthOpen: number;               // 0..1
}
export interface TrackingSource {
  listDevices(): Promise<{ id: string; label: string }[]>;
  start(deviceId?: string): Promise<void>;
  stop(): void;
  onFrame(listener: (frame: TrackingFrame) => void): () => void;
}
export interface TrackingLayerProducer {
  update(frame: TrackingFrame): void;
  tick(now: number): Layer;        // id 'tracking'
  status(): 'tracking' | 'lost';
  setMirror(on: boolean): void;
  setLostBehavior(b: 'returnToFront' | 'hold'): void;
}
```

### サービスのまとめ（@app/contracts）

```ts
export interface Services {
  store: ProjectStore; editor: EditorStore; assets: AssetRepository; fs: FileSystem;
  evaluator: BindingEvaluator; pipeline: DeformPipeline; mixer: ParameterMixer; createRenderer(): Renderer;
  meshGenerator: MeshGenerator; keyGenerator: KeyGenerator; autoSetup: AutoSetup; keyEditor: KeyEditor;
  importer: Importer; io: ProjectIO; autoSaver: AutoSaver;
  tracking: TrackingSource; trackingLayer: TrackingLayerProducer;
}
```

### 仮実装（@app/contracts の fakes）

- FakeEvaluator: 差分なし（すべて空）を返す。
- FakePipeline: 表示中の画像パーツを、素材の矩形（offset と幅・高さ）を覆う三角形2枚にし、自身のパーツの基本の変形だけを掛ける。順番は drawOrder。
- FakeRenderer: Canvas 2D で、各 DrawItem の画像を頂点の外接矩形に drawImage する。
- FakeMixer: デフォルト値に、各レイヤーの値を重みで上書きする。
- FakeTrackingSource: 30fps で顔をゆっくり左右に振る TrackingFrame を出す。20秒ごとに2秒間 detected を false にする。
- FakeTrackingLayer: フレームの値をそのままパラメータに写す（ミラー・スムージングなし）。
- FakeImporter: PNG だけを読み、トリミングせず offset (0,0) で返す。
- MemoryFileSystem、FakeProjectIO（メモリに保存）、FakeAutoSaver（何もしない）。
- FakeMeshGenerator: 画像全体を覆う四角形（三角形2枚）。
- FakeKeyGenerator・FakeAutoSetup: 何も変えないコマンド・バインディングを返す。
- FakeKeyEditor: 常に基準状態（Part の position・rotation・scale・pivot・opacity、メッシュの基準頂点）を変えるコマンドを返す。
- fixtures/sample-model: 単純な図形で描いたテスト用素材（1000×1500px、標準パーツ一式）と、割り当てだけ済んだ project.json。

## 作らないもの

本物の評価・描画・推定など（仮実装だけ）。

## 完了条件

- [ ] 型検査が通る
- [ ] 仮実装それぞれに簡単なテストがある
- [ ] fixtures の project.json が validateProject を通る


---

# 04. ストアとコマンド（Undo / Redo）

> このカードだけで実装できるように、必要な仕様・型・約束をすべて書いている。ほかのカードや設計書を読む必要はない。「前提」に書いたものは、このカードの時点で必ずある。名前と形を変えないこと。

| 項目 | 内容 |
| --- | --- |
| フェーズ / 段階 | MVP / M0 基盤 |
| 並行作業 | 直列。前の番号のカードが終わってから始める |
| 担当の目安 | 基盤 |
| 作業場所 | packages/core/src/store/ |

## 目的

すべての編集をコマンドとして扱い、Undo / Redo できる状態の入れ物を作る。

## 前提（このカードの時点ですでにあるもの）

`@app/contracts` に Command・ProjectStore・EditorStore のインターフェースがある（下）。

抜粋に名前だけ出てくる型も、すべて `@app/schema` か `@app/contracts` から import できる。

### リポジトリの約束

- pnpm ワークスペースのモノレポ。TypeScript は strict、テストは Vitest。
- パッケージ: `@app/schema`（packages/schema。データ型・検証・既定値・規則）、`@app/contracts`（packages/contracts。実行時のインターフェースと仮実装）、`@app/core`（packages/core。評価・変形・生成・合成・ストア。DOMに依存しない）、`@app/render`（packages/render。WebGL2）、`@app/io`（packages/io。取り込み・保存）、`@app/tracking`（packages/tracking）、`@app/audio`（packages/audio）、`apps/desktop`（Tauri 2 + React）。
- パッケージから参照してよいのは `@app/schema` と `@app/contracts` だけ（同じパッケージの中は自由）。すべてを組み合わせるのは apps/desktop だけ。
- データは不変に扱い、更新は新しいオブジェクトを返す。
- ロジックには必ずユニットテストを付ける。

### Model と Project（@app/schema）

```ts
export interface Model {
  parts: Part[];
  meshes: Mesh[];
  warps: Warp[];
  drawOrder: Id[];                 // 画像パーツの id。背面 → 前面
  parameters: Parameter[];
  parameterGroups: ParameterGroup[];
  bindings: Binding[];
  lipSync: LipSync;
  setupHints: { closedLineL: Vec2[] | null; closedLineR: Vec2[] | null };   // かんたんセットアップ用（閉じた目の線。STEP1で使う）
}
export interface Project {
  schemaVersion: number;           // 現在は 1
  id: Id;
  name: string;
  assets: Asset[];
  model: Model;
  expressions: Expression[];
  animations: Animation[];
  physics: Physics[];
  trackingMappings: TrackingMapping[];   // 空なら既定のマッピング
  studio: { scenes: Scene[]; activeSceneId: Id | null; hotkeys: Hotkey[] };
}
```

### ストアの契約（@app/contracts）

```ts
export interface Command { label: string; apply(project: Project): Project }   // 純粋関数
export interface ProjectStore {
  get(): Project;
  subscribe(listener: (project: Project) => void): () => void;
  dispatch(command: Command): void;                                          // 1回の Undo 単位
  transaction(label: string, run: (dispatch: (c: Command) => void) => void): void;   // まとめて1回の Undo
  undo(): void; redo(): void; canUndo(): boolean; canRedo(): boolean;
  load(project: Project): void;                                              // 履歴を消して置き換える
}
export interface EditorState {
  mode: ModeId;
  uiLevel: Record<ModeId, UiLevel>;
  selectedPartIds: string[];
  activeParameterIds: string[];        // 編集中のパラメータ（0〜2個）
  editorParamValues: ParamValues;      // モデリング中のプレビュー値（無いパラメータはデフォルト値）
}
export interface EditorStore { get(): EditorState; set(patch: Partial<EditorState>): void; subscribe(l: (s: EditorState) => void): () => void }
```

## 作るもの

- `createProjectStore(initial: Project): ProjectStore` と `createEditorStore(initial?: Partial<EditorState>): EditorStore`。
- dispatch: `command.apply(現在)` を新しい状態にし、前の状態を履歴に積む。結果が同じ参照なら何もしない。
- transaction: 中の dispatch をまとめて1回の Undo にする。入れ子はいちばん外側にまとめる。中で例外が出たら開始前の状態に戻し、例外を投げ直す。
- undo / redo: 履歴は最大200件。新しい dispatch で redo の履歴を消す。
- load: 状態を置き換え、履歴を消す。
- subscribe: 状態が変わるたびに同期で通知する。解除関数を返す。
- 補助関数: `modelCommand(label, fn: (model: Model) => Model): Command`、`patchPart(label, partId, patch: Partial<Part>): Command`。
- EditorState の初期値: mode 'modeling'、uiLevel はすべて 'easy'、selectedPartIds []、activeParameterIds []、editorParamValues {}。

## 作らないもの

個別の編集コマンド（各機能のカードが作る）。

## 完了条件

- [ ] dispatch → undo → redo で状態が行き来する
- [ ] transaction が1回の Undo になり、例外で元に戻る
- [ ] 新しい dispatch で redo が消える
- [ ] 履歴が200件を超えると古いものから消える
- [ ] load で履歴が消える


---

# 05. アプリの枠（モード・パネル・差し込み口）

> このカードだけで実装できるように、必要な仕様・型・約束をすべて書いている。ほかのカードや設計書を読む必要はない。「前提」に書いたものは、このカードの時点で必ずある。名前と形を変えないこと。

| 項目 | 内容 |
| --- | --- |
| フェーズ / 段階 | MVP / M0 基盤 |
| 並行作業 | 直列。前の番号のカードが終わってから始める |
| 担当の目安 | 基盤 |
| 作業場所 | apps/desktop/src/shell/、apps/desktop/src/services.ts |

## 目的

3つのモードの画面の枠と、部品を差し込む口（パネル・セクション・キャンバスのツール・メニュー・サービス・イベント）を作る。

## 前提（このカードの時点ですでにあるもの）

`@app/contracts` のインターフェースと仮実装、`@app/core` のストア（createProjectStore・createEditorStore）がある。

抜粋に名前だけ出てくる型も、すべて `@app/schema` か `@app/contracts` から import できる。

### リポジトリの約束

- pnpm ワークスペースのモノレポ。TypeScript は strict、テストは Vitest。
- パッケージ: `@app/schema`（packages/schema。データ型・検証・既定値・規則）、`@app/contracts`（packages/contracts。実行時のインターフェースと仮実装）、`@app/core`（packages/core。評価・変形・生成・合成・ストア。DOMに依存しない）、`@app/render`（packages/render。WebGL2）、`@app/io`（packages/io。取り込み・保存）、`@app/tracking`（packages/tracking）、`@app/audio`（packages/audio）、`apps/desktop`（Tauri 2 + React）。
- パッケージから参照してよいのは `@app/schema` と `@app/contracts` だけ（同じパッケージの中は自由）。すべてを組み合わせるのは apps/desktop だけ。
- データは不変に扱い、更新は新しいオブジェクトを返す。
- ロジックには必ずユニットテストを付ける。

### ストアの契約（@app/contracts）

```ts
export interface Command { label: string; apply(project: Project): Project }   // 純粋関数
export interface ProjectStore {
  get(): Project;
  subscribe(listener: (project: Project) => void): () => void;
  dispatch(command: Command): void;                                          // 1回の Undo 単位
  transaction(label: string, run: (dispatch: (c: Command) => void) => void): void;   // まとめて1回の Undo
  undo(): void; redo(): void; canUndo(): boolean; canRedo(): boolean;
  load(project: Project): void;                                              // 履歴を消して置き換える
}
export interface EditorState {
  mode: ModeId;
  uiLevel: Record<ModeId, UiLevel>;
  selectedPartIds: string[];
  activeParameterIds: string[];        // 編集中のパラメータ（0〜2個）
  editorParamValues: ParamValues;      // モデリング中のプレビュー値（無いパラメータはデフォルト値）
}
export interface EditorStore { get(): EditorState; set(patch: Partial<EditorState>): void; subscribe(l: (s: EditorState) => void): () => void }
```

### 描画の契約（@app/contracts）

```ts
export type Background = { type: 'transparent' } | { type: 'color'; color: string } | { type: 'image'; image: ImageBitmap };
export interface ViewTransform { scale: number; offset: Vec2 }   // 画面座標（CSSピクセル）= キャンバス座標 × scale + offset
export interface Renderer {
  init(canvas: HTMLCanvasElement): void;
  setTextures(images: Record<string, ImageBitmap>): void;       // assetId → 画像
  render(model: DeformedModel, view: ViewTransform, background: Background): void;
  dispose(): void;
}
```

### 変形の契約（@app/contracts）

```ts
export interface DrawItem {
  partId: string; assetId: string;
  positions: Float32Array;         // 変形後の頂点（キャンバス座標）[x0, y0, x1, y1, ...]
  uvs: Float32Array;               // [u0, v0, ...]（0..1）
  indices: Uint32Array;
  opacity: number;                 // 親まで掛けた最終値
  blendMode: BlendMode;
  mask: { sourcePartIds: string[]; inverted: boolean } | null;
}
export interface DeformedModel {
  items: DrawItem[];               // 描画順（背面 → 前面）。非表示のパーツは含めない
  byPartId: Record<string, DrawItem>;
}
export interface DeformPipeline { deform(model: Model, deltas: TargetDeltas): DeformedModel }
```

### サービスのまとめ（@app/contracts）

```ts
export interface Services {
  store: ProjectStore; editor: EditorStore; assets: AssetRepository; fs: FileSystem;
  evaluator: BindingEvaluator; pipeline: DeformPipeline; mixer: ParameterMixer; createRenderer(): Renderer;
  meshGenerator: MeshGenerator; keyGenerator: KeyGenerator; autoSetup: AutoSetup; keyEditor: KeyEditor;
  importer: Importer; io: ProjectIO; autoSaver: AutoSaver;
  tracking: TrackingSource; trackingLayer: TrackingLayerProducer;
}
```

### 仮実装（@app/contracts の fakes）

- FakeEvaluator: 差分なし（すべて空）を返す。
- FakePipeline: 表示中の画像パーツを、素材の矩形（offset と幅・高さ）を覆う三角形2枚にし、自身のパーツの基本の変形だけを掛ける。順番は drawOrder。
- FakeRenderer: Canvas 2D で、各 DrawItem の画像を頂点の外接矩形に drawImage する。
- FakeMixer: デフォルト値に、各レイヤーの値を重みで上書きする。
- FakeTrackingSource: 30fps で顔をゆっくり左右に振る TrackingFrame を出す。20秒ごとに2秒間 detected を false にする。
- FakeTrackingLayer: フレームの値をそのままパラメータに写す（ミラー・スムージングなし）。
- FakeImporter: PNG だけを読み、トリミングせず offset (0,0) で返す。
- MemoryFileSystem、FakeProjectIO（メモリに保存）、FakeAutoSaver（何もしない）。
- FakeMeshGenerator: 画像全体を覆う四角形（三角形2枚）。
- FakeKeyGenerator・FakeAutoSetup: 何も変えないコマンド・バインディングを返す。
- FakeKeyEditor: 常に基準状態（Part の position・rotation・scale・pivot・opacity、メッシュの基準頂点）を変えるコマンドを返す。
- fixtures/sample-model: 単純な図形で描いたテスト用素材（1000×1500px、標準パーツ一式）と、割り当てだけ済んだ project.json。

### Environment（@app/schema。PCごとの設定でプロジェクトの外に保存）

```ts
export interface Environment {
  cameraDeviceId: string | null;
  mirror: boolean;
  calibration: { neutral: { yaw: number; pitch: number; roll: number }; eyeClosed: { l: number; r: number }; mouthOpenMax: number } | null;
  microphoneDeviceId: string | null;
  silenceThreshold: number;        // dBFS
  trackingPreset: 'stable' | 'standard' | 'large' | 'custom';
  output: { method: 'window' | 'spout2'; width: number; height: number; fps: number };
  uiLevel: Record<ModeId, UiLevel>;
  lastProjectDir: string | null;
}
```

## 作るもの

- ヘッダー: [モデリング][アニメーション][スタジオ] の切り替え。かんたん/詳細の切り替えボタンは置くが STEP1 まで非表示にする（状態は EditorState.uiLevel にモードごとに持つ）。
- レイアウト: 各モードに left・right・bottom の領域。registerPanel したパネルを order 順に並べる。level が 'detail' のパネルとセクションは、そのモードの uiLevel が 'detail' のときだけ出す。
- モデリングの中央はキャンバスホスト。services の evaluator → pipeline → renderer で、EditorState.editorParamValues の状態を描く（プロジェクトか EditorState が変わったときだけ描き直す）。ホイールで拡大縮小、スペース＋ドラッグか中ボタンで移動、[全体を表示]。registerCanvasTool したツールを切り替え、pointer イベントをキャンバス座標に直してアクティブなツールへ渡す。オーバーレイは 2D Canvas を重ねて描く。
- スタジオとアニメーションの中央は registerCenter で差し込む。
- セットアップ画面: プロジェクトに素材が1つも無いとき、registerSetupScreen された画面を中央に出す。
- メニュー: registerMenuItem したものを並べる。Ctrl+Z は undo、Ctrl+Shift+Z と Ctrl+Y は redo を枠が処理する。
- 環境設定: useEnvironment は Tauri のアプリ設定フォルダの `environment.json` に読み書きする。既定値は cameraDeviceId null、mirror true、calibration null、microphoneDeviceId null、silenceThreshold −50、trackingPreset 'standard'、output {method 'window'、1920×1080、60fps}、uiLevel はすべて 'easy'、lastProjectDir null。
- アプリイベント: emitAppEvent・onAppEvent（名前と任意の値）。
- `src/services.ts`: 仮実装と本物のストアで Services を組み立てる。この1ファイルを差し替えるだけで本物に切り替わる構造にする。
- useDialogs: 確認・通知・入力のダイアログ。

### アプリの枠の差し込み口（apps/desktop/src/shell/api.ts）

```ts
export interface PanelDef { id: string; mode: ModeId; area: 'left' | 'right' | 'bottom'; title: string; order?: number; level?: 'easy' | 'detail' | 'both'; component: React.FC }
export function registerPanel(def: PanelDef): void;
export interface SectionDef { id: string; panelId: string; order?: number; level?: 'easy' | 'detail' | 'both'; component: React.FC }
export function registerPanelSection(def: SectionDef): void;      // パネルの中の <PanelSections panelId=… /> に入る
export function PanelSections(props: { panelId: string }): JSX.Element;
export function registerCenter(mode: 'studio' | 'animation', component: React.FC): void;
export function registerSetupScreen(component: React.FC): void;   // 素材が1つも無いとき中央に出す
export function registerMenuItem(item: { id: string; label: string; shortcut?: string; run(): void }): void;

export interface CanvasPointerEvent { canvasPoint: Vec2; screenPoint: Vec2; button: number; shiftKey: boolean; altKey: boolean; ctrlKey: boolean }
export interface CanvasTool {
  id: string; label: string; cursor?: string;
  onPointerDown?(e: CanvasPointerEvent): void; onPointerMove?(e: CanvasPointerEvent): void; onPointerUp?(e: CanvasPointerEvent): void;
  onKeyDown?(e: KeyboardEvent): void;
  drawOverlay?(ctx: CanvasRenderingContext2D, view: ViewTransform): void;
}
export function registerCanvasTool(tool: CanvasTool): void;        // 最初に登録したものが既定のツール
export function registerCanvasOverlay(id: string, draw: (ctx: CanvasRenderingContext2D, view: ViewTransform) => void): void;
export function useCanvas(): { view: ViewTransform; activeToolId: string; setActiveTool(id: string): void; requestRedraw(): void; lastDeformed(): DeformedModel | null; screenToCanvas(p: Vec2): Vec2 };

export function useServices(): Services;
export function useProject(): Project;
export function useDispatch(): (c: Command) => void;
export function useEditor(): [EditorState, (patch: Partial<EditorState>) => void];
export function useEnvironment(): [Environment, (patch: Partial<Environment>) => void];
export function useDialogs(): { confirm(message: string): Promise<boolean>; notify(message: string): void; prompt(message: string, initial?: string): Promise<string | null> };
export function emitAppEvent(name: string, payload?: unknown): void;
export function onAppEvent(name: string, listener: (payload: unknown) => void): () => void;
```

## 作らないもの

各パネルの中身。

## 完了条件

- [ ] 3つのモードを切り替えられ、テスト用のパネルとセクションが出る。uiLevel で出し分けられる
- [ ] キャンバスに fixtures のモデルが（仮実装で）表示され、拡大・移動できる
- [ ] テスト用のツールで、pointer のキャンバス座標が拡大・移動の後も正しい
- [ ] Ctrl+Z で store.undo が呼ばれる
- [ ] environment.json を読み書きできる


---

# 06. バインディングの評価

> このカードだけで実装できるように、必要な仕様・型・約束をすべて書いている。ほかのカードや設計書を読む必要はない。「前提」に書いたものは、このカードの時点で必ずある。名前と形を変えないこと。

| 項目 | 内容 |
| --- | --- |
| フェーズ / 段階 | MVP / M1 部品 |
| 並行作業 | 同じ段階の 06〜22 と並行して作れる（触るフォルダは重ならない） |
| 担当の目安 | コア |
| 作業場所 | packages/core/src/eval/ |

## 目的

パラメータの値から、対象ごとの差分の合計（TargetDeltas）を求める。

## 前提（このカードの時点ですでにあるもの）

`@app/schema` と `@app/contracts` に下の型とインターフェースがある。

抜粋に名前だけ出てくる型も、すべて `@app/schema` か `@app/contracts` から import できる。

### 座標と値の約束

- 座標はキャンバス（元のPSD・PNG）のピクセル。原点は左上、x は右、y は下が正。
- 回転は度。画面上の時計回りが正。
- L / R はキャラクター自身から見た左右。画面では L が右側に描かれる。
- FaceAngleX はキャラクターが画面の右を向くと正、FaceAngleY は上を向くと正、FaceAngleZ は時計回りが正。EyeBallX は画面の右を見ると正、EyeBallY は上を見ると正。
- 基準状態 = 素材を配置しただけの状態 = 全パラメータがデフォルト値の状態。素材は「目を開け、口を閉じた」状態で描かれている前提。
- キーは基準状態からの差分。位置・回転・頂点は加算、拡縮・不透明度は倍率（1 = 変化なし）。

### Parameter と ParameterGroup（@app/schema）

```ts
export interface ParameterGroup { id: ParameterGroupId; name: string }
export interface Parameter {
  id: Id;                          // 標準は 'FaceAngleX' など。ユーザー定義は任意の文字列
  name: string;                    // 表示名
  groupId: ParameterGroupId;
  min: number; max: number; default: number;
  standard: boolean;
}
```

### Binding と ParameterKey（@app/schema）

```ts
export type Channel = 'transform' | 'vertices' | 'warpPoints';
export interface TransformDelta { position: Vec2; rotation: number; scale: Vec2; opacity: number }
// position・rotation は加算、scale・opacity は倍率（1 = 変化なし）
export interface Binding {
  id: Id;
  target: { type: 'part' | 'mesh' | 'warp'; id: Id };   // transform → part、vertices → mesh、warpPoints → warp
  channel: Channel;
  parameterIds: Id[];              // 1 または 2
  keyValues: number[][];           // パラメータごとのキー位置（昇順。デフォルト値を必ず含む）
  keys: ParameterKey[];
  generation: 'linear' | 'depth' | 'rotate' | 'surface' | 'ease';
  divisions: number | null;        // 中間キーの分割数（自動なら null）
}
export interface ParameterKey {
  coords: number[];                // parameterIds と同じ順の値
  delta: TransformDelta | Vec2[];  // transform は TransformDelta、それ以外は頂点・制御点ごとの差分
  source: 'manual' | 'auto' | 'generated' | 'combined';
  locked: boolean;
}
```

### Mesh（@app/schema）

```ts
export interface Mesh {
  id: Id;
  vertices: Vec2[];                // 基準状態の頂点（キャンバス座標）
  uvs: Vec2[];                     // 0..1（素材画像の中の位置）
  triangles: [number, number, number][];
  density: 'light' | 'standard' | 'smooth' | 'custom';
  edited: boolean;                 // 手で編集したか
}
```

### Warp（@app/schema）

```ts
export interface Warp {
  id: Id;
  partId: Id;                      // ワープを付ける group パーツ
  columns: number; rows: number;   // 格子の分割数
  bounds: { x: number; y: number; width: number; height: number };   // キャンバス座標
  points: Vec2[];                  // (columns+1)×(rows+1) 個、行優先。基準状態の制御点
}
```

### Model と Project（@app/schema）

```ts
export interface Model {
  parts: Part[];
  meshes: Mesh[];
  warps: Warp[];
  drawOrder: Id[];                 // 画像パーツの id。背面 → 前面
  parameters: Parameter[];
  parameterGroups: ParameterGroup[];
  bindings: Binding[];
  lipSync: LipSync;
  setupHints: { closedLineL: Vec2[] | null; closedLineR: Vec2[] | null };   // かんたんセットアップ用（閉じた目の線。STEP1で使う）
}
export interface Project {
  schemaVersion: number;           // 現在は 1
  id: Id;
  name: string;
  assets: Asset[];
  model: Model;
  expressions: Expression[];
  animations: Animation[];
  physics: Physics[];
  trackingMappings: TrackingMapping[];   // 空なら既定のマッピング
  studio: { scenes: Scene[]; activeSceneId: Id | null; hotkeys: Hotkey[] };
}
```

### 評価の契約（@app/contracts）

```ts
export type ParamValues = Record<string, number>;
export interface TargetDeltas {
  transforms: Record<string, TransformDelta>;   // partId → 合成済みの差分
  vertices: Record<string, Float32Array>;        // meshId → [dx0, dy0, dx1, dy1, ...]
  warpPoints: Record<string, Float32Array>;      // warpId → 制御点の差分（同じ並び）
}
export interface BindingEvaluator { evaluate(model: Model, params: ParamValues): TargetDeltas }
```

## 作るもの

- `createBindingEvaluator(): BindingEvaluator`。
- 値: params に無いパラメータはデフォルト値。値は min..max に丸める。
- 1パラメータ: keyValues[0] で値をはさむ2つのキーを線形補間する。範囲外は端のキー。キーが1つならその差分。
- 2パラメータ: 格子の双線形補間。格子の点にキーが無いときは、各軸の差分の和で代用する（(x, y) = (x, y0) + (x0, y)。x0・y0 はデフォルト値。どちらも無ければ 0）。
- 補間の対象: transform は position・rotation・scale・opacity を成分ごとに線形補間（scale・opacity は倍率のまま）。vertices・warpPoints は要素ごと。
- 合成: 同じ対象・同じチャンネルの複数のバインディングは、position・rotation・頂点・制御点を加算、scale・opacity を乗算する。
- 差分の配列の長さが対象の頂点数・制御点数と違うバインディングは無視して console.warn（例外にしない）。
- 性能: 頂点の合計 5,000・バインディング 200 で 1回 1ms 未満が目安。毎フレーム呼ばれるので、配列は再利用してよい。

## 作らないもの

階層の変形の適用（別のカード）。

## 完了条件

- [ ] 1パラメータ: キーの間の線形補間、範囲外は端のキー、キー1つの場合
- [ ] 2パラメータ: 双線形補間と、格子に無い組み合わせの代用
- [ ] transform の合成（位置・回転は加算、拡縮・不透明度は乗算）
- [ ] 頂点の加算と、長さの合わない差分の無視
- [ ] 性能テスト（CI では 5ms 未満を条件にする）


---

# 07. 変形パイプライン

> このカードだけで実装できるように、必要な仕様・型・約束をすべて書いている。ほかのカードや設計書を読む必要はない。「前提」に書いたものは、このカードの時点で必ずある。名前と形を変えないこと。

| 項目 | 内容 |
| --- | --- |
| フェーズ / 段階 | MVP / M1 部品 |
| 並行作業 | 同じ段階の 06〜22 と並行して作れる（触るフォルダは重ならない） |
| 担当の目安 | コア |
| 作業場所 | packages/core/src/deform/ |

## 目的

差分を階層に沿って適用し、描画できる形（DeformedModel）にする。

## 前提（このカードの時点ですでにあるもの）

`@app/schema` と `@app/contracts` に下の型とインターフェースがある。

抜粋に名前だけ出てくる型も、すべて `@app/schema` か `@app/contracts` から import できる。

### 座標と値の約束

- 座標はキャンバス（元のPSD・PNG）のピクセル。原点は左上、x は右、y は下が正。
- 回転は度。画面上の時計回りが正。
- L / R はキャラクター自身から見た左右。画面では L が右側に描かれる。
- FaceAngleX はキャラクターが画面の右を向くと正、FaceAngleY は上を向くと正、FaceAngleZ は時計回りが正。EyeBallX は画面の右を見ると正、EyeBallY は上を見ると正。
- 基準状態 = 素材を配置しただけの状態 = 全パラメータがデフォルト値の状態。素材は「目を開け、口を閉じた」状態で描かれている前提。
- キーは基準状態からの差分。位置・回転・頂点は加算、拡縮・不透明度は倍率（1 = 変化なし）。

### パーツの変形と計算の順序

- パーツの変形は、点 p を `p' = position + pivot + R(rotation)·(scale ⊙ (p − pivot))` に動かす。R は y が下向きの座標で `[cos −sin; sin cos]`（正の角度で時計回り）。
- 実際に使う値: `position = Part.position + Δposition`、`rotation = Part.rotation + Δrotation`、`scale = Part.scale ⊙ Δscale`、`opacity = Part.opacity × Δopacity`（Δ はキーの合成結果）。
- 取り込み直後は position (0,0)・rotation 0・scale (1,1)。メッシュの頂点と pivot はキャンバス座標。
- 画像パーツの最終頂点は内側から外側へ求める。(1) メッシュの基準頂点 + 頂点の差分 → (2) 自身のパーツの変形 → (3) 親グループのワープ（あれば）→ (4) 親グループのパーツの変形 → ルートまで (3)(4) を繰り返す。
- 不透明度は、自身から親までの値をすべて掛け合わせる。

### Part と StandardPartType（@app/schema）

```ts
export interface Part {
  id: Id;
  name: string;
  kind: 'image' | 'group';
  standardType: StandardPartType | null;   // 自由パーツは null
  assetId: Id | null;                      // image のみ
  meshId: Id | null;                       // image のみ
  parentId: Id | null;
  position: Vec2;                          // 初期値 {x: 0, y: 0}
  rotation: number;                        // 度。初期値 0
  scale: Vec2;                             // 初期値 {x: 1, y: 1}
  pivot: Vec2;                             // 回転・拡縮の中心（キャンバス座標）
  opacity: number;                         // 0..1
  blendMode: BlendMode;
  depth: number;                           // 奥行き。手前が正（-1..1 が目安）
  mask: { sourcePartIds: Id[]; inverted: boolean } | null;
  physicsId: Id | null;
  visible: boolean;
  locked: boolean;
}
export type StandardPartType =
  | 'face' | 'earL' | 'earR' | 'cheek'
  | 'eyeWhiteL' | 'irisL' | 'highlightL' | 'upperLidL' | 'lowerLidL' | 'eyeWholeL'
  | 'eyeWhiteR' | 'irisR' | 'highlightR' | 'upperLidR' | 'lowerLidR' | 'eyeWholeR'
  | 'browL' | 'browR'
  | 'upperLip' | 'lowerLip' | 'mouthInside' | 'teeth' | 'tongue' | 'mouthWhole'
  | 'frontHair' | 'sideHairL' | 'sideHairR' | 'backHair'
  | 'neck' | 'torso' | 'armL' | 'armR'
  // 変形グループ（かんたんセットアップが作る）
  | 'bodyRoot' | 'armRootL' | 'armRootR' | 'neckRoot' | 'headRoot'
  | 'faceGroup' | 'eyeGroupL' | 'eyeGroupR' | 'mouthGroup';
```

### Mesh（@app/schema）

```ts
export interface Mesh {
  id: Id;
  vertices: Vec2[];                // 基準状態の頂点（キャンバス座標）
  uvs: Vec2[];                     // 0..1（素材画像の中の位置）
  triangles: [number, number, number][];
  density: 'light' | 'standard' | 'smooth' | 'custom';
  edited: boolean;                 // 手で編集したか
}
```

### Warp（@app/schema）

```ts
export interface Warp {
  id: Id;
  partId: Id;                      // ワープを付ける group パーツ
  columns: number; rows: number;   // 格子の分割数
  bounds: { x: number; y: number; width: number; height: number };   // キャンバス座標
  points: Vec2[];                  // (columns+1)×(rows+1) 個、行優先。基準状態の制御点
}
```

### Model と Project（@app/schema）

```ts
export interface Model {
  parts: Part[];
  meshes: Mesh[];
  warps: Warp[];
  drawOrder: Id[];                 // 画像パーツの id。背面 → 前面
  parameters: Parameter[];
  parameterGroups: ParameterGroup[];
  bindings: Binding[];
  lipSync: LipSync;
  setupHints: { closedLineL: Vec2[] | null; closedLineR: Vec2[] | null };   // かんたんセットアップ用（閉じた目の線。STEP1で使う）
}
export interface Project {
  schemaVersion: number;           // 現在は 1
  id: Id;
  name: string;
  assets: Asset[];
  model: Model;
  expressions: Expression[];
  animations: Animation[];
  physics: Physics[];
  trackingMappings: TrackingMapping[];   // 空なら既定のマッピング
  studio: { scenes: Scene[]; activeSceneId: Id | null; hotkeys: Hotkey[] };
}
```

### 評価の契約（@app/contracts）

```ts
export type ParamValues = Record<string, number>;
export interface TargetDeltas {
  transforms: Record<string, TransformDelta>;   // partId → 合成済みの差分
  vertices: Record<string, Float32Array>;        // meshId → [dx0, dy0, dx1, dy1, ...]
  warpPoints: Record<string, Float32Array>;      // warpId → 制御点の差分（同じ並び）
}
export interface BindingEvaluator { evaluate(model: Model, params: ParamValues): TargetDeltas }
```

### 変形の契約（@app/contracts）

```ts
export interface DrawItem {
  partId: string; assetId: string;
  positions: Float32Array;         // 変形後の頂点（キャンバス座標）[x0, y0, x1, y1, ...]
  uvs: Float32Array;               // [u0, v0, ...]（0..1）
  indices: Uint32Array;
  opacity: number;                 // 親まで掛けた最終値
  blendMode: BlendMode;
  mask: { sourcePartIds: string[]; inverted: boolean } | null;
}
export interface DeformedModel {
  items: DrawItem[];               // 描画順（背面 → 前面）。非表示のパーツは含めない
  byPartId: Record<string, DrawItem>;
}
export interface DeformPipeline { deform(model: Model, deltas: TargetDeltas): DeformedModel }
```

## 作るもの

- `createDeformPipeline(): DeformPipeline`。
- 対象: 自身と全祖先の visible が true で、assetId と meshId がある画像パーツ。
- 頂点は「パーツの変形と計算の順序」のとおりに求める。ワープは `warp.ts` の `applyWarp(points: Float32Array, warp: Warp, delta: Float32Array | undefined): void`（points をその場で書き換える）を呼ぶ。今は何もしない関数として置き、ファイル名と関数名を変えない（後のカードで実装する）。
- 不透明度は、自身から祖先までの `Part.opacity × Δopacity` を掛け合わせる。
- items は model.drawOrder の順（背面 → 前面）。drawOrder に無い画像パーツは最前面に parts の順で足し、console.warn。byPartId も作る。
- uvs は mesh.uvs、indices は mesh.triangles を平らにしたもの。blendMode と mask は Part の値をそのまま入れる。
- 親の参照が循環していたら、その id を含むエラーを投げる。
- 性能: 頂点の合計 5,000 で 1回 1ms 未満が目安。

## 作らないもの

ワープの計算、描画。

## 完了条件

- [ ] 差分が無いとき、頂点が基準のまま
- [ ] 平行移動、ピボット中心の回転（90度で時計回り）
- [ ] 入れ子の順序（子の差分 → 自身 → 親の回転）が正しい
- [ ] 不透明度の積、非表示の祖先で消える
- [ ] 描画順と、drawOrder に無いパーツの扱い
- [ ] 循環の検出


---

# 08. 中間キーの生成（線形・奥行き）

> このカードだけで実装できるように、必要な仕様・型・約束をすべて書いている。ほかのカードや設計書を読む必要はない。「前提」に書いたものは、このカードの時点で必ずある。名前と形を変えないこと。

| 項目 | 内容 |
| --- | --- |
| フェーズ / 段階 | MVP / M1 部品 |
| 並行作業 | 同じ段階の 06〜22 と並行して作れる（触るフォルダは重ならない） |
| 担当の目安 | コア |
| 作業場所 | packages/core/src/generate/ |

## 目的

代表状態の間の中間キーと、奥行きによる顔の向きのキーを作る。

## 前提（このカードの時点ですでにあるもの）

`@app/schema` と `@app/contracts` に下の型・規則・インターフェースがある。

抜粋に名前だけ出てくる型も、すべて `@app/schema` か `@app/contracts` から import できる。

### 座標と値の約束

- 座標はキャンバス（元のPSD・PNG）のピクセル。原点は左上、x は右、y は下が正。
- 回転は度。画面上の時計回りが正。
- L / R はキャラクター自身から見た左右。画面では L が右側に描かれる。
- FaceAngleX はキャラクターが画面の右を向くと正、FaceAngleY は上を向くと正、FaceAngleZ は時計回りが正。EyeBallX は画面の右を見ると正、EyeBallY は上を見ると正。
- 基準状態 = 素材を配置しただけの状態 = 全パラメータがデフォルト値の状態。素材は「目を開け、口を閉じた」状態で描かれている前提。
- キーは基準状態からの差分。位置・回転・頂点は加算、拡縮・不透明度は倍率（1 = 変化なし）。

### Part と StandardPartType（@app/schema）

```ts
export interface Part {
  id: Id;
  name: string;
  kind: 'image' | 'group';
  standardType: StandardPartType | null;   // 自由パーツは null
  assetId: Id | null;                      // image のみ
  meshId: Id | null;                       // image のみ
  parentId: Id | null;
  position: Vec2;                          // 初期値 {x: 0, y: 0}
  rotation: number;                        // 度。初期値 0
  scale: Vec2;                             // 初期値 {x: 1, y: 1}
  pivot: Vec2;                             // 回転・拡縮の中心（キャンバス座標）
  opacity: number;                         // 0..1
  blendMode: BlendMode;
  depth: number;                           // 奥行き。手前が正（-1..1 が目安）
  mask: { sourcePartIds: Id[]; inverted: boolean } | null;
  physicsId: Id | null;
  visible: boolean;
  locked: boolean;
}
export type StandardPartType =
  | 'face' | 'earL' | 'earR' | 'cheek'
  | 'eyeWhiteL' | 'irisL' | 'highlightL' | 'upperLidL' | 'lowerLidL' | 'eyeWholeL'
  | 'eyeWhiteR' | 'irisR' | 'highlightR' | 'upperLidR' | 'lowerLidR' | 'eyeWholeR'
  | 'browL' | 'browR'
  | 'upperLip' | 'lowerLip' | 'mouthInside' | 'teeth' | 'tongue' | 'mouthWhole'
  | 'frontHair' | 'sideHairL' | 'sideHairR' | 'backHair'
  | 'neck' | 'torso' | 'armL' | 'armR'
  // 変形グループ（かんたんセットアップが作る）
  | 'bodyRoot' | 'armRootL' | 'armRootR' | 'neckRoot' | 'headRoot'
  | 'faceGroup' | 'eyeGroupL' | 'eyeGroupR' | 'mouthGroup';
```

### Asset（@app/schema）

```ts
export interface Asset {
  id: Id;
  path: string;                    // 例: assets/<id>.png
  hash: string;                    // png の SHA-256（16進）
  width: number; height: number;   // トリミング後のサイズ
  offset: Vec2;                    // トリミング後の左上のキャンバス座標
  canvasSize: { width: number; height: number };
  source: { kind: 'psd' | 'png'; file: string; layerName?: string; layerPath?: string[]; hidden?: boolean };
  sourceBlendMode: BlendMode;
  sourceOpacity: number;           // 0..1
}
```

### Parameter と ParameterGroup（@app/schema）

```ts
export interface ParameterGroup { id: ParameterGroupId; name: string }
export interface Parameter {
  id: Id;                          // 標準は 'FaceAngleX' など。ユーザー定義は任意の文字列
  name: string;                    // 表示名
  groupId: ParameterGroupId;
  min: number; max: number; default: number;
  standard: boolean;
}
```

### Binding と ParameterKey（@app/schema）

```ts
export type Channel = 'transform' | 'vertices' | 'warpPoints';
export interface TransformDelta { position: Vec2; rotation: number; scale: Vec2; opacity: number }
// position・rotation は加算、scale・opacity は倍率（1 = 変化なし）
export interface Binding {
  id: Id;
  target: { type: 'part' | 'mesh' | 'warp'; id: Id };   // transform → part、vertices → mesh、warpPoints → warp
  channel: Channel;
  parameterIds: Id[];              // 1 または 2
  keyValues: number[][];           // パラメータごとのキー位置（昇順。デフォルト値を必ず含む）
  keys: ParameterKey[];
  generation: 'linear' | 'depth' | 'rotate' | 'surface' | 'ease';
  divisions: number | null;        // 中間キーの分割数（自動なら null）
}
export interface ParameterKey {
  coords: number[];                // parameterIds と同じ順の値
  delta: TransformDelta | Vec2[];  // transform は TransformDelta、それ以外は頂点・制御点ごとの差分
  source: 'manual' | 'auto' | 'generated' | 'combined';
  locked: boolean;
}
```

### Model と Project（@app/schema）

```ts
export interface Model {
  parts: Part[];
  meshes: Mesh[];
  warps: Warp[];
  drawOrder: Id[];                 // 画像パーツの id。背面 → 前面
  parameters: Parameter[];
  parameterGroups: ParameterGroup[];
  bindings: Binding[];
  lipSync: LipSync;
  setupHints: { closedLineL: Vec2[] | null; closedLineR: Vec2[] | null };   // かんたんセットアップ用（閉じた目の線。STEP1で使う）
}
export interface Project {
  schemaVersion: number;           // 現在は 1
  id: Id;
  name: string;
  assets: Asset[];
  model: Model;
  expressions: Expression[];
  animations: Animation[];
  physics: Physics[];
  trackingMappings: TrackingMapping[];   // 空なら既定のマッピング
  studio: { scenes: Scene[]; activeSceneId: Id | null; hotkeys: Hotkey[] };
}
```

### 規則（@app/schema の rules.ts）

```ts
export const STANDARD_PARAMETERS: Parameter[];                      // 標準パラメータの表（standard: true）
export const PARAMETER_GROUPS: ParameterGroup[];                    // face 顔 / eye 目 / brow 眉 / mouth 口 / cheek 頬 / body 体 / armL 左腕 / armR 右腕 / sway 揺れもの / other その他
export const STANDARD_PART_NAMES: Record<StandardPartType, string>; // 日本語の表示名（例: eyeWhiteL → 白目 L）
export const STANDARD_DRAW_ORDER: StandardPartType[];               // 背面 → 前面（下記）
export const DEFAULT_DEPTH: Partial<Record<StandardPartType, number>>;   // 下記
export const PARALLAX_RATIO = 0.08;
// 奥行きによる移動量（px）。faceWidth は standardType 'face' の素材の幅
export function depthParallaxOffset(depth: number, value: number, faceWidth: number, axis: 'x' | 'y'): number {
  const d = depth * (value / 30) * faceWidth * PARALLAX_RATIO;
  return axis === 'x' ? d : -d;    // y は上が負
}
```

- STANDARD_DRAW_ORDER（背面 → 前面）: backHair, torso, armL, armR, neck, earL, earR, face, cheek, mouthInside, teeth, tongue, upperLip, lowerLip, mouthWhole, eyeWhiteL, eyeWhiteR, eyeWholeL, eyeWholeR, irisL, irisR, highlightL, highlightR, lowerLidL, lowerLidR, upperLidL, upperLidR, browL, browR, sideHairL, sideHairR, frontHair
- DEFAULT_DEPTH: frontHair 1.0 / browL・browR 0.6 / 目のパーツ（eyeWhite・iris・highlight・upperLid・lowerLid・eyeWhole の L・R）0.5 / 口のパーツ（upperLip・lowerLip・mouthInside・teeth・tongue・mouthWhole）0.5 / sideHairL・sideHairR 0.4 / cheek 0.4 / face 0.2 / earL・earR −0.5 / backHair −1.0

### 生成・セットアップの契約（@app/contracts）

```ts
export interface KeyGenerator {
  linear(binding: Binding, divisions?: number): Binding;
  depthParallax(model: Model, parameterId: 'FaceAngleX' | 'FaceAngleY'): Binding[];   // 作り直した transform バインディング
}
export interface AutoSetup { plan(project: Project): { command: Command; warnings: string[] } }
```

## 作るもの

- `createKeyGenerator(): KeyGenerator`。
- `linear(binding, divisions?)`: 1パラメータのバインディングだけが対象（2パラメータはそのまま返す）。代表状態（source が manual か auto、または locked のキー）の隣り合う2つの間に、中間キーを等間隔に作る。値は線形補間、source 'generated'、locked false。間隔は divisions があれば区間の分割数、無ければ「範囲が10を超えるパラメータは10刻み、それ以外は 0.25 刻み」。既存の generated で未ロックのキーは作り直し、keyValues を昇順に更新する。
- `depthParallax(model, parameterId)`: standardType 'headRoot' のグループの子孫にある画像パーツごとに、transform バインディングを1つ（無ければ作り、あれば未ロックのキーだけ作り直す）。キーは −30・0・30（source 'auto'、0 は差分 0）。Δposition は `depthParallaxOffset(part.depth, value, faceWidth, 'x' または 'y')`（FaceAngleX は x、FaceAngleY は y）。standardType 'face' のパーツは、FaceAngleX のとき `Δscale.x = 1 − 0.04 × |value| / 30` も入れる。faceWidth は 'face' の素材の幅（無ければ headRoot 配下の外接矩形の幅）。generation は 'depth'。

## 作らないもの

回転・曲面・なめらかの生成方式（STEP1）。

## 完了条件

- [ ] linear: 中間キーの数と値、ロックされたキーを残す、作り直しで未ロックの generated だけが変わる
- [ ] depthParallax: 手前のパーツは右へ・奥のパーツは左へ（FaceAngleX 正）、上を向くと手前のパーツが上へ（FaceAngleY 正）
- [ ] 顔の輪郭の横の縮み
- [ ] 2回実行しても結果が同じ


---

# 09. パラメータの合成（ミキサー）

> このカードだけで実装できるように、必要な仕様・型・約束をすべて書いている。ほかのカードや設計書を読む必要はない。「前提」に書いたものは、このカードの時点で必ずある。名前と形を変えないこと。

| 項目 | 内容 |
| --- | --- |
| フェーズ / 段階 | MVP / M1 部品 |
| 並行作業 | 同じ段階の 06〜22 と並行して作れる（触るフォルダは重ならない） |
| 担当の目安 | コア |
| 作業場所 | packages/core/src/mix/ |

## 目的

トラッキング・表情などのレイヤーを、決まった順と合成方法で1つのパラメータ値にまとめる。

## 前提（このカードの時点ですでにあるもの）

`@app/schema` と `@app/contracts` に下の型とインターフェースがある。

抜粋に名前だけ出てくる型も、すべて `@app/schema` か `@app/contracts` から import できる。

### Parameter と ParameterGroup（@app/schema）

```ts
export interface ParameterGroup { id: ParameterGroupId; name: string }
export interface Parameter {
  id: Id;                          // 標準は 'FaceAngleX' など。ユーザー定義は任意の文字列
  name: string;                    // 表示名
  groupId: ParameterGroupId;
  min: number; max: number; default: number;
  standard: boolean;
}
```

### Expression（@app/schema）

```ts
export type BlendOp = 'override' | 'add' | 'multiply' | 'max';
export interface Expression {
  id: Id; name: string;
  entries: { parameterId: Id; value: number; blend: BlendOp }[];
  fadeIn: number; fadeOut: number;          // 秒
}
```

### 評価の契約（@app/contracts）

```ts
export type ParamValues = Record<string, number>;
export interface TargetDeltas {
  transforms: Record<string, TransformDelta>;   // partId → 合成済みの差分
  vertices: Record<string, Float32Array>;        // meshId → [dx0, dy0, dx1, dy1, ...]
  warpPoints: Record<string, Float32Array>;      // warpId → 制御点の差分（同じ並び）
}
export interface BindingEvaluator { evaluate(model: Model, params: ParamValues): TargetDeltas }
```

### 合成の契約（@app/contracts）

```ts
export type LayerId = 'tracking' | 'bodyFollow' | 'expression' | 'animation' | 'lipSync' | 'periodic' | 'physics';
export const LAYER_ORDER: LayerId[] = ['tracking', 'bodyFollow', 'expression', 'animation', 'lipSync', 'periodic', 'physics'];
export interface Layer {
  id: LayerId;
  weight: number;                     // 0..1
  values: ParamValues;                // このレイヤーが担当するパラメータの値だけ
  blend?: Record<string, BlendOp>;    // パラメータごとの合成方法。無ければ override
}
export interface ParameterMixer { mix(parameters: Parameter[], layers: Layer[]): ParamValues }

// スタジオの1フレームの文脈。producer は LAYER_ORDER の順に呼ばれる
export interface FrameContext {
  now: number; dt: number;            // ミリ秒
  project: Project;
  mixedSoFar: ParamValues;            // それまでのレイヤーを合成した値
  flags: { lipSyncWeight: number; physicsActive: boolean };   // 前のレイヤーが後のレイヤーへ伝える値（初期値 1・true）
}
export interface LayerProducer { id: LayerId; produce(ctx: FrameContext): Layer | null }
```

## 作るもの

- `createParameterMixer(): ParameterMixer`。
- 各パラメータをデフォルト値から始め、LAYER_ORDER の順にレイヤーを適用する。引数の配列の順は使わない（同じ id が複数あれば、その id の中では配列の順）。
- 適用: op = blend[id] ?? 'override'、w = weight（0..1 に丸める）、t = レイヤーの値。
  - override: v ← v + (t − v)·w
  - add: v ← v + t·w
  - multiply: v ← v·(1 + (t − 1)·w)
  - max: v ← v + (max(v, t) − v)·w
- 最後に min..max に丸める。知らない id は無視する。

## 作らないもの

各レイヤーの値を作る処理（それぞれのカード）。

## 完了条件

- [ ] 4つの合成方法ごとの値（重み 0・0.5・1）
- [ ] 引数の順に関係なく LAYER_ORDER で合成される
- [ ] 範囲への丸め、知らない id の無視


---

# 10. メッシュの自動生成

> このカードだけで実装できるように、必要な仕様・型・約束をすべて書いている。ほかのカードや設計書を読む必要はない。「前提」に書いたものは、このカードの時点で必ずある。名前と形を変えないこと。

| 項目 | 内容 |
| --- | --- |
| フェーズ / 段階 | MVP / M1 部品 |
| 並行作業 | 同じ段階の 06〜22 と並行して作れる（触るフォルダは重ならない） |
| 担当の目安 | コア |
| 作業場所 | packages/core/src/mesh/ |

## 目的

素材の不透明部分から、変形に使うメッシュを自動で作る。

## 前提（このカードの時点ですでにあるもの）

`@app/schema` と `@app/contracts` に下の型とインターフェースがある。

抜粋に名前だけ出てくる型も、すべて `@app/schema` か `@app/contracts` から import できる。

### 座標と値の約束

- 座標はキャンバス（元のPSD・PNG）のピクセル。原点は左上、x は右、y は下が正。
- 回転は度。画面上の時計回りが正。
- L / R はキャラクター自身から見た左右。画面では L が右側に描かれる。
- FaceAngleX はキャラクターが画面の右を向くと正、FaceAngleY は上を向くと正、FaceAngleZ は時計回りが正。EyeBallX は画面の右を見ると正、EyeBallY は上を見ると正。
- 基準状態 = 素材を配置しただけの状態 = 全パラメータがデフォルト値の状態。素材は「目を開け、口を閉じた」状態で描かれている前提。
- キーは基準状態からの差分。位置・回転・頂点は加算、拡縮・不透明度は倍率（1 = 変化なし）。

### Mesh（@app/schema）

```ts
export interface Mesh {
  id: Id;
  vertices: Vec2[];                // 基準状態の頂点（キャンバス座標）
  uvs: Vec2[];                     // 0..1（素材画像の中の位置）
  triangles: [number, number, number][];
  density: 'light' | 'standard' | 'smooth' | 'custom';
  edited: boolean;                 // 手で編集したか
}
```

### メッシュ生成の契約（@app/contracts）

```ts
export interface MeshGenerator {
  generate(alpha: ImageData, offset: Vec2, density: 'light' | 'standard' | 'smooth'):
    { vertices: Vec2[]; uvs: Vec2[]; triangles: [number, number, number][] };   // 頂点はキャンバス座標
}
```

## 作るもの

- `createMeshGenerator(): MeshGenerator`。
- 不透明部分（alpha ≥ 8）の輪郭を marching squares で求める。穴と、離れた島も扱う。
- 輪郭を Douglas–Peucker で単純化する（許容誤差: light 6px、standard 3px、smooth 1.5px）。
- 内部に格子状の点を足す（間隔: light 80px、standard 48px、smooth 28px。輪郭から間隔の半分以内の点は足さない）。
- 輪郭を制約にした三角形分割（例: cdt2d）を行い、輪郭の外の三角形は捨てる。
- 頂点はキャンバス座標（画像の中の位置 + offset）。uvs は画像の中の位置 ÷ 画像サイズ。
- 不透明なピクセルが1つも無い画像は、画像全体の四角形を返す。

## 作らないもの

メッシュの編集の画面、キーの扱い（別のカード）。

## 完了条件

- [ ] 不透明なピクセルの 99% 以上が三角形の内側に入る
- [ ] 穴のある画像・離れた島のある画像
- [ ] light < standard < smooth の順に頂点が増える
- [ ] uvs がすべて 0..1
- [ ] 2000×2000px の画像で 200ms 未満


---

# 11. かんたんセットアップ（たたき台の生成）

> このカードだけで実装できるように、必要な仕様・型・約束をすべて書いている。ほかのカードや設計書を読む必要はない。「前提」に書いたものは、このカードの時点で必ずある。名前と形を変えないこと。

| 項目 | 内容 |
| --- | --- |
| フェーズ / 段階 | MVP / M1 部品 |
| 並行作業 | 同じ段階の 06〜22 と並行して作れる（触るフォルダは重ならない） |
| 担当の目安 | コア |
| 作業場所 | packages/core/src/setup/ |

## 目的

割り当て済みの標準パーツから、階層・ピボット・描画順・マスクと基本の動きのたたき台を自動で作る。

## 前提（このカードの時点ですでにあるもの）

`@app/schema` と `@app/contracts` に下の型・規則・インターフェースがある。ほかの core の機能は使わず、このカードの中で計算する。

抜粋に名前だけ出てくる型も、すべて `@app/schema` か `@app/contracts` から import できる。

### 座標と値の約束

- 座標はキャンバス（元のPSD・PNG）のピクセル。原点は左上、x は右、y は下が正。
- 回転は度。画面上の時計回りが正。
- L / R はキャラクター自身から見た左右。画面では L が右側に描かれる。
- FaceAngleX はキャラクターが画面の右を向くと正、FaceAngleY は上を向くと正、FaceAngleZ は時計回りが正。EyeBallX は画面の右を見ると正、EyeBallY は上を見ると正。
- 基準状態 = 素材を配置しただけの状態 = 全パラメータがデフォルト値の状態。素材は「目を開け、口を閉じた」状態で描かれている前提。
- キーは基準状態からの差分。位置・回転・頂点は加算、拡縮・不透明度は倍率（1 = 変化なし）。

### パーツの変形と計算の順序

- パーツの変形は、点 p を `p' = position + pivot + R(rotation)·(scale ⊙ (p − pivot))` に動かす。R は y が下向きの座標で `[cos −sin; sin cos]`（正の角度で時計回り）。
- 実際に使う値: `position = Part.position + Δposition`、`rotation = Part.rotation + Δrotation`、`scale = Part.scale ⊙ Δscale`、`opacity = Part.opacity × Δopacity`（Δ はキーの合成結果）。
- 取り込み直後は position (0,0)・rotation 0・scale (1,1)。メッシュの頂点と pivot はキャンバス座標。
- 画像パーツの最終頂点は内側から外側へ求める。(1) メッシュの基準頂点 + 頂点の差分 → (2) 自身のパーツの変形 → (3) 親グループのワープ（あれば）→ (4) 親グループのパーツの変形 → ルートまで (3)(4) を繰り返す。
- 不透明度は、自身から親までの値をすべて掛け合わせる。

### Asset（@app/schema）

```ts
export interface Asset {
  id: Id;
  path: string;                    // 例: assets/<id>.png
  hash: string;                    // png の SHA-256（16進）
  width: number; height: number;   // トリミング後のサイズ
  offset: Vec2;                    // トリミング後の左上のキャンバス座標
  canvasSize: { width: number; height: number };
  source: { kind: 'psd' | 'png'; file: string; layerName?: string; layerPath?: string[]; hidden?: boolean };
  sourceBlendMode: BlendMode;
  sourceOpacity: number;           // 0..1
}
```

### Part と StandardPartType（@app/schema）

```ts
export interface Part {
  id: Id;
  name: string;
  kind: 'image' | 'group';
  standardType: StandardPartType | null;   // 自由パーツは null
  assetId: Id | null;                      // image のみ
  meshId: Id | null;                       // image のみ
  parentId: Id | null;
  position: Vec2;                          // 初期値 {x: 0, y: 0}
  rotation: number;                        // 度。初期値 0
  scale: Vec2;                             // 初期値 {x: 1, y: 1}
  pivot: Vec2;                             // 回転・拡縮の中心（キャンバス座標）
  opacity: number;                         // 0..1
  blendMode: BlendMode;
  depth: number;                           // 奥行き。手前が正（-1..1 が目安）
  mask: { sourcePartIds: Id[]; inverted: boolean } | null;
  physicsId: Id | null;
  visible: boolean;
  locked: boolean;
}
export type StandardPartType =
  | 'face' | 'earL' | 'earR' | 'cheek'
  | 'eyeWhiteL' | 'irisL' | 'highlightL' | 'upperLidL' | 'lowerLidL' | 'eyeWholeL'
  | 'eyeWhiteR' | 'irisR' | 'highlightR' | 'upperLidR' | 'lowerLidR' | 'eyeWholeR'
  | 'browL' | 'browR'
  | 'upperLip' | 'lowerLip' | 'mouthInside' | 'teeth' | 'tongue' | 'mouthWhole'
  | 'frontHair' | 'sideHairL' | 'sideHairR' | 'backHair'
  | 'neck' | 'torso' | 'armL' | 'armR'
  // 変形グループ（かんたんセットアップが作る）
  | 'bodyRoot' | 'armRootL' | 'armRootR' | 'neckRoot' | 'headRoot'
  | 'faceGroup' | 'eyeGroupL' | 'eyeGroupR' | 'mouthGroup';
```

### Parameter と ParameterGroup（@app/schema）

```ts
export interface ParameterGroup { id: ParameterGroupId; name: string }
export interface Parameter {
  id: Id;                          // 標準は 'FaceAngleX' など。ユーザー定義は任意の文字列
  name: string;                    // 表示名
  groupId: ParameterGroupId;
  min: number; max: number; default: number;
  standard: boolean;
}
```

### Binding と ParameterKey（@app/schema）

```ts
export type Channel = 'transform' | 'vertices' | 'warpPoints';
export interface TransformDelta { position: Vec2; rotation: number; scale: Vec2; opacity: number }
// position・rotation は加算、scale・opacity は倍率（1 = 変化なし）
export interface Binding {
  id: Id;
  target: { type: 'part' | 'mesh' | 'warp'; id: Id };   // transform → part、vertices → mesh、warpPoints → warp
  channel: Channel;
  parameterIds: Id[];              // 1 または 2
  keyValues: number[][];           // パラメータごとのキー位置（昇順。デフォルト値を必ず含む）
  keys: ParameterKey[];
  generation: 'linear' | 'depth' | 'rotate' | 'surface' | 'ease';
  divisions: number | null;        // 中間キーの分割数（自動なら null）
}
export interface ParameterKey {
  coords: number[];                // parameterIds と同じ順の値
  delta: TransformDelta | Vec2[];  // transform は TransformDelta、それ以外は頂点・制御点ごとの差分
  source: 'manual' | 'auto' | 'generated' | 'combined';
  locked: boolean;
}
```

### Model と Project（@app/schema）

```ts
export interface Model {
  parts: Part[];
  meshes: Mesh[];
  warps: Warp[];
  drawOrder: Id[];                 // 画像パーツの id。背面 → 前面
  parameters: Parameter[];
  parameterGroups: ParameterGroup[];
  bindings: Binding[];
  lipSync: LipSync;
  setupHints: { closedLineL: Vec2[] | null; closedLineR: Vec2[] | null };   // かんたんセットアップ用（閉じた目の線。STEP1で使う）
}
export interface Project {
  schemaVersion: number;           // 現在は 1
  id: Id;
  name: string;
  assets: Asset[];
  model: Model;
  expressions: Expression[];
  animations: Animation[];
  physics: Physics[];
  trackingMappings: TrackingMapping[];   // 空なら既定のマッピング
  studio: { scenes: Scene[]; activeSceneId: Id | null; hotkeys: Hotkey[] };
}
```

### 規則（@app/schema の rules.ts）

```ts
export const STANDARD_PARAMETERS: Parameter[];                      // 標準パラメータの表（standard: true）
export const PARAMETER_GROUPS: ParameterGroup[];                    // face 顔 / eye 目 / brow 眉 / mouth 口 / cheek 頬 / body 体 / armL 左腕 / armR 右腕 / sway 揺れもの / other その他
export const STANDARD_PART_NAMES: Record<StandardPartType, string>; // 日本語の表示名（例: eyeWhiteL → 白目 L）
export const STANDARD_DRAW_ORDER: StandardPartType[];               // 背面 → 前面（下記）
export const DEFAULT_DEPTH: Partial<Record<StandardPartType, number>>;   // 下記
export const PARALLAX_RATIO = 0.08;
// 奥行きによる移動量（px）。faceWidth は standardType 'face' の素材の幅
export function depthParallaxOffset(depth: number, value: number, faceWidth: number, axis: 'x' | 'y'): number {
  const d = depth * (value / 30) * faceWidth * PARALLAX_RATIO;
  return axis === 'x' ? d : -d;    // y は上が負
}
```

- STANDARD_DRAW_ORDER（背面 → 前面）: backHair, torso, armL, armR, neck, earL, earR, face, cheek, mouthInside, teeth, tongue, upperLip, lowerLip, mouthWhole, eyeWhiteL, eyeWhiteR, eyeWholeL, eyeWholeR, irisL, irisR, highlightL, highlightR, lowerLidL, lowerLidR, upperLidL, upperLidR, browL, browR, sideHairL, sideHairR, frontHair
- DEFAULT_DEPTH: frontHair 1.0 / browL・browR 0.6 / 目のパーツ（eyeWhite・iris・highlight・upperLid・lowerLid・eyeWhole の L・R）0.5 / 口のパーツ（upperLip・lowerLip・mouthInside・teeth・tongue・mouthWhole）0.5 / sideHairL・sideHairR 0.4 / cheek 0.4 / face 0.2 / earL・earR −0.5 / backHair −1.0

### ストアの契約（@app/contracts）

```ts
export interface Command { label: string; apply(project: Project): Project }   // 純粋関数
export interface ProjectStore {
  get(): Project;
  subscribe(listener: (project: Project) => void): () => void;
  dispatch(command: Command): void;                                          // 1回の Undo 単位
  transaction(label: string, run: (dispatch: (c: Command) => void) => void): void;   // まとめて1回の Undo
  undo(): void; redo(): void; canUndo(): boolean; canRedo(): boolean;
  load(project: Project): void;                                              // 履歴を消して置き換える
}
export interface EditorState {
  mode: ModeId;
  uiLevel: Record<ModeId, UiLevel>;
  selectedPartIds: string[];
  activeParameterIds: string[];        // 編集中のパラメータ（0〜2個）
  editorParamValues: ParamValues;      // モデリング中のプレビュー値（無いパラメータはデフォルト値）
}
export interface EditorStore { get(): EditorState; set(patch: Partial<EditorState>): void; subscribe(l: (s: EditorState) => void): () => void }
```

### 生成・セットアップの契約（@app/contracts）

```ts
export interface KeyGenerator {
  linear(binding: Binding, divisions?: number): Binding;
  depthParallax(model: Model, parameterId: 'FaceAngleX' | 'FaceAngleY'): Binding[];   // 作り直した transform バインディング
}
export interface AutoSetup { plan(project: Project): { command: Command; warnings: string[] } }
```

## 作るもの

- `createAutoSetup(): AutoSetup`。`plan(project)` は `{ command, warnings }` を返す。command は純粋な関数で、何度実行してもよい。
- 位置の基準: 画像パーツの外接矩形 = 素材の offset と幅・高さ。

1. 変形グループを作る（無いものだけ。standardType で判定）: bodyRoot・armRootL・armRootR・neckRoot・headRoot・faceGroup・eyeGroupL・eyeGroupR・mouthGroup。
2. 階層を下の木のとおりにする。割り当ての無い標準パーツは飛ばす。親の無い自由パーツは headRoot の子にする。
3. ピボット: bodyRoot = 胴体の下端中央、armRoot = 腕の上端中央、neckRoot = 首の下端中央、headRoot = 首の上端中央、faceGroup・eyeGroup・mouthGroup = 子の外接矩形の中心、髪 = 上端中央、白目 = 下端中央、その他 = 中心。首が無ければ neckRoot と headRoot は顔の下端中央、胴体が無ければ bodyRoot はキャンバスの下端中央。
4. 描画順: STANDARD_DRAW_ORDER の順に並べ、標準外の画像パーツは親の直前（手前）に入れる。
5. マスク: 瞳・ハイライト → 同じ側の白目、歯・舌 → 口の中（1つずつ、反転なし）。
6. 奥行き: depth が 0 のパーツだけ DEFAULT_DEPTH を入れる（ユーザーが変えた値は残す）。
7. MVP の標準パラメータが無ければ足す。
8. バインディング（すべて transform、source 'auto'）。既存のキーのうち manual と locked は残し、それ以外を作り直す。

| パラメータ | 対象 | 内容（キー以外の値の差分は 0） |
| --- | --- | --- |
| EyeBallX | 瞳・ハイライト | 値 1 で Δposition.x = 白目の幅 × 0.25、値 −1 で逆 |
| EyeBallY | 瞳・ハイライト | 値 1 で Δposition.y = −白目の高さ × 0.2、値 −1 で逆 |
| FaceAngleZ | neckRoot・headRoot | 値 30 で Δrotation = 9（首）・21（頭）、−30 で逆 |
| FaceAngleX / Y | headRoot 配下の画像パーツ | Δposition = depthParallaxOffset(depth, 値, 顔の幅, x または y)。顔の輪郭は FaceAngleX のとき Δscale.x = 1 − 0.04×│値│/30。キーは −30・0・30 |
| EyeOpenL / R | 同じ側の上まぶた・白目・下まぶた | 値 0 で: 上まぶた Δposition.y = 白目の下端 − 上まぶたの下端、白目 Δscale.y = 0.08、下まぶた Δposition.y = −白目の高さ × 0.1 |
| MouthOpen | 下唇・舌・口の中 | 値 1 で: 下唇と舌 Δposition.y = 口の中の高さ × 0.6、口の中 Δposition.y = 口の中の高さ × 0.3 |

- 目を1枚（eyeWhole）で割り当てた場合は、値 0 で eyeWhole の Δscale.y = 0.1（ピボットは中心）。口を1枚（mouthWhole）で割り当てた場合は、値 1 で Δscale.y = 1.6。
- キーの位置は表の値とデフォルト値（例: EyeOpen は 0 と 1）。
9. warnings: 推奨パーツ（白目・瞳・上まぶた・上唇・下唇・口の中）が足りないとき、動きがどう簡易になるかの文（例: 「上まぶたがないため、まばたきは目全体を縦に縮める方式になります」）。

階層の木:

```
bodyRoot
├ torso
├ armRootL └ armL
├ armRootR └ armR
└ neckRoot
   ├ neck
   └ headRoot
      ├ backHair
      ├ faceGroup
      │ ├ face
      │ ├ eyeGroupL: eyeWhiteL, irisL, highlightL, upperLidL, lowerLidL, eyeWholeL
      │ ├ eyeGroupR: eyeWhiteR, irisR, highlightR, upperLidR, lowerLidR, eyeWholeR
      │ ├ browL, browR
      │ ├ mouthGroup: mouthInside, teeth, tongue, upperLip, lowerLip, mouthWhole
      │ └ cheek
      ├ earL, earR
      ├ sideHairL, sideHairR
      └ frontHair
```

## 作らないもの

曲面の顔の向き・曲線のまばたき・眉や口の形（STEP1）。

## 完了条件

- [ ] fixtures の sample-model で、階層・ピボット・描画順・マスクが表のとおり
- [ ] 各バインディングのキーの位置と差分の符号が表のとおり
- [ ] 再実行で manual と locked のキーが残る
- [ ] 推奨パーツが足りないときに警告が出て、代わりの方式になる


---

# 12. WebGL2レンダラー（マスク・背景を含む）

> このカードだけで実装できるように、必要な仕様・型・約束をすべて書いている。ほかのカードや設計書を読む必要はない。「前提」に書いたものは、このカードの時点で必ずある。名前と形を変えないこと。

| 項目 | 内容 |
| --- | --- |
| フェーズ / 段階 | MVP / M1 部品 |
| 並行作業 | 同じ段階の 06〜22 と並行して作れる（触るフォルダは重ならない） |
| 担当の目安 | 描画 |
| 作業場所 | packages/render/src/ |

## 目的

変形済みのモデルを、透過の縁が黒ずまない品質で GPU 描画する。

## 前提（このカードの時点ですでにあるもの）

`@app/schema` と `@app/contracts` に下の型とインターフェースがある。

抜粋に名前だけ出てくる型も、すべて `@app/schema` か `@app/contracts` から import できる。

### 基本の型（@app/schema）

```ts
export type Id = string;
export interface Vec2 { x: number; y: number }
export type BlendMode = 'normal' | 'multiply' | 'screen' | 'add';
export type ParameterGroupId = 'face' | 'eye' | 'brow' | 'mouth' | 'cheek' | 'body' | 'armL' | 'armR' | 'sway' | 'other';
export type ModeId = 'modeling' | 'animation' | 'studio';
export type UiLevel = 'easy' | 'detail';
export function newId(): string;   // ULID
```

### 変形の契約（@app/contracts）

```ts
export interface DrawItem {
  partId: string; assetId: string;
  positions: Float32Array;         // 変形後の頂点（キャンバス座標）[x0, y0, x1, y1, ...]
  uvs: Float32Array;               // [u0, v0, ...]（0..1）
  indices: Uint32Array;
  opacity: number;                 // 親まで掛けた最終値
  blendMode: BlendMode;
  mask: { sourcePartIds: string[]; inverted: boolean } | null;
}
export interface DeformedModel {
  items: DrawItem[];               // 描画順（背面 → 前面）。非表示のパーツは含めない
  byPartId: Record<string, DrawItem>;
}
export interface DeformPipeline { deform(model: Model, deltas: TargetDeltas): DeformedModel }
```

### 描画の契約（@app/contracts）

```ts
export type Background = { type: 'transparent' } | { type: 'color'; color: string } | { type: 'image'; image: ImageBitmap };
export interface ViewTransform { scale: number; offset: Vec2 }   // 画面座標（CSSピクセル）= キャンバス座標 × scale + offset
export interface Renderer {
  init(canvas: HTMLCanvasElement): void;
  setTextures(images: Record<string, ImageBitmap>): void;       // assetId → 画像
  render(model: DeformedModel, view: ViewTransform, background: Background): void;
  dispose(): void;
}
```

## 作るもの

- `createWebGLRenderer(): Renderer`。
- コンテキスト: WebGL2、alpha true、premultipliedAlpha true、antialias true。CSSサイズ × devicePixelRatio で描画バッファを合わせる。
- テクスチャ: 乗算済みアルファで持つ（UNPACK_PREMULTIPLY_ALPHA_WEBGL）。ミップマップと LINEAR_MIPMAP_LINEAR。MAX_TEXTURE_SIZE を超える画像は縮小して console.warn。
- 描画: 背景 → items の順。不透明度は uniform で掛ける。合成は `blend.ts` の `applyBlend(gl, mode: BlendMode)` に集める。今は normal（ONE, ONE_MINUS_SRC_ALPHA）だけを実装し、ほかの値も normal で描く（後のカードで足す）。
- マスク: マスク元（sourcePartIds の items）のアルファを、画面サイズの1チャンネルのオフスクリーンへ最大値で描く（＝範囲の和）。inverted なら 1 − a にする。その値を対象のアルファに掛けて描く。マスク元の形には、マスク元自身のマスクを掛けない。マスク元が items に無い（非表示など）場合は空のマスク（対象は表示されない）。同じマスク元の組の結果はフレーム内で使い回してよい。
- 背景: transparent はアルファ 0 で消す。color は塗る。image は縦横比を保って全体を覆う。
- view: 画面座標 = キャンバス座標 × scale + offset（CSSピクセル）。
- コンテキストを失って復帰したら、テクスチャを作り直す。

## 作らないもの

乗算・スクリーン・加算の合成（STEP1）、出力ウィンドウ。

## 完了条件

- [ ] 1枚の画像が正しい位置・色で描かれる（ピクセルのテスト。Vitest のブラウザモードか Playwright）
- [ ] 半透明の縁を白背景に描いたとき、期待値との差が ±2 以内（黒ずまない）
- [ ] 不透明度と描画順
- [ ] マスク: 範囲外が消える、反転、複数のマスク元の和
- [ ] 透明背景でアルファが 0 になる
- [ ] 60個・頂点 5,000 の描画が基準PCで 60fps（手動で確認）


---

# 13. PNG・PSDの取り込み

> このカードだけで実装できるように、必要な仕様・型・約束をすべて書いている。ほかのカードや設計書を読む必要はない。「前提」に書いたものは、このカードの時点で必ずある。名前と形を変えないこと。

| 項目 | 内容 |
| --- | --- |
| フェーズ / 段階 | MVP / M1 部品 |
| 並行作業 | 同じ段階の 06〜22 と並行して作れる（触るフォルダは重ならない） |
| 担当の目安 | 入出力 |
| 作業場所 | packages/io/src/import/ |

## 目的

PNG と PSD から、位置を保ったトリミング済みの素材を作り、問題があれば警告する。

## 前提（このカードの時点ですでにあるもの）

`@app/schema` と `@app/contracts` に下の型とインターフェースがある。ID は `newId()`（@app/schema）で作る。

抜粋に名前だけ出てくる型も、すべて `@app/schema` か `@app/contracts` から import できる。

### 座標と値の約束

- 座標はキャンバス（元のPSD・PNG）のピクセル。原点は左上、x は右、y は下が正。
- 回転は度。画面上の時計回りが正。
- L / R はキャラクター自身から見た左右。画面では L が右側に描かれる。
- FaceAngleX はキャラクターが画面の右を向くと正、FaceAngleY は上を向くと正、FaceAngleZ は時計回りが正。EyeBallX は画面の右を見ると正、EyeBallY は上を見ると正。
- 基準状態 = 素材を配置しただけの状態 = 全パラメータがデフォルト値の状態。素材は「目を開け、口を閉じた」状態で描かれている前提。
- キーは基準状態からの差分。位置・回転・頂点は加算、拡縮・不透明度は倍率（1 = 変化なし）。

### 基本の型（@app/schema）

```ts
export type Id = string;
export interface Vec2 { x: number; y: number }
export type BlendMode = 'normal' | 'multiply' | 'screen' | 'add';
export type ParameterGroupId = 'face' | 'eye' | 'brow' | 'mouth' | 'cheek' | 'body' | 'armL' | 'armR' | 'sway' | 'other';
export type ModeId = 'modeling' | 'animation' | 'studio';
export type UiLevel = 'easy' | 'detail';
export function newId(): string;   // ULID
```

### Asset（@app/schema）

```ts
export interface Asset {
  id: Id;
  path: string;                    // 例: assets/<id>.png
  hash: string;                    // png の SHA-256（16進）
  width: number; height: number;   // トリミング後のサイズ
  offset: Vec2;                    // トリミング後の左上のキャンバス座標
  canvasSize: { width: number; height: number };
  source: { kind: 'psd' | 'png'; file: string; layerName?: string; layerPath?: string[]; hidden?: boolean };
  sourceBlendMode: BlendMode;
  sourceOpacity: number;           // 0..1
}
```

### 取り込み・保存の契約（@app/contracts）

```ts
export interface FileSystem {          // パスは / 区切りの絶対パス
  readText(path: string): Promise<string>; writeText(path: string, data: string): Promise<void>;
  readBinary(path: string): Promise<Uint8Array>; writeBinary(path: string, data: Uint8Array): Promise<void>;
  exists(path: string): Promise<boolean>; mkdir(path: string): Promise<void>;
  list(dir: string): Promise<string[]>; remove(path: string): Promise<void>; rename(from: string, to: string): Promise<void>;
}
export interface ImportedAsset { asset: Asset; png: Uint8Array }   // png はトリミング済み
export interface ImportWarning { kind: 'canvasMismatch' | 'noTransparency' | 'resolution' | 'needsMerge'; assetIds: string[]; layerNames: string[]; message: string }
export interface Importer { importFiles(files: { name: string; data: Uint8Array }[]): Promise<{ assets: ImportedAsset[]; warnings: ImportWarning[] }> }
export interface ProjectIO {
  save(dir: string, project: Project, assetPngs: Record<string, Uint8Array>): Promise<void>;
  load(dir: string): Promise<{ project: Project; assetPngs: Record<string, Uint8Array> }>;
}
export interface AutoSaver { start(dir: string): void; stop(): void; findRecoverable(dir: string): Promise<string | null> }
```

## 作るもの

- `createImporter(): Importer`。ブラウザ（WebView2）で動くこと。ファイルの中身は Uint8Array で受け取る。
- PNG: 復号し（例: UPNG.js）、透明な余白をトリミングする。offset = 残った矩形の左上、canvasSize = 元の画像サイズ。最初のファイルとサイズが違う PNG には canvasMismatch を出し、その offset は (0,0) にする。
- PSD（ag-psd）: グループの中も含めたラスタレイヤーを1枚ずつ素材にする。offset = レイヤーの左上 + トリミング分、layerName、layerPath（グループ名の配列）、sourceOpacity、hidden（非表示でも取り込む）。
- 合成モードの対応: normal → 'normal'、multiply → 'multiply'、screen → 'screen'、linear dodge → 'add'、ほかは 'normal'。
- 統合が必要なレイヤー（クリッピング、normal 以外の合成モード、調整レイヤー、レイヤー効果、スマートオブジェクト）は needsMerge の警告に集める。取り込みは止めず、通常のラスタとして読む。
- そのほかの警告: noTransparency（四隅のピクセルが不透明で、全体の 99% 以上が不透明）、resolution（キャンバスの長辺が 1000px 未満か 8000px 超）。
- 出力: トリミング後の PNG（png）、hash = png の SHA-256（16進）、path = `assets/<id>.png`。

## 作らないもの

合成モードの引き継ぎとクリッピングの自動統合（STEP1）、PSD の再読み込み（STEP1）。

## 完了条件

- [ ] テストの中で ag-psd で作った PSD で: 位置、トリミング、非表示、layerPath、合成モードの対応、needsMerge
- [ ] PNG: サイズ違いの canvasMismatch、noTransparency、resolution
- [ ] hash と path が正しい


---

# 14. 保存・読み込み・自動保存

> このカードだけで実装できるように、必要な仕様・型・約束をすべて書いている。ほかのカードや設計書を読む必要はない。「前提」に書いたものは、このカードの時点で必ずある。名前と形を変えないこと。

| 項目 | 内容 |
| --- | --- |
| フェーズ / 段階 | MVP / M1 部品 |
| 並行作業 | 同じ段階の 06〜22 と並行して作れる（触るフォルダは重ならない） |
| 担当の目安 | 入出力 |
| 作業場所 | packages/io/src/project/ |

## 目的

プロジェクトをフォルダに保存・読み込みし、自動保存と異常終了からの復元を用意する。

## 前提（このカードの時点ですでにあるもの）

`@app/schema` と `@app/contracts` に下の型・関数・インターフェースがある。

抜粋に名前だけ出てくる型も、すべて `@app/schema` か `@app/contracts` から import できる。

### Model と Project（@app/schema）

```ts
export interface Model {
  parts: Part[];
  meshes: Mesh[];
  warps: Warp[];
  drawOrder: Id[];                 // 画像パーツの id。背面 → 前面
  parameters: Parameter[];
  parameterGroups: ParameterGroup[];
  bindings: Binding[];
  lipSync: LipSync;
  setupHints: { closedLineL: Vec2[] | null; closedLineR: Vec2[] | null };   // かんたんセットアップ用（閉じた目の線。STEP1で使う）
}
export interface Project {
  schemaVersion: number;           // 現在は 1
  id: Id;
  name: string;
  assets: Asset[];
  model: Model;
  expressions: Expression[];
  animations: Animation[];
  physics: Physics[];
  trackingMappings: TrackingMapping[];   // 空なら既定のマッピング
  studio: { scenes: Scene[]; activeSceneId: Id | null; hotkeys: Hotkey[] };
}
```

### スキーマの関数（@app/schema）

```ts
export const SCHEMA_VERSION = 1;
export function validateProject(json: unknown): Project;       // 失敗時は項目のパス付きのエラー
export function migrate(json: unknown): unknown;               // 古い版を現在の版へ変換
export function loadProjectJson(text: string): Project;        // 解析 → migrate → validate
export function createEmptyProject(name: string): Project;     // MVPの標準パラメータ入り
export function ensureStandardParameters(model: Model, phase: 'mvp' | 'step1' | 'step2'): Model;
```

### 取り込み・保存の契約（@app/contracts）

```ts
export interface FileSystem {          // パスは / 区切りの絶対パス
  readText(path: string): Promise<string>; writeText(path: string, data: string): Promise<void>;
  readBinary(path: string): Promise<Uint8Array>; writeBinary(path: string, data: Uint8Array): Promise<void>;
  exists(path: string): Promise<boolean>; mkdir(path: string): Promise<void>;
  list(dir: string): Promise<string[]>; remove(path: string): Promise<void>; rename(from: string, to: string): Promise<void>;
}
export interface ImportedAsset { asset: Asset; png: Uint8Array }   // png はトリミング済み
export interface ImportWarning { kind: 'canvasMismatch' | 'noTransparency' | 'resolution' | 'needsMerge'; assetIds: string[]; layerNames: string[]; message: string }
export interface Importer { importFiles(files: { name: string; data: Uint8Array }[]): Promise<{ assets: ImportedAsset[]; warnings: ImportWarning[] }> }
export interface ProjectIO {
  save(dir: string, project: Project, assetPngs: Record<string, Uint8Array>): Promise<void>;
  load(dir: string): Promise<{ project: Project; assetPngs: Record<string, Uint8Array> }>;
}
export interface AutoSaver { start(dir: string): void; stop(): void; findRecoverable(dir: string): Promise<string | null> }
```

### ストアの契約（@app/contracts）

```ts
export interface Command { label: string; apply(project: Project): Project }   // 純粋関数
export interface ProjectStore {
  get(): Project;
  subscribe(listener: (project: Project) => void): () => void;
  dispatch(command: Command): void;                                          // 1回の Undo 単位
  transaction(label: string, run: (dispatch: (c: Command) => void) => void): void;   // まとめて1回の Undo
  undo(): void; redo(): void; canUndo(): boolean; canRedo(): boolean;
  load(project: Project): void;                                              // 履歴を消して置き換える
}
export interface EditorState {
  mode: ModeId;
  uiLevel: Record<ModeId, UiLevel>;
  selectedPartIds: string[];
  activeParameterIds: string[];        // 編集中のパラメータ（0〜2個）
  editorParamValues: ParamValues;      // モデリング中のプレビュー値（無いパラメータはデフォルト値）
}
export interface EditorStore { get(): EditorState; set(patch: Partial<EditorState>): void; subscribe(l: (s: EditorState) => void): () => void }
```

## 作るもの

- `createProjectIO(fs: FileSystem): ProjectIO`。フォルダの構成は `project.json`・`assets/`・`backups/`。
- save: project.json を整形して書く（schemaVersion を先頭に）。`assets/<id>.png` は hash が変わったものだけ書く。書き込みは `.tmp` に書いてから rename する。
- load: project.json を読み、版が古ければ変換前のファイルを `backups/project.v<版>.<日時>.json` に写してから変換し、検証する。参照している素材のファイルが無ければ、その id を並べたエラーにする。
- `createAutoSaver(fs, io, store, getAssetPngs: () => Record<string, Uint8Array>): AutoSaver`。start(dir) でストアを購読し、最後の変更から5秒後に `backups/autosave-<日時>.json` を書く（素材は assets/ に無いものだけ書く）。古いものから消して10世代を保つ。stop() で止める。
- findRecoverable(dir): project.json より新しい自動保存があれば、そのパスを返す。
- 保存先がまだ無い新規のプロジェクトは、呼び出し側がアプリのデータフォルダの `unsaved/<project.id>/` を dir として渡す。

## 作らないもの

保存・読み込みのメニューやダイアログ（結合のカード）。

## 完了条件

- [ ] MemoryFileSystem で、保存 → 読み込みが同じ内容になる
- [ ] 書き込みが .tmp → rename になっている
- [ ] 古い版の読み込みで変換前のファイルが backups/ に残る
- [ ] 素材のファイルが無いときのエラー
- [ ] 自動保存が10世代を超えない、findRecoverable が正しく判定する


---

# 15. カメラと顔の推定

> このカードだけで実装できるように、必要な仕様・型・約束をすべて書いている。ほかのカードや設計書を読む必要はない。「前提」に書いたものは、このカードの時点で必ずある。名前と形を変えないこと。

| 項目 | 内容 |
| --- | --- |
| フェーズ / 段階 | MVP / M1 部品 |
| 並行作業 | 同じ段階の 06〜22 と並行して作れる（触るフォルダは重ならない） |
| 担当の目安 | トラッキング |
| 作業場所 | packages/tracking/src/source/ |

## 目的

Webカメラの映像から、顔の向き・目・口の状態を PC の中で推定する。

## 前提（このカードの時点ですでにあるもの）

`@app/contracts` に下のインターフェースがある。

抜粋に名前だけ出てくる型も、すべて `@app/schema` か `@app/contracts` から import できる。

### 座標と値の約束

- 座標はキャンバス（元のPSD・PNG）のピクセル。原点は左上、x は右、y は下が正。
- 回転は度。画面上の時計回りが正。
- L / R はキャラクター自身から見た左右。画面では L が右側に描かれる。
- FaceAngleX はキャラクターが画面の右を向くと正、FaceAngleY は上を向くと正、FaceAngleZ は時計回りが正。EyeBallX は画面の右を見ると正、EyeBallY は上を見ると正。
- 基準状態 = 素材を配置しただけの状態 = 全パラメータがデフォルト値の状態。素材は「目を開け、口を閉じた」状態で描かれている前提。
- キーは基準状態からの差分。位置・回転・頂点は加算、拡縮・不透明度は倍率（1 = 変化なし）。

### トラッキングの契約（@app/contracts）

```ts
export interface TrackingFrame {
  time: number;                    // ミリ秒（performance.now）
  detected: boolean;
  faceYaw: number;                 // 度。ユーザーが自分の右を向くと正
  facePitch: number;               // 度。上を向くと正
  faceRoll: number;                // 度。ユーザーが自分の右へ傾けると正
  eyeOpenL: number; eyeOpenR: number;   // 0..1。ユーザー自身の左目・右目
  eyeBallX: number;                // -1..1。ユーザーが自分の右を見ると正
  eyeBallY: number;                // -1..1。上を見ると正
  mouthOpen: number;               // 0..1
}
export interface TrackingSource {
  listDevices(): Promise<{ id: string; label: string }[]>;
  start(deviceId?: string): Promise<void>;
  stop(): void;
  onFrame(listener: (frame: TrackingFrame) => void): () => void;
}
export interface TrackingLayerProducer {
  update(frame: TrackingFrame): void;
  tick(now: number): Layer;        // id 'tracking'
  status(): 'tracking' | 'lost';
  setMirror(on: boolean): void;
  setLostBehavior(b: 'returnToFront' | 'hold'): void;
}
```

## 作るもの

- `createMediaPipeTrackingSource(): TrackingSource`。
- カメラ: getUserMedia（deviceId を指定、1280×720・30fps を優先）。listDevices は videoinput の一覧。
- 推定: MediaPipe Tasks Vision の FaceLandmarker（runningMode 'VIDEO'、outputFaceBlendshapes と outputFacialTransformationMatrixes を有効、GPU を優先して失敗したら CPU）。モデルのファイルはアプリに同梱し、実行時にネットワークを使わない。
- requestVideoFrameCallback ごとに推定し、TrackingFrame を出す。
  - faceYaw・facePitch・faceRoll: 変換行列から求める（度。符号は TrackingFrame の約束どおり）。
  - eyeOpenL・R: 1 − eyeBlink。被写体自身の左右に合わせる（MediaPipe の Left / Right の向きを実機で確かめ、テストに残す）。
  - eyeBallX・Y: eyeLookIn / Out / Up / Down から −1..1。
  - mouthOpen: jawOpen。
  - 顔が無いフレームは detected false（ほかの値は前回のまま）。
- 変換は純粋関数（matrixToAngles・blendshapesToFrame）に分けてテストする。
- 推定が追いつかないフレームは捨て、30fps 以上を保つ。カメラの映像は外部に送らない。

## 作らないもの

パラメータへの写像、スムージング（別のカード）。

## 完了条件

- [ ] カメラの一覧・開始・停止ができる
- [ ] 基準PCで 30fps 以上
- [ ] 変換関数のテスト（向きと左右の符号）
- [ ] カメラを手で覆うと detected が false になる


---

# 16. マッピング・スムージング・外れたときの復帰

> このカードだけで実装できるように、必要な仕様・型・約束をすべて書いている。ほかのカードや設計書を読む必要はない。「前提」に書いたものは、このカードの時点で必ずある。名前と形を変えないこと。

| 項目 | 内容 |
| --- | --- |
| フェーズ / 段階 | MVP / M1 部品 |
| 並行作業 | 同じ段階の 06〜22 と並行して作れる（触るフォルダは重ならない） |
| 担当の目安 | トラッキング |
| 作業場所 | packages/tracking/src/mapping/ |

## 目的

トラッキングの値をパラメータへ写し、滑らかにし、顔が外れたら正面へ戻す。

## 前提（このカードの時点ですでにあるもの）

`@app/schema` と `@app/contracts` に下の型とインターフェースがある。

抜粋に名前だけ出てくる型も、すべて `@app/schema` か `@app/contracts` から import できる。

### 座標と値の約束

- 座標はキャンバス（元のPSD・PNG）のピクセル。原点は左上、x は右、y は下が正。
- 回転は度。画面上の時計回りが正。
- L / R はキャラクター自身から見た左右。画面では L が右側に描かれる。
- FaceAngleX はキャラクターが画面の右を向くと正、FaceAngleY は上を向くと正、FaceAngleZ は時計回りが正。EyeBallX は画面の右を見ると正、EyeBallY は上を見ると正。
- 基準状態 = 素材を配置しただけの状態 = 全パラメータがデフォルト値の状態。素材は「目を開け、口を閉じた」状態で描かれている前提。
- キーは基準状態からの差分。位置・回転・頂点は加算、拡縮・不透明度は倍率（1 = 変化なし）。

### Parameter と ParameterGroup（@app/schema）

```ts
export interface ParameterGroup { id: ParameterGroupId; name: string }
export interface Parameter {
  id: Id;                          // 標準は 'FaceAngleX' など。ユーザー定義は任意の文字列
  name: string;                    // 表示名
  groupId: ParameterGroupId;
  min: number; max: number; default: number;
  standard: boolean;
}
```

### TrackingMapping（@app/schema）

```ts
export type TrackingInput = 'faceYaw' | 'facePitch' | 'faceRoll' | 'eyeOpenL' | 'eyeOpenR' | 'eyeBallX' | 'eyeBallY'
  | 'mouthOpen' | 'mouthForm' | 'mouthWidth' | 'browY';
export interface TrackingMapping {
  input: TrackingInput; parameterId: Id;
  inputRange: [number, number]; outputRange: [number, number];
  invert: boolean; curve: 'linear' | 'smooth';
  smoothing: number;               // 0..1
  deadZone: number;                // 入力の単位
}
```

### トラッキングの契約（@app/contracts）

```ts
export interface TrackingFrame {
  time: number;                    // ミリ秒（performance.now）
  detected: boolean;
  faceYaw: number;                 // 度。ユーザーが自分の右を向くと正
  facePitch: number;               // 度。上を向くと正
  faceRoll: number;                // 度。ユーザーが自分の右へ傾けると正
  eyeOpenL: number; eyeOpenR: number;   // 0..1。ユーザー自身の左目・右目
  eyeBallX: number;                // -1..1。ユーザーが自分の右を見ると正
  eyeBallY: number;                // -1..1。上を見ると正
  mouthOpen: number;               // 0..1
}
export interface TrackingSource {
  listDevices(): Promise<{ id: string; label: string }[]>;
  start(deviceId?: string): Promise<void>;
  stop(): void;
  onFrame(listener: (frame: TrackingFrame) => void): () => void;
}
export interface TrackingLayerProducer {
  update(frame: TrackingFrame): void;
  tick(now: number): Layer;        // id 'tracking'
  status(): 'tracking' | 'lost';
  setMirror(on: boolean): void;
  setLostBehavior(b: 'returnToFront' | 'hold'): void;
}
```

### 合成の契約（@app/contracts）

```ts
export type LayerId = 'tracking' | 'bodyFollow' | 'expression' | 'animation' | 'lipSync' | 'periodic' | 'physics';
export const LAYER_ORDER: LayerId[] = ['tracking', 'bodyFollow', 'expression', 'animation', 'lipSync', 'periodic', 'physics'];
export interface Layer {
  id: LayerId;
  weight: number;                     // 0..1
  values: ParamValues;                // このレイヤーが担当するパラメータの値だけ
  blend?: Record<string, BlendOp>;    // パラメータごとの合成方法。無ければ override
}
export interface ParameterMixer { mix(parameters: Parameter[], layers: Layer[]): ParamValues }

// スタジオの1フレームの文脈。producer は LAYER_ORDER の順に呼ばれる
export interface FrameContext {
  now: number; dt: number;            // ミリ秒
  project: Project;
  mixedSoFar: ParamValues;            // それまでのレイヤーを合成した値
  flags: { lipSyncWeight: number; physicsActive: boolean };   // 前のレイヤーが後のレイヤーへ伝える値（初期値 1・true）
}
export interface LayerProducer { id: LayerId; produce(ctx: FrameContext): Layer | null }
```

## 作るもの

- `createTrackingLayerProducer(parameters: Parameter[], mappings?: TrackingMapping[]): TrackingLayerProducer`。
- 既定のマッピング（mappings が空のとき）: faceYaw → FaceAngleX、facePitch → FaceAngleY、faceRoll → FaceAngleZ（[−30, 30] → [−30, 30]）、eyeOpenL / R → EyeOpenL / R、eyeBallX / Y → EyeBallX / Y、mouthOpen → MouthOpen（同じ範囲のまま）。
- ミラー（初期値オン）: オンでは鏡のように映す。yaw・roll・eyeBallX はそのままの符号にし、左右の目を入れ替える（ユーザーの右目 → EyeOpenL）。オフでは yaw・roll・eyeBallX の符号を反転し、目は入れ替えない。
- 写像: inputRange → outputRange の線形（範囲外は丸める）、invert、deadZone（入力の中央 ± deadZone は中央の値にする）、curve 'smooth' は smoothstep。
- スムージング: 値ごとに One Euro Filter（minCutoff 1.0、beta 0.02、dCutoff 1.0 が初期値。mapping.smoothing の 0..1 を minCutoff の 3.0〜0.3 に割り当てる）。
- tick(now) が返すレイヤー: id 'tracking'、values = 写像後の値、blend なし（override）、weight は次の規則。
- 外れたとき: 最後に detected だった時刻から 0.5秒たったら、weight を 1 → 0 へ 1秒かけて下げる（ease-in-out）。値は最後の値のまま。再び detected になったら 0.3秒で 1 に戻す。setLostBehavior('hold') のときは weight を 1 のまま保つ。status() は 'tracking' か 'lost'。

## 作らないもの

キャリブレーション、簡易設定、自動まばたき（STEP1）。

## 完了条件

- [ ] 写像・invert・deadZone・丸め
- [ ] ミラーのオン・オフでの符号と左右の入れ替え
- [ ] スムージング: 段差の入力に対し、30fps で 150ms 以内に 90% へ届く
- [ ] 外れたときの weight（0.5秒・1.0秒・1.5秒の時点）と、再検出で 0.3秒で戻る
- [ ] hold のとき weight が 1 のまま


---

# 17. 素材トレイと標準パーツの割り当て

> このカードだけで実装できるように、必要な仕様・型・約束をすべて書いている。ほかのカードや設計書を読む必要はない。「前提」に書いたものは、このカードの時点で必ずある。名前と形を変えないこと。

| 項目 | 内容 |
| --- | --- |
| フェーズ / 段階 | MVP / M1 部品 |
| 並行作業 | 同じ段階の 06〜22 と並行して作れる（触るフォルダは重ならない） |
| 担当の目安 | 画面 |
| 作業場所 | apps/desktop/src/modes/modeling/assets/ |

## 目的

素材を取り込み、標準パーツの枠へドラッグで割り当てられるようにする。

## 前提（このカードの時点ですでにあるもの）

アプリの枠の差し込み口と、services（仮実装）がある。

抜粋に名前だけ出てくる型も、すべて `@app/schema` か `@app/contracts` から import できる。

### アプリの枠の差し込み口（apps/desktop/src/shell/api.ts）

```ts
export interface PanelDef { id: string; mode: ModeId; area: 'left' | 'right' | 'bottom'; title: string; order?: number; level?: 'easy' | 'detail' | 'both'; component: React.FC }
export function registerPanel(def: PanelDef): void;
export interface SectionDef { id: string; panelId: string; order?: number; level?: 'easy' | 'detail' | 'both'; component: React.FC }
export function registerPanelSection(def: SectionDef): void;      // パネルの中の <PanelSections panelId=… /> に入る
export function PanelSections(props: { panelId: string }): JSX.Element;
export function registerCenter(mode: 'studio' | 'animation', component: React.FC): void;
export function registerSetupScreen(component: React.FC): void;   // 素材が1つも無いとき中央に出す
export function registerMenuItem(item: { id: string; label: string; shortcut?: string; run(): void }): void;

export interface CanvasPointerEvent { canvasPoint: Vec2; screenPoint: Vec2; button: number; shiftKey: boolean; altKey: boolean; ctrlKey: boolean }
export interface CanvasTool {
  id: string; label: string; cursor?: string;
  onPointerDown?(e: CanvasPointerEvent): void; onPointerMove?(e: CanvasPointerEvent): void; onPointerUp?(e: CanvasPointerEvent): void;
  onKeyDown?(e: KeyboardEvent): void;
  drawOverlay?(ctx: CanvasRenderingContext2D, view: ViewTransform): void;
}
export function registerCanvasTool(tool: CanvasTool): void;        // 最初に登録したものが既定のツール
export function registerCanvasOverlay(id: string, draw: (ctx: CanvasRenderingContext2D, view: ViewTransform) => void): void;
export function useCanvas(): { view: ViewTransform; activeToolId: string; setActiveTool(id: string): void; requestRedraw(): void; lastDeformed(): DeformedModel | null; screenToCanvas(p: Vec2): Vec2 };

export function useServices(): Services;
export function useProject(): Project;
export function useDispatch(): (c: Command) => void;
export function useEditor(): [EditorState, (patch: Partial<EditorState>) => void];
export function useEnvironment(): [Environment, (patch: Partial<Environment>) => void];
export function useDialogs(): { confirm(message: string): Promise<boolean>; notify(message: string): void; prompt(message: string, initial?: string): Promise<string | null> };
export function emitAppEvent(name: string, payload?: unknown): void;
export function onAppEvent(name: string, listener: (payload: unknown) => void): () => void;
```

### サービスのまとめ（@app/contracts）

```ts
export interface Services {
  store: ProjectStore; editor: EditorStore; assets: AssetRepository; fs: FileSystem;
  evaluator: BindingEvaluator; pipeline: DeformPipeline; mixer: ParameterMixer; createRenderer(): Renderer;
  meshGenerator: MeshGenerator; keyGenerator: KeyGenerator; autoSetup: AutoSetup; keyEditor: KeyEditor;
  importer: Importer; io: ProjectIO; autoSaver: AutoSaver;
  tracking: TrackingSource; trackingLayer: TrackingLayerProducer;
}
```

### 取り込み・保存の契約（@app/contracts）

```ts
export interface FileSystem {          // パスは / 区切りの絶対パス
  readText(path: string): Promise<string>; writeText(path: string, data: string): Promise<void>;
  readBinary(path: string): Promise<Uint8Array>; writeBinary(path: string, data: Uint8Array): Promise<void>;
  exists(path: string): Promise<boolean>; mkdir(path: string): Promise<void>;
  list(dir: string): Promise<string[]>; remove(path: string): Promise<void>; rename(from: string, to: string): Promise<void>;
}
export interface ImportedAsset { asset: Asset; png: Uint8Array }   // png はトリミング済み
export interface ImportWarning { kind: 'canvasMismatch' | 'noTransparency' | 'resolution' | 'needsMerge'; assetIds: string[]; layerNames: string[]; message: string }
export interface Importer { importFiles(files: { name: string; data: Uint8Array }[]): Promise<{ assets: ImportedAsset[]; warnings: ImportWarning[] }> }
export interface ProjectIO {
  save(dir: string, project: Project, assetPngs: Record<string, Uint8Array>): Promise<void>;
  load(dir: string): Promise<{ project: Project; assetPngs: Record<string, Uint8Array> }>;
}
export interface AutoSaver { start(dir: string): void; stop(): void; findRecoverable(dir: string): Promise<string | null> }
```

### 素材の置き場の契約（@app/contracts）

```ts
export interface AssetRepository {
  put(assetId: string, png: Uint8Array): Promise<void>;   // 画像も作って保持する
  getPng(assetId: string): Uint8Array | undefined;
  getImage(assetId: string): ImageBitmap | undefined;
  getImageData(assetId: string): ImageData | undefined;   // メッシュ生成などに使う
  all(): Record<string, Uint8Array>;
  subscribe(listener: () => void): () => void;
}
export function createAssetRepository(): AssetRepository;   // 本物の実装
```

### メッシュ生成の契約（@app/contracts）

```ts
export interface MeshGenerator {
  generate(alpha: ImageData, offset: Vec2, density: 'light' | 'standard' | 'smooth'):
    { vertices: Vec2[]; uvs: Vec2[]; triangles: [number, number, number][] };   // 頂点はキャンバス座標
}
```

### 生成・セットアップの契約（@app/contracts）

```ts
export interface KeyGenerator {
  linear(binding: Binding, divisions?: number): Binding;
  depthParallax(model: Model, parameterId: 'FaceAngleX' | 'FaceAngleY'): Binding[];   // 作り直した transform バインディング
}
export interface AutoSetup { plan(project: Project): { command: Command; warnings: string[] } }
```

### Asset（@app/schema）

```ts
export interface Asset {
  id: Id;
  path: string;                    // 例: assets/<id>.png
  hash: string;                    // png の SHA-256（16進）
  width: number; height: number;   // トリミング後のサイズ
  offset: Vec2;                    // トリミング後の左上のキャンバス座標
  canvasSize: { width: number; height: number };
  source: { kind: 'psd' | 'png'; file: string; layerName?: string; layerPath?: string[]; hidden?: boolean };
  sourceBlendMode: BlendMode;
  sourceOpacity: number;           // 0..1
}
```

### Part と StandardPartType（@app/schema）

```ts
export interface Part {
  id: Id;
  name: string;
  kind: 'image' | 'group';
  standardType: StandardPartType | null;   // 自由パーツは null
  assetId: Id | null;                      // image のみ
  meshId: Id | null;                       // image のみ
  parentId: Id | null;
  position: Vec2;                          // 初期値 {x: 0, y: 0}
  rotation: number;                        // 度。初期値 0
  scale: Vec2;                             // 初期値 {x: 1, y: 1}
  pivot: Vec2;                             // 回転・拡縮の中心（キャンバス座標）
  opacity: number;                         // 0..1
  blendMode: BlendMode;
  depth: number;                           // 奥行き。手前が正（-1..1 が目安）
  mask: { sourcePartIds: Id[]; inverted: boolean } | null;
  physicsId: Id | null;
  visible: boolean;
  locked: boolean;
}
export type StandardPartType =
  | 'face' | 'earL' | 'earR' | 'cheek'
  | 'eyeWhiteL' | 'irisL' | 'highlightL' | 'upperLidL' | 'lowerLidL' | 'eyeWholeL'
  | 'eyeWhiteR' | 'irisR' | 'highlightR' | 'upperLidR' | 'lowerLidR' | 'eyeWholeR'
  | 'browL' | 'browR'
  | 'upperLip' | 'lowerLip' | 'mouthInside' | 'teeth' | 'tongue' | 'mouthWhole'
  | 'frontHair' | 'sideHairL' | 'sideHairR' | 'backHair'
  | 'neck' | 'torso' | 'armL' | 'armR'
  // 変形グループ（かんたんセットアップが作る）
  | 'bodyRoot' | 'armRootL' | 'armRootR' | 'neckRoot' | 'headRoot'
  | 'faceGroup' | 'eyeGroupL' | 'eyeGroupR' | 'mouthGroup';
```

### 規則（@app/schema の rules.ts）

```ts
export const STANDARD_PARAMETERS: Parameter[];                      // 標準パラメータの表（standard: true）
export const PARAMETER_GROUPS: ParameterGroup[];                    // face 顔 / eye 目 / brow 眉 / mouth 口 / cheek 頬 / body 体 / armL 左腕 / armR 右腕 / sway 揺れもの / other その他
export const STANDARD_PART_NAMES: Record<StandardPartType, string>; // 日本語の表示名（例: eyeWhiteL → 白目 L）
export const STANDARD_DRAW_ORDER: StandardPartType[];               // 背面 → 前面（下記）
export const DEFAULT_DEPTH: Partial<Record<StandardPartType, number>>;   // 下記
export const PARALLAX_RATIO = 0.08;
// 奥行きによる移動量（px）。faceWidth は standardType 'face' の素材の幅
export function depthParallaxOffset(depth: number, value: number, faceWidth: number, axis: 'x' | 'y'): number {
  const d = depth * (value / 30) * faceWidth * PARALLAX_RATIO;
  return axis === 'x' ? d : -d;    // y は上が負
}
```

- STANDARD_DRAW_ORDER（背面 → 前面）: backHair, torso, armL, armR, neck, earL, earR, face, cheek, mouthInside, teeth, tongue, upperLip, lowerLip, mouthWhole, eyeWhiteL, eyeWhiteR, eyeWholeL, eyeWholeR, irisL, irisR, highlightL, highlightR, lowerLidL, lowerLidR, upperLidL, upperLidR, browL, browR, sideHairL, sideHairR, frontHair
- DEFAULT_DEPTH: frontHair 1.0 / browL・browR 0.6 / 目のパーツ（eyeWhite・iris・highlight・upperLid・lowerLid・eyeWhole の L・R）0.5 / 口のパーツ（upperLip・lowerLip・mouthInside・teeth・tongue・mouthWhole）0.5 / sideHairL・sideHairR 0.4 / cheek 0.4 / face 0.2 / earL・earR −0.5 / backHair −1.0

### ストアの契約（@app/contracts）

```ts
export interface Command { label: string; apply(project: Project): Project }   // 純粋関数
export interface ProjectStore {
  get(): Project;
  subscribe(listener: (project: Project) => void): () => void;
  dispatch(command: Command): void;                                          // 1回の Undo 単位
  transaction(label: string, run: (dispatch: (c: Command) => void) => void): void;   // まとめて1回の Undo
  undo(): void; redo(): void; canUndo(): boolean; canRedo(): boolean;
  load(project: Project): void;                                              // 履歴を消して置き換える
}
export interface EditorState {
  mode: ModeId;
  uiLevel: Record<ModeId, UiLevel>;
  selectedPartIds: string[];
  activeParameterIds: string[];        // 編集中のパラメータ（0〜2個）
  editorParamValues: ParamValues;      // モデリング中のプレビュー値（無いパラメータはデフォルト値）
}
export interface EditorStore { get(): EditorState; set(patch: Partial<EditorState>): void; subscribe(l: (s: EditorState) => void): () => void }
```

## 作るもの

- セットアップ画面（registerSetupScreen）: PSD・PNG を複数ドラッグ&ドロップ → importer.importFiles → コマンド addAssets（project.assets に足し、assets.put で PNG を登録）。警告は種類ごとに一覧で出す（下の文）。
- 素材トレイ（left のパネル）: サムネイル、PSD のグループ（layerPath）ごとの折りたたみ、非表示の印、ドラッグ元。[素材を追加]。
- 割り当て（right のパネル。セットアップ画面では右側）: 標準パーツの枠を下の表のとおり部位ごとに並べる。★は推奨。
- ドロップでコマンド assign(standardType, assetIds): 画像パーツを作る（name = STANDARD_PART_NAMES、standardType、assetId、meshId = meshGenerator.generate(素材の ImageData, offset, 'standard') で作ったメッシュ、pivot = 素材の中心、depth 0、visible true、blendMode 'normal'）。drawOrder の最前面に足す。
- 1つの枠に複数の素材を入れたら、その枠をグループ（standardType を持つ）にし、各素材を子の画像パーツ（standardType null、name = レイヤー名）にする。
- 割り当ての解除・付け替えのコマンド。どれも Undo できる。
- [かんたんセットアップ]: services.autoSetup.plan(project) の command を transaction で実行し、warnings を通知で出す。

| 部位 | 枠（standardType） |
| --- | --- |
| 顔 | 顔 face、耳 L earL、耳 R earR、頬染め cheek |
| 左目 | 白目★ eyeWhiteL、瞳★ irisL、ハイライト highlightL、上まぶた★ upperLidL、下まぶた lowerLidL、目（まとめて）eyeWholeL |
| 右目 | 左目と同じ（R） |
| 眉 | 眉 L browL、眉 R browR |
| 口 | 上唇★ upperLip、下唇★ lowerLip、口の中★ mouthInside、歯 teeth、舌 tongue、口（まとめて）mouthWhole |
| 髪 | 前髪 frontHair、横髪 L sideHairL、横髪 R sideHairR、後ろ髪 backHair |
| 体 | 首 neck、胴体 torso、腕 L armL、腕 R armR |
| その他 | 自由パーツ（名前を入れる。standardType null） |

警告の文: canvasMismatch「キャンバスサイズが違う素材があります。位置は手動で合わせてください」、noTransparency「背景が透過していない素材があります」、resolution「解像度が小さすぎる（または大きすぎる）素材があります」、needsMerge「統合が必要なレイヤーがあります。ペイントソフトで統合してから取り込み直してください」＋レイヤー名の一覧。

## 作らないもの

PSD の再読み込み（STEP1）。

## 完了条件

- [ ] 仮実装で、ドロップ → 素材トレイに並ぶ、警告が出る
- [ ] 割り当てでパーツとメッシュができる、複数の素材でグループになる
- [ ] どの操作も Undo できる
- [ ] [かんたんセットアップ] で plan が呼ばれ、警告が出る


---

# 18. キャンバス編集（選択・変形・ピボット）

> このカードだけで実装できるように、必要な仕様・型・約束をすべて書いている。ほかのカードや設計書を読む必要はない。「前提」に書いたものは、このカードの時点で必ずある。名前と形を変えないこと。

| 項目 | 内容 |
| --- | --- |
| フェーズ / 段階 | MVP / M1 部品 |
| 並行作業 | 同じ段階の 06〜22 と並行して作れる（触るフォルダは重ならない） |
| 担当の目安 | 画面 |
| 作業場所 | apps/desktop/src/modes/modeling/canvas/ |

## 目的

キャンバス上でパーツを選び、移動・回転・拡縮・ピボットの調整をできるようにする。

## 前提（このカードの時点ですでにあるもの）

アプリの枠の差し込み口（キャンバスのツール）と、services（仮実装）がある。

抜粋に名前だけ出てくる型も、すべて `@app/schema` か `@app/contracts` から import できる。

### パーツの変形と計算の順序

- パーツの変形は、点 p を `p' = position + pivot + R(rotation)·(scale ⊙ (p − pivot))` に動かす。R は y が下向きの座標で `[cos −sin; sin cos]`（正の角度で時計回り）。
- 実際に使う値: `position = Part.position + Δposition`、`rotation = Part.rotation + Δrotation`、`scale = Part.scale ⊙ Δscale`、`opacity = Part.opacity × Δopacity`（Δ はキーの合成結果）。
- 取り込み直後は position (0,0)・rotation 0・scale (1,1)。メッシュの頂点と pivot はキャンバス座標。
- 画像パーツの最終頂点は内側から外側へ求める。(1) メッシュの基準頂点 + 頂点の差分 → (2) 自身のパーツの変形 → (3) 親グループのワープ（あれば）→ (4) 親グループのパーツの変形 → ルートまで (3)(4) を繰り返す。
- 不透明度は、自身から親までの値をすべて掛け合わせる。

### アプリの枠の差し込み口（apps/desktop/src/shell/api.ts）

```ts
export interface PanelDef { id: string; mode: ModeId; area: 'left' | 'right' | 'bottom'; title: string; order?: number; level?: 'easy' | 'detail' | 'both'; component: React.FC }
export function registerPanel(def: PanelDef): void;
export interface SectionDef { id: string; panelId: string; order?: number; level?: 'easy' | 'detail' | 'both'; component: React.FC }
export function registerPanelSection(def: SectionDef): void;      // パネルの中の <PanelSections panelId=… /> に入る
export function PanelSections(props: { panelId: string }): JSX.Element;
export function registerCenter(mode: 'studio' | 'animation', component: React.FC): void;
export function registerSetupScreen(component: React.FC): void;   // 素材が1つも無いとき中央に出す
export function registerMenuItem(item: { id: string; label: string; shortcut?: string; run(): void }): void;

export interface CanvasPointerEvent { canvasPoint: Vec2; screenPoint: Vec2; button: number; shiftKey: boolean; altKey: boolean; ctrlKey: boolean }
export interface CanvasTool {
  id: string; label: string; cursor?: string;
  onPointerDown?(e: CanvasPointerEvent): void; onPointerMove?(e: CanvasPointerEvent): void; onPointerUp?(e: CanvasPointerEvent): void;
  onKeyDown?(e: KeyboardEvent): void;
  drawOverlay?(ctx: CanvasRenderingContext2D, view: ViewTransform): void;
}
export function registerCanvasTool(tool: CanvasTool): void;        // 最初に登録したものが既定のツール
export function registerCanvasOverlay(id: string, draw: (ctx: CanvasRenderingContext2D, view: ViewTransform) => void): void;
export function useCanvas(): { view: ViewTransform; activeToolId: string; setActiveTool(id: string): void; requestRedraw(): void; lastDeformed(): DeformedModel | null; screenToCanvas(p: Vec2): Vec2 };

export function useServices(): Services;
export function useProject(): Project;
export function useDispatch(): (c: Command) => void;
export function useEditor(): [EditorState, (patch: Partial<EditorState>) => void];
export function useEnvironment(): [Environment, (patch: Partial<Environment>) => void];
export function useDialogs(): { confirm(message: string): Promise<boolean>; notify(message: string): void; prompt(message: string, initial?: string): Promise<string | null> };
export function emitAppEvent(name: string, payload?: unknown): void;
export function onAppEvent(name: string, listener: (payload: unknown) => void): () => void;
```

### サービスのまとめ（@app/contracts）

```ts
export interface Services {
  store: ProjectStore; editor: EditorStore; assets: AssetRepository; fs: FileSystem;
  evaluator: BindingEvaluator; pipeline: DeformPipeline; mixer: ParameterMixer; createRenderer(): Renderer;
  meshGenerator: MeshGenerator; keyGenerator: KeyGenerator; autoSetup: AutoSetup; keyEditor: KeyEditor;
  importer: Importer; io: ProjectIO; autoSaver: AutoSaver;
  tracking: TrackingSource; trackingLayer: TrackingLayerProducer;
}
```

### キー編集の契約（@app/contracts）

```ts
export type TransformChange = { dPosition?: Vec2; dRotation?: number; scaleFactor?: Vec2; opacityFactor?: number; dPivot?: Vec2 };
export type PointsTarget = { kind: 'mesh'; meshId: string } | { kind: 'warp'; warpId: string };
export interface KeyEditor {
  // EditorState の activeParameterIds と editorParamValues に応じて、基準状態かキーを変えるコマンドを返す
  transformEdit(project: Project, editor: EditorState, partIds: string[], change: TransformChange): Command | 'needsKey';
  pointsEdit(project: Project, editor: EditorState, target: PointsTarget, moves: { index: number; d: Vec2 }[]): Command | 'needsKey';
  addKeyAtCurrentValue(project: Project, editor: EditorState, target: { partId: string } | PointsTarget): Command;
}
```

### 変形の契約（@app/contracts）

```ts
export interface DrawItem {
  partId: string; assetId: string;
  positions: Float32Array;         // 変形後の頂点（キャンバス座標）[x0, y0, x1, y1, ...]
  uvs: Float32Array;               // [u0, v0, ...]（0..1）
  indices: Uint32Array;
  opacity: number;                 // 親まで掛けた最終値
  blendMode: BlendMode;
  mask: { sourcePartIds: string[]; inverted: boolean } | null;
}
export interface DeformedModel {
  items: DrawItem[];               // 描画順（背面 → 前面）。非表示のパーツは含めない
  byPartId: Record<string, DrawItem>;
}
export interface DeformPipeline { deform(model: Model, deltas: TargetDeltas): DeformedModel }
```

### ストアの契約（@app/contracts）

```ts
export interface Command { label: string; apply(project: Project): Project }   // 純粋関数
export interface ProjectStore {
  get(): Project;
  subscribe(listener: (project: Project) => void): () => void;
  dispatch(command: Command): void;                                          // 1回の Undo 単位
  transaction(label: string, run: (dispatch: (c: Command) => void) => void): void;   // まとめて1回の Undo
  undo(): void; redo(): void; canUndo(): boolean; canRedo(): boolean;
  load(project: Project): void;                                              // 履歴を消して置き換える
}
export interface EditorState {
  mode: ModeId;
  uiLevel: Record<ModeId, UiLevel>;
  selectedPartIds: string[];
  activeParameterIds: string[];        // 編集中のパラメータ（0〜2個）
  editorParamValues: ParamValues;      // モデリング中のプレビュー値（無いパラメータはデフォルト値）
}
export interface EditorStore { get(): EditorState; set(patch: Partial<EditorState>): void; subscribe(l: (s: EditorState) => void): () => void }
```

## 作るもの

- 選択・変形ツール（registerCanvasTool。既定のツールにする）:
  - クリックで、手前から見て最初に当たる DrawItem を選ぶ（三角形の内側の判定）。Shift で追加、何も無い所で解除。locked のパーツは選ばない。
  - 選択中は、外接矩形・回転ハンドル（上）・拡縮ハンドル（四隅と辺）・ピボット ◎ をオーバーレイに描く。
  - ドラッグで移動・回転（ピボット中心）・拡縮（Shift で縦横比を固定）・ピボット移動。services.keyEditor.transformEdit でコマンドを得て、1回のドラッグを1つの transaction にする。
  - 'needsKey' が返ったら「この値にキーを追加して編集」を確認し、承認されたら addKeyAtCurrentValue を実行してから、もう一度 transformEdit する。
  - ピボットの移動は、編集中のパラメータが無いときだけ。
- Transform パネル（right）: X・Y・Rotation・Scale X / Y・Pivot X / Y・Opacity を数値で表示・編集する（基準状態の値）。奥行きは「前後の位置（手前〜奥）」のスライダー（−1..1）。編集中のパラメータがあるときは読み取り専用にし、「パラメータ編集中は画面上で操作」と出す。パネルの下に `<PanelSections panelId="transform" />` を置く。

## 作らないもの

メッシュの頂点の編集、パラメータのパネル（別のカード）。

## 完了条件

- [ ] 仮実装で fixtures のモデルを選び、移動・回転・拡縮・ピボット移動ができる
- [ ] 1回のドラッグが1回の Undo になる
- [ ] Transform パネルの数値の編集が反映される
- [ ] needsKey の確認からキーを足して編集する流れ


---

# 19. パラメータパネルとキー編集

> このカードだけで実装できるように、必要な仕様・型・約束をすべて書いている。ほかのカードや設計書を読む必要はない。「前提」に書いたものは、このカードの時点で必ずある。名前と形を変えないこと。

| 項目 | 内容 |
| --- | --- |
| フェーズ / 段階 | MVP / M1 部品 |
| 並行作業 | 同じ段階の 06〜22 と並行して作れる（触るフォルダは重ならない） |
| 担当の目安 | 画面 |
| 作業場所 | apps/desktop/src/modes/modeling/parameters/、apps/desktop/src/services/keyEditor/ |

## 目的

パラメータを選んで状態を作り、間を生成できるようにする。編集をどのキーに記録するかを決める KeyEditor の本物を作る。

## 前提（このカードの時点ですでにあるもの）

アプリの枠の差し込み口と、services（仮実装）がある。

抜粋に名前だけ出てくる型も、すべて `@app/schema` か `@app/contracts` から import できる。

### 座標と値の約束

- 座標はキャンバス（元のPSD・PNG）のピクセル。原点は左上、x は右、y は下が正。
- 回転は度。画面上の時計回りが正。
- L / R はキャラクター自身から見た左右。画面では L が右側に描かれる。
- FaceAngleX はキャラクターが画面の右を向くと正、FaceAngleY は上を向くと正、FaceAngleZ は時計回りが正。EyeBallX は画面の右を見ると正、EyeBallY は上を見ると正。
- 基準状態 = 素材を配置しただけの状態 = 全パラメータがデフォルト値の状態。素材は「目を開け、口を閉じた」状態で描かれている前提。
- キーは基準状態からの差分。位置・回転・頂点は加算、拡縮・不透明度は倍率（1 = 変化なし）。

### Parameter と ParameterGroup（@app/schema）

```ts
export interface ParameterGroup { id: ParameterGroupId; name: string }
export interface Parameter {
  id: Id;                          // 標準は 'FaceAngleX' など。ユーザー定義は任意の文字列
  name: string;                    // 表示名
  groupId: ParameterGroupId;
  min: number; max: number; default: number;
  standard: boolean;
}
```

### Binding と ParameterKey（@app/schema）

```ts
export type Channel = 'transform' | 'vertices' | 'warpPoints';
export interface TransformDelta { position: Vec2; rotation: number; scale: Vec2; opacity: number }
// position・rotation は加算、scale・opacity は倍率（1 = 変化なし）
export interface Binding {
  id: Id;
  target: { type: 'part' | 'mesh' | 'warp'; id: Id };   // transform → part、vertices → mesh、warpPoints → warp
  channel: Channel;
  parameterIds: Id[];              // 1 または 2
  keyValues: number[][];           // パラメータごとのキー位置（昇順。デフォルト値を必ず含む）
  keys: ParameterKey[];
  generation: 'linear' | 'depth' | 'rotate' | 'surface' | 'ease';
  divisions: number | null;        // 中間キーの分割数（自動なら null）
}
export interface ParameterKey {
  coords: number[];                // parameterIds と同じ順の値
  delta: TransformDelta | Vec2[];  // transform は TransformDelta、それ以外は頂点・制御点ごとの差分
  source: 'manual' | 'auto' | 'generated' | 'combined';
  locked: boolean;
}
```

### Model と Project（@app/schema）

```ts
export interface Model {
  parts: Part[];
  meshes: Mesh[];
  warps: Warp[];
  drawOrder: Id[];                 // 画像パーツの id。背面 → 前面
  parameters: Parameter[];
  parameterGroups: ParameterGroup[];
  bindings: Binding[];
  lipSync: LipSync;
  setupHints: { closedLineL: Vec2[] | null; closedLineR: Vec2[] | null };   // かんたんセットアップ用（閉じた目の線。STEP1で使う）
}
export interface Project {
  schemaVersion: number;           // 現在は 1
  id: Id;
  name: string;
  assets: Asset[];
  model: Model;
  expressions: Expression[];
  animations: Animation[];
  physics: Physics[];
  trackingMappings: TrackingMapping[];   // 空なら既定のマッピング
  studio: { scenes: Scene[]; activeSceneId: Id | null; hotkeys: Hotkey[] };
}
```

### MVPの標準パラメータ

| id | 表示名 | min | max | default |
| --- | --- | --- | --- | --- |
| FaceAngleX | 顔 左右 | -30 | 30 | 0 |
| FaceAngleY | 顔 上下 | -30 | 30 | 0 |
| FaceAngleZ | 顔 傾き | -30 | 30 | 0 |
| EyeOpenL / EyeOpenR | 目 開閉 L / R | 0 | 1 | 1 |
| EyeBallX / EyeBallY | 瞳 左右 / 上下 | -1 | 1 | 0 |
| MouthOpen | 口 開閉 | 0 | 1 | 0 |

### キー編集の契約（@app/contracts）

```ts
export type TransformChange = { dPosition?: Vec2; dRotation?: number; scaleFactor?: Vec2; opacityFactor?: number; dPivot?: Vec2 };
export type PointsTarget = { kind: 'mesh'; meshId: string } | { kind: 'warp'; warpId: string };
export interface KeyEditor {
  // EditorState の activeParameterIds と editorParamValues に応じて、基準状態かキーを変えるコマンドを返す
  transformEdit(project: Project, editor: EditorState, partIds: string[], change: TransformChange): Command | 'needsKey';
  pointsEdit(project: Project, editor: EditorState, target: PointsTarget, moves: { index: number; d: Vec2 }[]): Command | 'needsKey';
  addKeyAtCurrentValue(project: Project, editor: EditorState, target: { partId: string } | PointsTarget): Command;
}
```

### 生成・セットアップの契約（@app/contracts）

```ts
export interface KeyGenerator {
  linear(binding: Binding, divisions?: number): Binding;
  depthParallax(model: Model, parameterId: 'FaceAngleX' | 'FaceAngleY'): Binding[];   // 作り直した transform バインディング
}
export interface AutoSetup { plan(project: Project): { command: Command; warnings: string[] } }
```

### アプリの枠の差し込み口（apps/desktop/src/shell/api.ts）

```ts
export interface PanelDef { id: string; mode: ModeId; area: 'left' | 'right' | 'bottom'; title: string; order?: number; level?: 'easy' | 'detail' | 'both'; component: React.FC }
export function registerPanel(def: PanelDef): void;
export interface SectionDef { id: string; panelId: string; order?: number; level?: 'easy' | 'detail' | 'both'; component: React.FC }
export function registerPanelSection(def: SectionDef): void;      // パネルの中の <PanelSections panelId=… /> に入る
export function PanelSections(props: { panelId: string }): JSX.Element;
export function registerCenter(mode: 'studio' | 'animation', component: React.FC): void;
export function registerSetupScreen(component: React.FC): void;   // 素材が1つも無いとき中央に出す
export function registerMenuItem(item: { id: string; label: string; shortcut?: string; run(): void }): void;

export interface CanvasPointerEvent { canvasPoint: Vec2; screenPoint: Vec2; button: number; shiftKey: boolean; altKey: boolean; ctrlKey: boolean }
export interface CanvasTool {
  id: string; label: string; cursor?: string;
  onPointerDown?(e: CanvasPointerEvent): void; onPointerMove?(e: CanvasPointerEvent): void; onPointerUp?(e: CanvasPointerEvent): void;
  onKeyDown?(e: KeyboardEvent): void;
  drawOverlay?(ctx: CanvasRenderingContext2D, view: ViewTransform): void;
}
export function registerCanvasTool(tool: CanvasTool): void;        // 最初に登録したものが既定のツール
export function registerCanvasOverlay(id: string, draw: (ctx: CanvasRenderingContext2D, view: ViewTransform) => void): void;
export function useCanvas(): { view: ViewTransform; activeToolId: string; setActiveTool(id: string): void; requestRedraw(): void; lastDeformed(): DeformedModel | null; screenToCanvas(p: Vec2): Vec2 };

export function useServices(): Services;
export function useProject(): Project;
export function useDispatch(): (c: Command) => void;
export function useEditor(): [EditorState, (patch: Partial<EditorState>) => void];
export function useEnvironment(): [Environment, (patch: Partial<Environment>) => void];
export function useDialogs(): { confirm(message: string): Promise<boolean>; notify(message: string): void; prompt(message: string, initial?: string): Promise<string | null> };
export function emitAppEvent(name: string, payload?: unknown): void;
export function onAppEvent(name: string, listener: (payload: unknown) => void): () => void;
```

### ストアの契約（@app/contracts）

```ts
export interface Command { label: string; apply(project: Project): Project }   // 純粋関数
export interface ProjectStore {
  get(): Project;
  subscribe(listener: (project: Project) => void): () => void;
  dispatch(command: Command): void;                                          // 1回の Undo 単位
  transaction(label: string, run: (dispatch: (c: Command) => void) => void): void;   // まとめて1回の Undo
  undo(): void; redo(): void; canUndo(): boolean; canRedo(): boolean;
  load(project: Project): void;                                              // 履歴を消して置き換える
}
export interface EditorState {
  mode: ModeId;
  uiLevel: Record<ModeId, UiLevel>;
  selectedPartIds: string[];
  activeParameterIds: string[];        // 編集中のパラメータ（0〜2個）
  editorParamValues: ParamValues;      // モデリング中のプレビュー値（無いパラメータはデフォルト値）
}
export interface EditorStore { get(): EditorState; set(patch: Partial<EditorState>): void; subscribe(l: (s: EditorState) => void): () => void }
```

## 作るもの

- パラメータパネル（right。`ParameterPanel.tsx`）: グループごとに並べ、行（`ParameterRow.tsx`）ごとにスライダー（`KeySlider.tsx`）と結果の言葉（下表）を出す。行を押すとそのパラメータを編集中にする（activeParameterIds = [id]、ほかのパラメータは editorParamValues でデフォルト値に戻す）。もう一度押すと編集をやめる（基準状態）。パネルの下に `<PanelSections panelId="parameters" />` を置く。
- スライダーにキーの印を出す（そのパラメータを使うバインディングのキー位置。● = manual・auto、○ = generated、■ = locked）。範囲の 2% 以内でキーに吸い付く。
- 編集中の表示（registerCanvasOverlay）: 「編集中: 顔 左右 ＝ 右（+30）」。キーの無い値なら「キーなし」を添える。
- [間を生成]: 編集中のパラメータを使う全バインディングに keyGenerator.linear を掛ける（1つの transaction）。FaceAngleX・FaceAngleY のときは [奥行きで作り直す]（keyGenerator.depthParallax）も出す。
- KeyEditor の本物（`services/keyEditor/index.ts` の `createKeyEditor()`。中を transform.ts・points.ts に分ける）:
  - 編集中のパラメータが無い: 基準状態を変える（Part の position・rotation・scale・pivot・opacity、メッシュやワープの基準の点）。
  - 編集中のパラメータが1つか2つ: その組と対象・チャンネル（パーツの変形 → transform、頂点 → vertices、ワープ → warpPoints）を持つバインディングを探し、無ければ作る（各 keyValues は [デフォルト値, 現在値] の昇順。デフォルト値のキーは差分 0）。現在値の組にキーがあれば、その差分に変更を足す（位置・回転・点は加算、scaleFactor・opacityFactor は掛ける）。source を 'manual' にし、かんたんモードでは locked を true にする。キーが無ければ 'needsKey'。
  - addKeyAtCurrentValue: 現在値を keyValues に足し、前後のキーから補間した差分で新しいキーを作る（見た目は変わらない）。source 'manual'。
  - dPivot は基準状態でだけ受け付ける。

| パラメータ | 結果の言葉（最小 / デフォルト / 最大） |
| --- | --- |
| 顔 左右 | 左 / 正面 / 右 |
| 顔 上下 | 下 / 正面 / 上 |
| 顔 傾き | 左へ / なし / 右へ |
| 目 開閉 L / R | 閉じる / – / 開く |
| 瞳 左右 / 上下 | 左 / 中央 / 右、下 / 中央 / 上 |
| 口 開閉 | 閉じる / – / 開く |

## 作らないもの

2Dの方向グリッド、中間キーの編集・ロック・再補間の操作（STEP1）。

## 完了条件

- [ ] 仮実装で、パラメータを選ぶとキーの印が出て、編集中の表示が出る
- [ ] キーのある値で編集すると、そのキーの差分が変わる（KeyEditor のユニットテスト）
- [ ] キーの無い値では needsKey、キーを足しても見た目が変わらない
- [ ] 基準状態の編集、2つのパラメータでの編集（ユニットテスト）
- [ ] [間を生成] と [奥行きで作り直す] が呼ばれ、Undo できる


---

# 20. パーツ構造・描画順・マスクの設定

> このカードだけで実装できるように、必要な仕様・型・約束をすべて書いている。ほかのカードや設計書を読む必要はない。「前提」に書いたものは、このカードの時点で必ずある。名前と形を変えないこと。

| 項目 | 内容 |
| --- | --- |
| フェーズ / 段階 | MVP / M1 部品 |
| 並行作業 | 同じ段階の 06〜22 と並行して作れる（触るフォルダは重ならない） |
| 担当の目安 | 画面 |
| 作業場所 | apps/desktop/src/modes/modeling/structure/ |

## 目的

パーツの親子関係と描画順を別々に編集でき、マスクを設定できるようにする。

## 前提（このカードの時点ですでにあるもの）

アプリの枠の差し込み口と、services（仮実装）がある。

抜粋に名前だけ出てくる型も、すべて `@app/schema` か `@app/contracts` から import できる。

### Part と StandardPartType（@app/schema）

```ts
export interface Part {
  id: Id;
  name: string;
  kind: 'image' | 'group';
  standardType: StandardPartType | null;   // 自由パーツは null
  assetId: Id | null;                      // image のみ
  meshId: Id | null;                       // image のみ
  parentId: Id | null;
  position: Vec2;                          // 初期値 {x: 0, y: 0}
  rotation: number;                        // 度。初期値 0
  scale: Vec2;                             // 初期値 {x: 1, y: 1}
  pivot: Vec2;                             // 回転・拡縮の中心（キャンバス座標）
  opacity: number;                         // 0..1
  blendMode: BlendMode;
  depth: number;                           // 奥行き。手前が正（-1..1 が目安）
  mask: { sourcePartIds: Id[]; inverted: boolean } | null;
  physicsId: Id | null;
  visible: boolean;
  locked: boolean;
}
export type StandardPartType =
  | 'face' | 'earL' | 'earR' | 'cheek'
  | 'eyeWhiteL' | 'irisL' | 'highlightL' | 'upperLidL' | 'lowerLidL' | 'eyeWholeL'
  | 'eyeWhiteR' | 'irisR' | 'highlightR' | 'upperLidR' | 'lowerLidR' | 'eyeWholeR'
  | 'browL' | 'browR'
  | 'upperLip' | 'lowerLip' | 'mouthInside' | 'teeth' | 'tongue' | 'mouthWhole'
  | 'frontHair' | 'sideHairL' | 'sideHairR' | 'backHair'
  | 'neck' | 'torso' | 'armL' | 'armR'
  // 変形グループ（かんたんセットアップが作る）
  | 'bodyRoot' | 'armRootL' | 'armRootR' | 'neckRoot' | 'headRoot'
  | 'faceGroup' | 'eyeGroupL' | 'eyeGroupR' | 'mouthGroup';
```

### Binding と ParameterKey（@app/schema）

```ts
export type Channel = 'transform' | 'vertices' | 'warpPoints';
export interface TransformDelta { position: Vec2; rotation: number; scale: Vec2; opacity: number }
// position・rotation は加算、scale・opacity は倍率（1 = 変化なし）
export interface Binding {
  id: Id;
  target: { type: 'part' | 'mesh' | 'warp'; id: Id };   // transform → part、vertices → mesh、warpPoints → warp
  channel: Channel;
  parameterIds: Id[];              // 1 または 2
  keyValues: number[][];           // パラメータごとのキー位置（昇順。デフォルト値を必ず含む）
  keys: ParameterKey[];
  generation: 'linear' | 'depth' | 'rotate' | 'surface' | 'ease';
  divisions: number | null;        // 中間キーの分割数（自動なら null）
}
export interface ParameterKey {
  coords: number[];                // parameterIds と同じ順の値
  delta: TransformDelta | Vec2[];  // transform は TransformDelta、それ以外は頂点・制御点ごとの差分
  source: 'manual' | 'auto' | 'generated' | 'combined';
  locked: boolean;
}
```

### Model と Project（@app/schema）

```ts
export interface Model {
  parts: Part[];
  meshes: Mesh[];
  warps: Warp[];
  drawOrder: Id[];                 // 画像パーツの id。背面 → 前面
  parameters: Parameter[];
  parameterGroups: ParameterGroup[];
  bindings: Binding[];
  lipSync: LipSync;
  setupHints: { closedLineL: Vec2[] | null; closedLineR: Vec2[] | null };   // かんたんセットアップ用（閉じた目の線。STEP1で使う）
}
export interface Project {
  schemaVersion: number;           // 現在は 1
  id: Id;
  name: string;
  assets: Asset[];
  model: Model;
  expressions: Expression[];
  animations: Animation[];
  physics: Physics[];
  trackingMappings: TrackingMapping[];   // 空なら既定のマッピング
  studio: { scenes: Scene[]; activeSceneId: Id | null; hotkeys: Hotkey[] };
}
```

### アプリの枠の差し込み口（apps/desktop/src/shell/api.ts）

```ts
export interface PanelDef { id: string; mode: ModeId; area: 'left' | 'right' | 'bottom'; title: string; order?: number; level?: 'easy' | 'detail' | 'both'; component: React.FC }
export function registerPanel(def: PanelDef): void;
export interface SectionDef { id: string; panelId: string; order?: number; level?: 'easy' | 'detail' | 'both'; component: React.FC }
export function registerPanelSection(def: SectionDef): void;      // パネルの中の <PanelSections panelId=… /> に入る
export function PanelSections(props: { panelId: string }): JSX.Element;
export function registerCenter(mode: 'studio' | 'animation', component: React.FC): void;
export function registerSetupScreen(component: React.FC): void;   // 素材が1つも無いとき中央に出す
export function registerMenuItem(item: { id: string; label: string; shortcut?: string; run(): void }): void;

export interface CanvasPointerEvent { canvasPoint: Vec2; screenPoint: Vec2; button: number; shiftKey: boolean; altKey: boolean; ctrlKey: boolean }
export interface CanvasTool {
  id: string; label: string; cursor?: string;
  onPointerDown?(e: CanvasPointerEvent): void; onPointerMove?(e: CanvasPointerEvent): void; onPointerUp?(e: CanvasPointerEvent): void;
  onKeyDown?(e: KeyboardEvent): void;
  drawOverlay?(ctx: CanvasRenderingContext2D, view: ViewTransform): void;
}
export function registerCanvasTool(tool: CanvasTool): void;        // 最初に登録したものが既定のツール
export function registerCanvasOverlay(id: string, draw: (ctx: CanvasRenderingContext2D, view: ViewTransform) => void): void;
export function useCanvas(): { view: ViewTransform; activeToolId: string; setActiveTool(id: string): void; requestRedraw(): void; lastDeformed(): DeformedModel | null; screenToCanvas(p: Vec2): Vec2 };

export function useServices(): Services;
export function useProject(): Project;
export function useDispatch(): (c: Command) => void;
export function useEditor(): [EditorState, (patch: Partial<EditorState>) => void];
export function useEnvironment(): [Environment, (patch: Partial<Environment>) => void];
export function useDialogs(): { confirm(message: string): Promise<boolean>; notify(message: string): void; prompt(message: string, initial?: string): Promise<string | null> };
export function emitAppEvent(name: string, payload?: unknown): void;
export function onAppEvent(name: string, listener: (payload: unknown) => void): () => void;
```

### サービスのまとめ（@app/contracts）

```ts
export interface Services {
  store: ProjectStore; editor: EditorStore; assets: AssetRepository; fs: FileSystem;
  evaluator: BindingEvaluator; pipeline: DeformPipeline; mixer: ParameterMixer; createRenderer(): Renderer;
  meshGenerator: MeshGenerator; keyGenerator: KeyGenerator; autoSetup: AutoSetup; keyEditor: KeyEditor;
  importer: Importer; io: ProjectIO; autoSaver: AutoSaver;
  tracking: TrackingSource; trackingLayer: TrackingLayerProducer;
}
```

### 素材の置き場の契約（@app/contracts）

```ts
export interface AssetRepository {
  put(assetId: string, png: Uint8Array): Promise<void>;   // 画像も作って保持する
  getPng(assetId: string): Uint8Array | undefined;
  getImage(assetId: string): ImageBitmap | undefined;
  getImageData(assetId: string): ImageData | undefined;   // メッシュ生成などに使う
  all(): Record<string, Uint8Array>;
  subscribe(listener: () => void): () => void;
}
export function createAssetRepository(): AssetRepository;   // 本物の実装
```

### メッシュ生成の契約（@app/contracts）

```ts
export interface MeshGenerator {
  generate(alpha: ImageData, offset: Vec2, density: 'light' | 'standard' | 'smooth'):
    { vertices: Vec2[]; uvs: Vec2[]; triangles: [number, number, number][] };   // 頂点はキャンバス座標
}
```

### ストアの契約（@app/contracts）

```ts
export interface Command { label: string; apply(project: Project): Project }   // 純粋関数
export interface ProjectStore {
  get(): Project;
  subscribe(listener: (project: Project) => void): () => void;
  dispatch(command: Command): void;                                          // 1回の Undo 単位
  transaction(label: string, run: (dispatch: (c: Command) => void) => void): void;   // まとめて1回の Undo
  undo(): void; redo(): void; canUndo(): boolean; canRedo(): boolean;
  load(project: Project): void;                                              // 履歴を消して置き換える
}
export interface EditorState {
  mode: ModeId;
  uiLevel: Record<ModeId, UiLevel>;
  selectedPartIds: string[];
  activeParameterIds: string[];        // 編集中のパラメータ（0〜2個）
  editorParamValues: ParamValues;      // モデリング中のプレビュー値（無いパラメータはデフォルト値）
}
export interface EditorStore { get(): EditorState; set(patch: Partial<EditorState>): void; subscribe(l: (s: EditorState) => void): () => void }
```

## 作るもの

- left のパネルに「パーツ構造」（`StructureTab.tsx`）と「描画順」（`DrawOrderTab.tsx`）の2つのタブ。
- パーツ構造: ツリー。ドラッグで親の変更と兄弟の並び替え（drawOrder は変えない）。表示・ロックの切り替え、名前の変更。
- 右クリック: コピー、左右反転コピー（`mirrorCopy.ts`）、グループ化、親を変更、素材を差し替え（`replaceAsset.ts`）、削除。
  - 左右反転コピー: パーツ（グループなら子孫ごと）を複製し、中心線（bodyRoot があればそのピボットの x、無ければキャンバスの中央）で左右反転する。素材は左右反転した PNG を作って新しい Asset にする（assets.put）。頂点・uv・pivot を反転する。そのパーツを対象にするバインディングも複製し、差分の x と回転の符号を反転し、パラメータ id と standardType の末尾の L / R を入れ替える（例: EyeOpenL → EyeOpenR）。
  - 素材を差し替え: トレイから選ぶ。幅と高さが同じなら assetId だけを替える。違うなら「このパーツの頂点のキーがリセットされます」と確認し、キャンバス上の位置で合わせてメッシュを作り直し（meshGenerator）、そのメッシュの vertices バインディングを消す。
  - 削除: 子孫ごと消し、関係するバインディング・drawOrder・マスクの参照も消す。
- 描画順: 画像パーツの一覧（上が前面）。ドラッグで並び替え。グループを選ぶと、子孫の画像パーツを相対順のまま一緒に動かす。
- マスク（`MaskPanel.tsx`。right の「パーツの設定」パネル。画像パーツを選んだとき）: マスク元を1つ選ぶドロップダウン（画像パーツのみ。自身と子孫は除く）と「なし」。パネルの下に `<PanelSections panelId="partSettings" />` を置く。
- すべてコマンドで行い、Undo できる。

## 作らないもの

反転マスクと複数のマスク元の画面（STEP1）、サイズ違いの差し替えでの変形の転写（STEP1）。

## 完了条件

- [ ] 親を変えても描画順が変わらない
- [ ] 描画順のドラッグと、グループごとの移動
- [ ] 左右反転コピーで差分の符号とパラメータの L / R が入れ替わる
- [ ] 差し替え（同じサイズ・違うサイズ）
- [ ] マスク元の設定と「なし」
- [ ] すべて Undo できる


---

# 21. メッシュ編集

> このカードだけで実装できるように、必要な仕様・型・約束をすべて書いている。ほかのカードや設計書を読む必要はない。「前提」に書いたものは、このカードの時点で必ずある。名前と形を変えないこと。

| 項目 | 内容 |
| --- | --- |
| フェーズ / 段階 | MVP / M1 部品 |
| 並行作業 | 同じ段階の 06〜22 と並行して作れる（触るフォルダは重ならない） |
| 担当の目安 | 画面 |
| 作業場所 | apps/desktop/src/modes/modeling/mesh/ |

## 目的

メッシュの頂点を動かし、追加・削除・自動生成できるようにする。

## 前提（このカードの時点ですでにあるもの）

アプリの枠の差し込み口（キャンバスのツール）と、services（仮実装）がある。

抜粋に名前だけ出てくる型も、すべて `@app/schema` か `@app/contracts` から import できる。

### Mesh（@app/schema）

```ts
export interface Mesh {
  id: Id;
  vertices: Vec2[];                // 基準状態の頂点（キャンバス座標）
  uvs: Vec2[];                     // 0..1（素材画像の中の位置）
  triangles: [number, number, number][];
  density: 'light' | 'standard' | 'smooth' | 'custom';
  edited: boolean;                 // 手で編集したか
}
```

### Binding と ParameterKey（@app/schema）

```ts
export type Channel = 'transform' | 'vertices' | 'warpPoints';
export interface TransformDelta { position: Vec2; rotation: number; scale: Vec2; opacity: number }
// position・rotation は加算、scale・opacity は倍率（1 = 変化なし）
export interface Binding {
  id: Id;
  target: { type: 'part' | 'mesh' | 'warp'; id: Id };   // transform → part、vertices → mesh、warpPoints → warp
  channel: Channel;
  parameterIds: Id[];              // 1 または 2
  keyValues: number[][];           // パラメータごとのキー位置（昇順。デフォルト値を必ず含む）
  keys: ParameterKey[];
  generation: 'linear' | 'depth' | 'rotate' | 'surface' | 'ease';
  divisions: number | null;        // 中間キーの分割数（自動なら null）
}
export interface ParameterKey {
  coords: number[];                // parameterIds と同じ順の値
  delta: TransformDelta | Vec2[];  // transform は TransformDelta、それ以外は頂点・制御点ごとの差分
  source: 'manual' | 'auto' | 'generated' | 'combined';
  locked: boolean;
}
```

### アプリの枠の差し込み口（apps/desktop/src/shell/api.ts）

```ts
export interface PanelDef { id: string; mode: ModeId; area: 'left' | 'right' | 'bottom'; title: string; order?: number; level?: 'easy' | 'detail' | 'both'; component: React.FC }
export function registerPanel(def: PanelDef): void;
export interface SectionDef { id: string; panelId: string; order?: number; level?: 'easy' | 'detail' | 'both'; component: React.FC }
export function registerPanelSection(def: SectionDef): void;      // パネルの中の <PanelSections panelId=… /> に入る
export function PanelSections(props: { panelId: string }): JSX.Element;
export function registerCenter(mode: 'studio' | 'animation', component: React.FC): void;
export function registerSetupScreen(component: React.FC): void;   // 素材が1つも無いとき中央に出す
export function registerMenuItem(item: { id: string; label: string; shortcut?: string; run(): void }): void;

export interface CanvasPointerEvent { canvasPoint: Vec2; screenPoint: Vec2; button: number; shiftKey: boolean; altKey: boolean; ctrlKey: boolean }
export interface CanvasTool {
  id: string; label: string; cursor?: string;
  onPointerDown?(e: CanvasPointerEvent): void; onPointerMove?(e: CanvasPointerEvent): void; onPointerUp?(e: CanvasPointerEvent): void;
  onKeyDown?(e: KeyboardEvent): void;
  drawOverlay?(ctx: CanvasRenderingContext2D, view: ViewTransform): void;
}
export function registerCanvasTool(tool: CanvasTool): void;        // 最初に登録したものが既定のツール
export function registerCanvasOverlay(id: string, draw: (ctx: CanvasRenderingContext2D, view: ViewTransform) => void): void;
export function useCanvas(): { view: ViewTransform; activeToolId: string; setActiveTool(id: string): void; requestRedraw(): void; lastDeformed(): DeformedModel | null; screenToCanvas(p: Vec2): Vec2 };

export function useServices(): Services;
export function useProject(): Project;
export function useDispatch(): (c: Command) => void;
export function useEditor(): [EditorState, (patch: Partial<EditorState>) => void];
export function useEnvironment(): [Environment, (patch: Partial<Environment>) => void];
export function useDialogs(): { confirm(message: string): Promise<boolean>; notify(message: string): void; prompt(message: string, initial?: string): Promise<string | null> };
export function emitAppEvent(name: string, payload?: unknown): void;
export function onAppEvent(name: string, listener: (payload: unknown) => void): () => void;
```

### サービスのまとめ（@app/contracts）

```ts
export interface Services {
  store: ProjectStore; editor: EditorStore; assets: AssetRepository; fs: FileSystem;
  evaluator: BindingEvaluator; pipeline: DeformPipeline; mixer: ParameterMixer; createRenderer(): Renderer;
  meshGenerator: MeshGenerator; keyGenerator: KeyGenerator; autoSetup: AutoSetup; keyEditor: KeyEditor;
  importer: Importer; io: ProjectIO; autoSaver: AutoSaver;
  tracking: TrackingSource; trackingLayer: TrackingLayerProducer;
}
```

### キー編集の契約（@app/contracts）

```ts
export type TransformChange = { dPosition?: Vec2; dRotation?: number; scaleFactor?: Vec2; opacityFactor?: number; dPivot?: Vec2 };
export type PointsTarget = { kind: 'mesh'; meshId: string } | { kind: 'warp'; warpId: string };
export interface KeyEditor {
  // EditorState の activeParameterIds と editorParamValues に応じて、基準状態かキーを変えるコマンドを返す
  transformEdit(project: Project, editor: EditorState, partIds: string[], change: TransformChange): Command | 'needsKey';
  pointsEdit(project: Project, editor: EditorState, target: PointsTarget, moves: { index: number; d: Vec2 }[]): Command | 'needsKey';
  addKeyAtCurrentValue(project: Project, editor: EditorState, target: { partId: string } | PointsTarget): Command;
}
```

### メッシュ生成の契約（@app/contracts）

```ts
export interface MeshGenerator {
  generate(alpha: ImageData, offset: Vec2, density: 'light' | 'standard' | 'smooth'):
    { vertices: Vec2[]; uvs: Vec2[]; triangles: [number, number, number][] };   // 頂点はキャンバス座標
}
```

### 素材の置き場の契約（@app/contracts）

```ts
export interface AssetRepository {
  put(assetId: string, png: Uint8Array): Promise<void>;   // 画像も作って保持する
  getPng(assetId: string): Uint8Array | undefined;
  getImage(assetId: string): ImageBitmap | undefined;
  getImageData(assetId: string): ImageData | undefined;   // メッシュ生成などに使う
  all(): Record<string, Uint8Array>;
  subscribe(listener: () => void): () => void;
}
export function createAssetRepository(): AssetRepository;   // 本物の実装
```

### ストアの契約（@app/contracts）

```ts
export interface Command { label: string; apply(project: Project): Project }   // 純粋関数
export interface ProjectStore {
  get(): Project;
  subscribe(listener: (project: Project) => void): () => void;
  dispatch(command: Command): void;                                          // 1回の Undo 単位
  transaction(label: string, run: (dispatch: (c: Command) => void) => void): void;   // まとめて1回の Undo
  undo(): void; redo(): void; canUndo(): boolean; canRedo(): boolean;
  load(project: Project): void;                                              // 履歴を消して置き換える
}
export interface EditorState {
  mode: ModeId;
  uiLevel: Record<ModeId, UiLevel>;
  selectedPartIds: string[];
  activeParameterIds: string[];        // 編集中のパラメータ（0〜2個）
  editorParamValues: ParamValues;      // モデリング中のプレビュー値（無いパラメータはデフォルト値）
}
export interface EditorStore { get(): EditorState; set(patch: Partial<EditorState>): void; subscribe(l: (s: EditorState) => void): () => void }
```

## 作るもの

- メッシュ編集ツール（registerCanvasTool）: 選択中の画像パーツのワイヤーフレームを、lastDeformed の positions で描く。
- 頂点のドラッグ: keyEditor.pointsEdit（{kind: 'mesh'}）を使う（基準状態かキーかは KeyEditor が決める）。'needsKey' のときは「この値にキーを追加して編集」を確認する。矩形で複数を選べる。
- 頂点の追加（ダブルクリック）・削除（Delete）・[自動生成]（meshGenerator.generate、'standard'）。追加と削除は、既存の頂点と変更後の点で制約付き三角形分割をやり直す（例: cdt2d）。
- 形が変わる操作で、そのメッシュの vertices バインディングにキーがあるとき: 「このパーツの頂点のキー（N個）がリセットされます」と確認し、承認されたらバインディングを消してから実行する（1つの transaction）。
- 頂点の移動だけなら、キーは消さない。
- 変更したメッシュの edited を true にする。

## 作らないもの

変形の細かさ（密度）の画面と、変形の転写（STEP1）。

## 完了条件

- [ ] ワイヤーフレームが変形後の位置に出る
- [ ] 頂点のドラッグが基準状態とキーの両方で動く
- [ ] 追加・削除・自動生成で三角形が作り直される
- [ ] キーがあるときの確認とリセット、移動だけならキーが残る
- [ ] Undo できる


---

# 22. スタジオ画面と出力ウィンドウ

> このカードだけで実装できるように、必要な仕様・型・約束をすべて書いている。ほかのカードや設計書を読む必要はない。「前提」に書いたものは、このカードの時点で必ずある。名前と形を変えないこと。

| 項目 | 内容 |
| --- | --- |
| フェーズ / 段階 | MVP / M1 部品 |
| 並行作業 | 同じ段階の 06〜22 と並行して作れる（触るフォルダは重ならない） |
| 担当の目安 | 画面 |
| 作業場所 | apps/desktop/src/modes/studio/、apps/desktop/src/output/ |

## 目的

トラッキングでモデルを動かすスタジオ画面と、配信ソフトに取り込む出力ウィンドウを作る。

## 前提（このカードの時点ですでにあるもの）

アプリの枠の差し込み口と、services（仮実装）がある。

抜粋に名前だけ出てくる型も、すべて `@app/schema` か `@app/contracts` から import できる。

### アプリの枠の差し込み口（apps/desktop/src/shell/api.ts）

```ts
export interface PanelDef { id: string; mode: ModeId; area: 'left' | 'right' | 'bottom'; title: string; order?: number; level?: 'easy' | 'detail' | 'both'; component: React.FC }
export function registerPanel(def: PanelDef): void;
export interface SectionDef { id: string; panelId: string; order?: number; level?: 'easy' | 'detail' | 'both'; component: React.FC }
export function registerPanelSection(def: SectionDef): void;      // パネルの中の <PanelSections panelId=… /> に入る
export function PanelSections(props: { panelId: string }): JSX.Element;
export function registerCenter(mode: 'studio' | 'animation', component: React.FC): void;
export function registerSetupScreen(component: React.FC): void;   // 素材が1つも無いとき中央に出す
export function registerMenuItem(item: { id: string; label: string; shortcut?: string; run(): void }): void;

export interface CanvasPointerEvent { canvasPoint: Vec2; screenPoint: Vec2; button: number; shiftKey: boolean; altKey: boolean; ctrlKey: boolean }
export interface CanvasTool {
  id: string; label: string; cursor?: string;
  onPointerDown?(e: CanvasPointerEvent): void; onPointerMove?(e: CanvasPointerEvent): void; onPointerUp?(e: CanvasPointerEvent): void;
  onKeyDown?(e: KeyboardEvent): void;
  drawOverlay?(ctx: CanvasRenderingContext2D, view: ViewTransform): void;
}
export function registerCanvasTool(tool: CanvasTool): void;        // 最初に登録したものが既定のツール
export function registerCanvasOverlay(id: string, draw: (ctx: CanvasRenderingContext2D, view: ViewTransform) => void): void;
export function useCanvas(): { view: ViewTransform; activeToolId: string; setActiveTool(id: string): void; requestRedraw(): void; lastDeformed(): DeformedModel | null; screenToCanvas(p: Vec2): Vec2 };

export function useServices(): Services;
export function useProject(): Project;
export function useDispatch(): (c: Command) => void;
export function useEditor(): [EditorState, (patch: Partial<EditorState>) => void];
export function useEnvironment(): [Environment, (patch: Partial<Environment>) => void];
export function useDialogs(): { confirm(message: string): Promise<boolean>; notify(message: string): void; prompt(message: string, initial?: string): Promise<string | null> };
export function emitAppEvent(name: string, payload?: unknown): void;
export function onAppEvent(name: string, listener: (payload: unknown) => void): () => void;
```

### サービスのまとめ（@app/contracts）

```ts
export interface Services {
  store: ProjectStore; editor: EditorStore; assets: AssetRepository; fs: FileSystem;
  evaluator: BindingEvaluator; pipeline: DeformPipeline; mixer: ParameterMixer; createRenderer(): Renderer;
  meshGenerator: MeshGenerator; keyGenerator: KeyGenerator; autoSetup: AutoSetup; keyEditor: KeyEditor;
  importer: Importer; io: ProjectIO; autoSaver: AutoSaver;
  tracking: TrackingSource; trackingLayer: TrackingLayerProducer;
}
```

### 合成の契約（@app/contracts）

```ts
export type LayerId = 'tracking' | 'bodyFollow' | 'expression' | 'animation' | 'lipSync' | 'periodic' | 'physics';
export const LAYER_ORDER: LayerId[] = ['tracking', 'bodyFollow', 'expression', 'animation', 'lipSync', 'periodic', 'physics'];
export interface Layer {
  id: LayerId;
  weight: number;                     // 0..1
  values: ParamValues;                // このレイヤーが担当するパラメータの値だけ
  blend?: Record<string, BlendOp>;    // パラメータごとの合成方法。無ければ override
}
export interface ParameterMixer { mix(parameters: Parameter[], layers: Layer[]): ParamValues }

// スタジオの1フレームの文脈。producer は LAYER_ORDER の順に呼ばれる
export interface FrameContext {
  now: number; dt: number;            // ミリ秒
  project: Project;
  mixedSoFar: ParamValues;            // それまでのレイヤーを合成した値
  flags: { lipSyncWeight: number; physicsActive: boolean };   // 前のレイヤーが後のレイヤーへ伝える値（初期値 1・true）
}
export interface LayerProducer { id: LayerId; produce(ctx: FrameContext): Layer | null }
```

### 描画の契約（@app/contracts）

```ts
export type Background = { type: 'transparent' } | { type: 'color'; color: string } | { type: 'image'; image: ImageBitmap };
export interface ViewTransform { scale: number; offset: Vec2 }   // 画面座標（CSSピクセル）= キャンバス座標 × scale + offset
export interface Renderer {
  init(canvas: HTMLCanvasElement): void;
  setTextures(images: Record<string, ImageBitmap>): void;       // assetId → 画像
  render(model: DeformedModel, view: ViewTransform, background: Background): void;
  dispose(): void;
}
```

### トラッキングの契約（@app/contracts）

```ts
export interface TrackingFrame {
  time: number;                    // ミリ秒（performance.now）
  detected: boolean;
  faceYaw: number;                 // 度。ユーザーが自分の右を向くと正
  facePitch: number;               // 度。上を向くと正
  faceRoll: number;                // 度。ユーザーが自分の右へ傾けると正
  eyeOpenL: number; eyeOpenR: number;   // 0..1。ユーザー自身の左目・右目
  eyeBallX: number;                // -1..1。ユーザーが自分の右を見ると正
  eyeBallY: number;                // -1..1。上を見ると正
  mouthOpen: number;               // 0..1
}
export interface TrackingSource {
  listDevices(): Promise<{ id: string; label: string }[]>;
  start(deviceId?: string): Promise<void>;
  stop(): void;
  onFrame(listener: (frame: TrackingFrame) => void): () => void;
}
export interface TrackingLayerProducer {
  update(frame: TrackingFrame): void;
  tick(now: number): Layer;        // id 'tracking'
  status(): 'tracking' | 'lost';
  setMirror(on: boolean): void;
  setLostBehavior(b: 'returnToFront' | 'hold'): void;
}
```

### Scene と Hotkey（@app/schema）

```ts
export interface Scene {
  id: Id; name: string;
  background: { type: 'transparent' } | { type: 'color'; color: string } | { type: 'image'; path: string };   // path はプロジェクトからの相対パス
  modelTransform: { position: Vec2; scale: number };   // 出力画面での位置（px）と倍率
  expressionIds: Id[];             // シーンに切り替えたときに適用する表情
  periodicAnimationIds: Id[];      // STEP2で使う
}
export interface Hotkey {
  id: Id;
  keys: string;                    // 例: 'Ctrl+Shift+1'
  action: 'expression' | 'scene' | 'background' | 'animation' | 'parameter' | 'pauseTracking' | 'recalibrate';
  targetId: Id | null;
  mode: 'toggle' | 'hold';
}
```

### Environment（@app/schema。PCごとの設定でプロジェクトの外に保存）

```ts
export interface Environment {
  cameraDeviceId: string | null;
  mirror: boolean;
  calibration: { neutral: { yaw: number; pitch: number; roll: number }; eyeClosed: { l: number; r: number }; mouthOpenMax: number } | null;
  microphoneDeviceId: string | null;
  silenceThreshold: number;        // dBFS
  trackingPreset: 'stable' | 'standard' | 'large' | 'custom';
  output: { method: 'window' | 'spout2'; width: number; height: number; fps: number };
  uiLevel: Record<ModeId, UiLevel>;
  lastProjectDir: string | null;
}
```

## 作るもの

- 実行部（`runtime.ts`）: 下の差し込み口を作る。トラッキングは services.trackingLayer を包んだ producer（id 'tracking'）として最初から登録する。毎フレーム（requestAnimationFrame）、LAYER_ORDER の順に producer を呼んで mixedSoFar を更新し、mixer.mix → evaluator → pipeline → プレビューの renderer と、登録された sink へ渡す。
- シーン: project.studio.activeSceneId のシーン（無ければ scenes[0]、それも無ければ作る）の背景と modelTransform を使う。
- 中央（registerCenter('studio')）: ライブプレビュー。ドラッグでモデルの位置、ホイールで大きさを変え、シーンの modelTransform に保存する。
- right のパネル（中に `<PanelSections panelId="studioSettings" />`）に、次のセクションを登録する。
  - トラッキング: カメラの選択、ミラー（初期値オン）、[開始 / 停止]、状態（検出中 / 外れている）。カメラとミラーは Environment に保存する。
  - 背景: 透明・単色（緑・青・任意の色）・画像（選んだファイルをプロジェクトの `backgrounds/` に写す）。
  - 出力: 解像度（1920×1080、1280×720、任意）と [出力ウィンドウを開く]。
- 出力ウィンドウ（`/output` の画面。UIなし）: Tauri の別ウィンドウ。開くときにプロジェクトと素材の PNG をイベントで受け取り、以後は毎フレームの ParamValues をイベントで受け取って、同じ evaluator・pipeline・renderer で描く。背景とモデルの配置も同じにする。プロジェクトが変わったら送り直す（0.5秒ごとにまとめる）。

### スタジオの実行部の差し込み口（apps/desktop/src/modes/studio/runtime.ts）

```ts
export function registerLayerProducer(p: LayerProducer): () => void;   // LayerProducer・FrameContext は @app/contracts
export interface StudioFrame { model: DeformedModel; view: ViewTransform; background: Background; params: ParamValues; now: number }
export function registerFrameSink(sink: (frame: StudioFrame) => void): () => void;
export function useStudioRuntime(): { running: boolean; status: 'tracking' | 'lost' | 'stopped'; lastFrame(): StudioFrame | null };
```

1フレームの処理: LAYER_ORDER の順に producer を呼び、呼ぶたびに mixedSoFar を更新する → mixer.mix → evaluator → pipeline → プレビューの renderer と、登録された sink へ渡す。

## 作らないもの

複数のシーン、表情、リップシンク、透過出力（STEP1）。

## 完了条件

- [ ] 仮実装のトラッキングでプレビューが動く
- [ ] 背景の切り替えとモデルの配置が保存される
- [ ] 出力ウィンドウが選んだ解像度で開き、プレビューと同じ動きになる
- [ ] 外れている状態が表示される
- [ ] registerLayerProducer と registerFrameSink がテスト用の producer・sink で動く


---

# 23. モデリングの結合

> このカードだけで実装できるように、必要な仕様・型・約束をすべて書いている。ほかのカードや設計書を読む必要はない。「前提」に書いたものは、このカードの時点で必ずある。名前と形を変えないこと。

| 項目 | 内容 |
| --- | --- |
| フェーズ / 段階 | MVP / M2 結合 |
| 並行作業 | 直列 |
| 担当の目安 | 結合 |
| 作業場所 | apps/desktop/src/services.ts、apps/desktop/src/project/、apps/desktop/src/platform/ |

## 目的

モデリングの仮実装を本物に差し替え、取り込みから保存までを通しで動かす。

## 前提（このカードの時点ですでにあるもの）

次の本物の実装がある。

| 提供元 | 関数 |
| --- | --- |
| @app/core | createProjectStore、createEditorStore、createBindingEvaluator、createDeformPipeline、createParameterMixer、createMeshGenerator、createKeyGenerator、createAutoSetup |
| @app/render | createWebGLRenderer |
| @app/io | createImporter、createProjectIO(fs)、createAutoSaver(fs, io, store, getAssetPngs) |
| @app/contracts | createAssetRepository |
| apps/desktop/src/services/keyEditor | createKeyEditor |

抜粋に名前だけ出てくる型も、すべて `@app/schema` か `@app/contracts` から import できる。

### サービスのまとめ（@app/contracts）

```ts
export interface Services {
  store: ProjectStore; editor: EditorStore; assets: AssetRepository; fs: FileSystem;
  evaluator: BindingEvaluator; pipeline: DeformPipeline; mixer: ParameterMixer; createRenderer(): Renderer;
  meshGenerator: MeshGenerator; keyGenerator: KeyGenerator; autoSetup: AutoSetup; keyEditor: KeyEditor;
  importer: Importer; io: ProjectIO; autoSaver: AutoSaver;
  tracking: TrackingSource; trackingLayer: TrackingLayerProducer;
}
```

### アプリの枠の差し込み口（apps/desktop/src/shell/api.ts）

```ts
export interface PanelDef { id: string; mode: ModeId; area: 'left' | 'right' | 'bottom'; title: string; order?: number; level?: 'easy' | 'detail' | 'both'; component: React.FC }
export function registerPanel(def: PanelDef): void;
export interface SectionDef { id: string; panelId: string; order?: number; level?: 'easy' | 'detail' | 'both'; component: React.FC }
export function registerPanelSection(def: SectionDef): void;      // パネルの中の <PanelSections panelId=… /> に入る
export function PanelSections(props: { panelId: string }): JSX.Element;
export function registerCenter(mode: 'studio' | 'animation', component: React.FC): void;
export function registerSetupScreen(component: React.FC): void;   // 素材が1つも無いとき中央に出す
export function registerMenuItem(item: { id: string; label: string; shortcut?: string; run(): void }): void;

export interface CanvasPointerEvent { canvasPoint: Vec2; screenPoint: Vec2; button: number; shiftKey: boolean; altKey: boolean; ctrlKey: boolean }
export interface CanvasTool {
  id: string; label: string; cursor?: string;
  onPointerDown?(e: CanvasPointerEvent): void; onPointerMove?(e: CanvasPointerEvent): void; onPointerUp?(e: CanvasPointerEvent): void;
  onKeyDown?(e: KeyboardEvent): void;
  drawOverlay?(ctx: CanvasRenderingContext2D, view: ViewTransform): void;
}
export function registerCanvasTool(tool: CanvasTool): void;        // 最初に登録したものが既定のツール
export function registerCanvasOverlay(id: string, draw: (ctx: CanvasRenderingContext2D, view: ViewTransform) => void): void;
export function useCanvas(): { view: ViewTransform; activeToolId: string; setActiveTool(id: string): void; requestRedraw(): void; lastDeformed(): DeformedModel | null; screenToCanvas(p: Vec2): Vec2 };

export function useServices(): Services;
export function useProject(): Project;
export function useDispatch(): (c: Command) => void;
export function useEditor(): [EditorState, (patch: Partial<EditorState>) => void];
export function useEnvironment(): [Environment, (patch: Partial<Environment>) => void];
export function useDialogs(): { confirm(message: string): Promise<boolean>; notify(message: string): void; prompt(message: string, initial?: string): Promise<string | null> };
export function emitAppEvent(name: string, payload?: unknown): void;
export function onAppEvent(name: string, listener: (payload: unknown) => void): () => void;
```

### 取り込み・保存の契約（@app/contracts）

```ts
export interface FileSystem {          // パスは / 区切りの絶対パス
  readText(path: string): Promise<string>; writeText(path: string, data: string): Promise<void>;
  readBinary(path: string): Promise<Uint8Array>; writeBinary(path: string, data: Uint8Array): Promise<void>;
  exists(path: string): Promise<boolean>; mkdir(path: string): Promise<void>;
  list(dir: string): Promise<string[]>; remove(path: string): Promise<void>; rename(from: string, to: string): Promise<void>;
}
export interface ImportedAsset { asset: Asset; png: Uint8Array }   // png はトリミング済み
export interface ImportWarning { kind: 'canvasMismatch' | 'noTransparency' | 'resolution' | 'needsMerge'; assetIds: string[]; layerNames: string[]; message: string }
export interface Importer { importFiles(files: { name: string; data: Uint8Array }[]): Promise<{ assets: ImportedAsset[]; warnings: ImportWarning[] }> }
export interface ProjectIO {
  save(dir: string, project: Project, assetPngs: Record<string, Uint8Array>): Promise<void>;
  load(dir: string): Promise<{ project: Project; assetPngs: Record<string, Uint8Array> }>;
}
export interface AutoSaver { start(dir: string): void; stop(): void; findRecoverable(dir: string): Promise<string | null> }
```

### スキーマの関数（@app/schema）

```ts
export const SCHEMA_VERSION = 1;
export function validateProject(json: unknown): Project;       // 失敗時は項目のパス付きのエラー
export function migrate(json: unknown): unknown;               // 古い版を現在の版へ変換
export function loadProjectJson(text: string): Project;        // 解析 → migrate → validate
export function createEmptyProject(name: string): Project;     // MVPの標準パラメータ入り
export function ensureStandardParameters(model: Model, phase: 'mvp' | 'step1' | 'step2'): Model;
```

### Environment（@app/schema。PCごとの設定でプロジェクトの外に保存）

```ts
export interface Environment {
  cameraDeviceId: string | null;
  mirror: boolean;
  calibration: { neutral: { yaw: number; pitch: number; roll: number }; eyeClosed: { l: number; r: number }; mouthOpenMax: number } | null;
  microphoneDeviceId: string | null;
  silenceThreshold: number;        // dBFS
  trackingPreset: 'stable' | 'standard' | 'large' | 'custom';
  output: { method: 'window' | 'spout2'; width: number; height: number; fps: number };
  uiLevel: Record<ModeId, UiLevel>;
  lastProjectDir: string | null;
}
```

## 作るもの

- `platform/tauriFs.ts`: Tauri の fs プラグインで FileSystem を実装する。
- `services.ts`: トラッキング以外を本物に差し替える。
- プロジェクトの操作（registerMenuItem）:
  - 新規: 名前を入れる → createEmptyProject → store.load。保存先はまだ無いので、自動保存はアプリのデータフォルダの `unsaved/<project.id>/` に行う。
  - 開く: フォルダを選ぶ → io.load → store.load、素材を assets.put。Environment.lastProjectDir を更新する。
  - 保存（Ctrl+S）: 保存先が無ければフォルダを選ぶ。名前を付けて保存も用意する。
  - 読み込みと新規作成の後に、アプリイベント 'projectLoaded'（値はプロジェクト）を出す。
- 起動時: `unsaved/` と lastProjectDir について findRecoverable を調べ、あれば復元するか確認する。
- 自動保存を開始する。
- 通しのテスト（Playwright と Tauri の WebDriver）: fixtures の素材から PSD を作るスクリプトで用意した PSD を取り込む → スクリプトで標準パーツへ割り当てる → かんたんセットアップ → FaceAngleX を 30 にすると前髪が右へ、後ろ髪が左へ動く → 保存 → 開き直して同じになる → Undo で戻る。

## 作らないもの

スタジオの本物への差し替え（次のカード）。

## 完了条件

- [ ] 新規・開く・保存・名前を付けて保存ができる
- [ ] 異常終了の後に復元を提案する
- [ ] 通しのテストが通る


---

# 24. スタジオの結合

> このカードだけで実装できるように、必要な仕様・型・約束をすべて書いている。ほかのカードや設計書を読む必要はない。「前提」に書いたものは、このカードの時点で必ずある。名前と形を変えないこと。

| 項目 | 内容 |
| --- | --- |
| フェーズ / 段階 | MVP / M2 結合 |
| 並行作業 | 直列 |
| 担当の目安 | 結合 |
| 作業場所 | apps/desktop/src/services.ts、apps/desktop/src/modes/studio/ |

## 目的

トラッキングを本物にし、カメラでモデルを動かして OBS へ出せる状態にする。

## 前提（このカードの時点ですでにあるもの）

次の本物の実装がある: @app/tracking の createMediaPipeTrackingSource()・createTrackingLayerProducer(parameters, mappings?)。スタジオ画面・実行部・出力ウィンドウ（runtime.ts の registerLayerProducer・registerFrameSink）がある。

抜粋に名前だけ出てくる型も、すべて `@app/schema` か `@app/contracts` から import できる。

### サービスのまとめ（@app/contracts）

```ts
export interface Services {
  store: ProjectStore; editor: EditorStore; assets: AssetRepository; fs: FileSystem;
  evaluator: BindingEvaluator; pipeline: DeformPipeline; mixer: ParameterMixer; createRenderer(): Renderer;
  meshGenerator: MeshGenerator; keyGenerator: KeyGenerator; autoSetup: AutoSetup; keyEditor: KeyEditor;
  importer: Importer; io: ProjectIO; autoSaver: AutoSaver;
  tracking: TrackingSource; trackingLayer: TrackingLayerProducer;
}
```

### トラッキングの契約（@app/contracts）

```ts
export interface TrackingFrame {
  time: number;                    // ミリ秒（performance.now）
  detected: boolean;
  faceYaw: number;                 // 度。ユーザーが自分の右を向くと正
  facePitch: number;               // 度。上を向くと正
  faceRoll: number;                // 度。ユーザーが自分の右へ傾けると正
  eyeOpenL: number; eyeOpenR: number;   // 0..1。ユーザー自身の左目・右目
  eyeBallX: number;                // -1..1。ユーザーが自分の右を見ると正
  eyeBallY: number;                // -1..1。上を見ると正
  mouthOpen: number;               // 0..1
}
export interface TrackingSource {
  listDevices(): Promise<{ id: string; label: string }[]>;
  start(deviceId?: string): Promise<void>;
  stop(): void;
  onFrame(listener: (frame: TrackingFrame) => void): () => void;
}
export interface TrackingLayerProducer {
  update(frame: TrackingFrame): void;
  tick(now: number): Layer;        // id 'tracking'
  status(): 'tracking' | 'lost';
  setMirror(on: boolean): void;
  setLostBehavior(b: 'returnToFront' | 'hold'): void;
}
```

### スタジオの実行部の差し込み口（apps/desktop/src/modes/studio/runtime.ts）

```ts
export function registerLayerProducer(p: LayerProducer): () => void;   // LayerProducer・FrameContext は @app/contracts
export interface StudioFrame { model: DeformedModel; view: ViewTransform; background: Background; params: ParamValues; now: number }
export function registerFrameSink(sink: (frame: StudioFrame) => void): () => void;
export function useStudioRuntime(): { running: boolean; status: 'tracking' | 'lost' | 'stopped'; lastFrame(): StudioFrame | null };
```

1フレームの処理: LAYER_ORDER の順に producer を呼び、呼ぶたびに mixedSoFar を更新する → mixer.mix → evaluator → pipeline → プレビューの renderer と、登録された sink へ渡す。

### Environment（@app/schema。PCごとの設定でプロジェクトの外に保存）

```ts
export interface Environment {
  cameraDeviceId: string | null;
  mirror: boolean;
  calibration: { neutral: { yaw: number; pitch: number; roll: number }; eyeClosed: { l: number; r: number }; mouthOpenMax: number } | null;
  microphoneDeviceId: string | null;
  silenceThreshold: number;        // dBFS
  trackingPreset: 'stable' | 'standard' | 'large' | 'custom';
  output: { method: 'window' | 'spout2'; width: number; height: number; fps: number };
  uiLevel: Record<ModeId, UiLevel>;
  lastProjectDir: string | null;
}
```

## 作るもの

- `services.ts`: tracking と trackingLayer を本物に差し替える。プロジェクトの parameters・trackingMappings が変わったら作り直す。
- Environment の mirror を setMirror に渡す。
- 確認の手順を `docs/studio-check.md` に書き、実機で確かめる。
  - カメラでモデルが動く。ミラーのオン・オフで向きが入れ替わる。
  - カメラを手で覆うと、0.5秒後から1秒かけて正面へ戻り、外すと 0.3秒で戻る。
  - 出力ウィンドウを単色（緑）にし、OBS のウィンドウキャプチャとクロマキーで背景が抜ける。

## 作らないもの

計測（次のカード）。

## 完了条件

- [ ] 実機の確認の手順がすべて通る
- [ ] プレビューが基準PCで 60fps


---

# 25. 計測とMVPの受け入れ

> このカードだけで実装できるように、必要な仕様・型・約束をすべて書いている。ほかのカードや設計書を読む必要はない。「前提」に書いたものは、このカードの時点で必ずある。名前と形を変えないこと。

| 項目 | 内容 |
| --- | --- |
| フェーズ / 段階 | MVP / M2 結合 |
| 並行作業 | 直列 |
| 担当の目安 | 結合 |
| 作業場所 | apps/desktop/src/diagnostics/、fixtures/、docs/ |

## 目的

非機能要件を決めた条件で測り、MVPの完成条件をすべて確かめる。

## 前提（このカードの時点ですでにあるもの）

MVPの機能がすべて本物でつながっている。

抜粋に名前だけ出てくる型も、すべて `@app/schema` か `@app/contracts` から import できる。

### スタジオの実行部の差し込み口（apps/desktop/src/modes/studio/runtime.ts）

```ts
export function registerLayerProducer(p: LayerProducer): () => void;   // LayerProducer・FrameContext は @app/contracts
export interface StudioFrame { model: DeformedModel; view: ViewTransform; background: Background; params: ParamValues; now: number }
export function registerFrameSink(sink: (frame: StudioFrame) => void): () => void;
export function useStudioRuntime(): { running: boolean; status: 'tracking' | 'lost' | 'stopped'; lastFrame(): StudioFrame | null };
```

1フレームの処理: LAYER_ORDER の順に producer を呼び、呼ぶたびに mixedSoFar を更新する → mixer.mix → evaluator → pipeline → プレビューの renderer と、登録された sink へ渡す。

### トラッキングの契約（@app/contracts）

```ts
export interface TrackingFrame {
  time: number;                    // ミリ秒（performance.now）
  detected: boolean;
  faceYaw: number;                 // 度。ユーザーが自分の右を向くと正
  facePitch: number;               // 度。上を向くと正
  faceRoll: number;                // 度。ユーザーが自分の右へ傾けると正
  eyeOpenL: number; eyeOpenR: number;   // 0..1。ユーザー自身の左目・右目
  eyeBallX: number;                // -1..1。ユーザーが自分の右を見ると正
  eyeBallY: number;                // -1..1。上を見ると正
  mouthOpen: number;               // 0..1
}
export interface TrackingSource {
  listDevices(): Promise<{ id: string; label: string }[]>;
  start(deviceId?: string): Promise<void>;
  stop(): void;
  onFrame(listener: (frame: TrackingFrame) => void): () => void;
}
export interface TrackingLayerProducer {
  update(frame: TrackingFrame): void;
  tick(now: number): Layer;        // id 'tracking'
  status(): 'tracking' | 'lost';
  setMirror(on: boolean): void;
  setLostBehavior(b: 'returnToFront' | 'hold'): void;
}
```

## 作るもの

- 計測の表示（Ctrl+Shift+D で開閉）: 描画の fps（平均と1%最低値）、トラッキングの fps、遅延（TrackingFrame.time から、その値を使ったフレームを描いた時刻まで。95パーセンタイル）。5分間の記録を JSON に書き出せる。
- 基準モデル: `fixtures/reference-model/` を作るスクリプト（約50レイヤー、キャンバス 2000×3000px、かんたんセットアップ済み）。
- ストレステスト用の素材: 4000×6000px・100レイヤーの PSD を作るスクリプト。
- 下の評価条件で測り、結果を `docs/acceptance-mvp.md` に残す。ストレステスト（大きな PSD の取り込み時間とメモリ、2時間の連続動作でのメモリとフレームレート、内蔵GPUのPCでのフレームレート）は合否に含めず、結果だけを残す。

| 条件 | 内容 |
| --- | --- |
| 基準PC | Windows 11（64bit）、CPU 6コア12スレッド級、GPU GeForce RTX 3060級、メモリ 16GB |
| 同時実行 | OBS で 1920×1080・60fps の配信または録画を同時に行う |
| 基準モデル | fixtures/reference-model |
| カメラ | 1280×720・30fps の Webカメラ。明るい室内で逆光なし、顔が画面の高さの3分の1以上に写る距離 |
| 目標 | 描画 60fps（平均）、トラッキング 30fps 以上、遅延 100ms 以下（95パーセンタイル、スムージングは標準） |

MVPの完成条件（すべて確かめる）:

1. PNG・PSD の素材を複数読み込める（位置を保持。クリッピング・合成モード・特殊レイヤーは検出して警告する）
2. 素材を標準パーツへ手動で割り当てられる
3. かんたんセットアップで、階層・ピボット・描画順・マスクと、瞳・顔の傾き・顔の向き（奥行き）・目と口の開閉（簡易）のたたき台を自動で作れる
4. キャンバスで配置とピボットを調整できる
5. パーツを階層化できる（変形グループを含む）
6. 描画順を、階層とは独立して変更できる
7. メッシュを自動生成・手動編集でき、変形できる（キー作成後の作り直しは頂点のキーをリセット）
8. 1パーツにつき1つのマスク元で、マスクを設定できる
9. 標準パラメータ（MVP分）を使える
10. 代表状態から中間キーを生成できる（線形・奥行き）
11. バインディング・差分キー・ワープのデータ構造、合成レイヤーの骨格、コマンド方式、schemaVersion が、STEP1以降の機能を作り直しなしで載せられる形で実装されている（設計レビューで確認）
12. カメラ入力でモデルを動かせ、顔が外れたら正面へ戻る
13. スタジオで背景（透明・単色・画像）を変更できる
14. 単色背景とウィンドウキャプチャで、OBS へ出力できる
15. Undo / Redo ができる
16. 保存・再読込・自動保存ができる（schemaVersion 付き）
17. 評価条件のもとで、基準モデルが非機能要件の目標を満たす

## 作らないもの

目標を満たさなかった項目の改善（別のカードを起こす）。

## 完了条件

- [ ] 17項目すべての確認結果が docs/acceptance-mvp.md にある
- [ ] 計測の記録（JSON）とストレステストの結果が残っている


---

# 26. STEP1の契約の拡張

> このカードだけで実装できるように、必要な仕様・型・約束をすべて書いている。ほかのカードや設計書を読む必要はない。「前提」に書いたものは、このカードの時点で必ずある。名前と形を変えないこと。

| 項目 | 内容 |
| --- | --- |
| フェーズ / 段階 | STEP1 / S0 契約の拡張 |
| 並行作業 | 直列 |
| 担当の目安 | 基盤 |
| 作業場所 | packages/contracts/src/、apps/desktop/src/shell/、apps/desktop/src/services.ts |

## 目的

STEP1の部品が互いを待たずに作れるよう、増えるインターフェースと仮実装、画面の部品を先に用意する。

## 前提（このカードの時点ですでにあるもの）

MVPが完成している。`@app/contracts` に MVP のインターフェースがある（LayerProducer・FrameContext・Layer など）。

抜粋に名前だけ出てくる型も、すべて `@app/schema` か `@app/contracts` から import できる。

### リポジトリの約束

- pnpm ワークスペースのモノレポ。TypeScript は strict、テストは Vitest。
- パッケージ: `@app/schema`（packages/schema。データ型・検証・既定値・規則）、`@app/contracts`（packages/contracts。実行時のインターフェースと仮実装）、`@app/core`（packages/core。評価・変形・生成・合成・ストア。DOMに依存しない）、`@app/render`（packages/render。WebGL2）、`@app/io`（packages/io。取り込み・保存）、`@app/tracking`（packages/tracking）、`@app/audio`（packages/audio）、`apps/desktop`（Tauri 2 + React）。
- パッケージから参照してよいのは `@app/schema` と `@app/contracts` だけ（同じパッケージの中は自由）。すべてを組み合わせるのは apps/desktop だけ。
- データは不変に扱い、更新は新しいオブジェクトを返す。
- ロジックには必ずユニットテストを付ける。

### 合成の契約（@app/contracts）

```ts
export type LayerId = 'tracking' | 'bodyFollow' | 'expression' | 'animation' | 'lipSync' | 'periodic' | 'physics';
export const LAYER_ORDER: LayerId[] = ['tracking', 'bodyFollow', 'expression', 'animation', 'lipSync', 'periodic', 'physics'];
export interface Layer {
  id: LayerId;
  weight: number;                     // 0..1
  values: ParamValues;                // このレイヤーが担当するパラメータの値だけ
  blend?: Record<string, BlendOp>;    // パラメータごとの合成方法。無ければ override
}
export interface ParameterMixer { mix(parameters: Parameter[], layers: Layer[]): ParamValues }

// スタジオの1フレームの文脈。producer は LAYER_ORDER の順に呼ばれる
export interface FrameContext {
  now: number; dt: number;            // ミリ秒
  project: Project;
  mixedSoFar: ParamValues;            // それまでのレイヤーを合成した値
  flags: { lipSyncWeight: number; physicsActive: boolean };   // 前のレイヤーが後のレイヤーへ伝える値（初期値 1・true）
}
export interface LayerProducer { id: LayerId; produce(ctx: FrameContext): Layer | null }
```

### トラッキングの契約（@app/contracts）

```ts
export interface TrackingFrame {
  time: number;                    // ミリ秒（performance.now）
  detected: boolean;
  faceYaw: number;                 // 度。ユーザーが自分の右を向くと正
  facePitch: number;               // 度。上を向くと正
  faceRoll: number;                // 度。ユーザーが自分の右へ傾けると正
  eyeOpenL: number; eyeOpenR: number;   // 0..1。ユーザー自身の左目・右目
  eyeBallX: number;                // -1..1。ユーザーが自分の右を見ると正
  eyeBallY: number;                // -1..1。上を見ると正
  mouthOpen: number;               // 0..1
}
export interface TrackingSource {
  listDevices(): Promise<{ id: string; label: string }[]>;
  start(deviceId?: string): Promise<void>;
  stop(): void;
  onFrame(listener: (frame: TrackingFrame) => void): () => void;
}
export interface TrackingLayerProducer {
  update(frame: TrackingFrame): void;
  tick(now: number): Layer;        // id 'tracking'
  status(): 'tracking' | 'lost';
  setMirror(on: boolean): void;
  setLostBehavior(b: 'returnToFront' | 'hold'): void;
}
```

### 生成・セットアップの契約（@app/contracts）

```ts
export interface KeyGenerator {
  linear(binding: Binding, divisions?: number): Binding;
  depthParallax(model: Model, parameterId: 'FaceAngleX' | 'FaceAngleY'): Binding[];   // 作り直した transform バインディング
}
export interface AutoSetup { plan(project: Project): { command: Command; warnings: string[] } }
```

### サービスのまとめ（@app/contracts）

```ts
export interface Services {
  store: ProjectStore; editor: EditorStore; assets: AssetRepository; fs: FileSystem;
  evaluator: BindingEvaluator; pipeline: DeformPipeline; mixer: ParameterMixer; createRenderer(): Renderer;
  meshGenerator: MeshGenerator; keyGenerator: KeyGenerator; autoSetup: AutoSetup; keyEditor: KeyEditor;
  importer: Importer; io: ProjectIO; autoSaver: AutoSaver;
  tracking: TrackingSource; trackingLayer: TrackingLayerProducer;
}
```

### Environment（@app/schema。PCごとの設定でプロジェクトの外に保存）

```ts
export interface Environment {
  cameraDeviceId: string | null;
  mirror: boolean;
  calibration: { neutral: { yaw: number; pitch: number; roll: number }; eyeClosed: { l: number; r: number }; mouthOpenMax: number } | null;
  microphoneDeviceId: string | null;
  silenceThreshold: number;        // dBFS
  trackingPreset: 'stable' | 'standard' | 'large' | 'custom';
  output: { method: 'window' | 'spout2'; width: number; height: number; fps: number };
  uiLevel: Record<ModeId, UiLevel>;
  lastProjectDir: string | null;
}
```

### Scene と Hotkey（@app/schema）

```ts
export interface Scene {
  id: Id; name: string;
  background: { type: 'transparent' } | { type: 'color'; color: string } | { type: 'image'; path: string };   // path はプロジェクトからの相対パス
  modelTransform: { position: Vec2; scale: number };   // 出力画面での位置（px）と倍率
  expressionIds: Id[];             // シーンに切り替えたときに適用する表情
  periodicAnimationIds: Id[];      // STEP2で使う
}
export interface Hotkey {
  id: Id;
  keys: string;                    // 例: 'Ctrl+Shift+1'
  action: 'expression' | 'scene' | 'background' | 'animation' | 'parameter' | 'pauseTracking' | 'recalibrate';
  targetId: Id | null;
  mode: 'toggle' | 'hold';
}
```

## 作るもの

- 下の「STEP1で増える契約」を `@app/contracts` に足す。既存のインターフェースは、書いてあるメソッドの追加だけにとどめ、名前と形を変えない。
- 仮実装を足す: FakeAudioSource（一定間隔で話している音量を出す）、FakeLipSync（音量をそのまま MouthOpen に）、FakeAutoBlink（4秒ごとにまばたき）、FakeBodyFollow（何も出さない）、FakeExpressions（適用した表情の値をそのまま出す）、FakeCalibration、FakeHotkeys（登録だけ）、FakeSpout（何もしない）。KeyGenerator と TrackingLayerProducer の仮実装に、足したメソッドを空の動作で加える。
- Services に audio・lipSync・autoBlink・bodyFollow・expressions・calibration・hotkeys・spout を足し、`services.ts` で仮実装を入れる。
- 画面の部品: 下の presetOf と DetailDisclosure を `apps/desktop/src/shell/` に足す。

### STEP1で増える契約（@app/contracts）

```ts
// TrackingFrame に足す任意の項目（無いときは undefined）
//   mouthForm?: number;  // -1..1（への字〜笑顔）
//   mouthWidth?: number; // -1..1（すぼめ〜横に開く）
//   browY?: number;      // -1..1（下げる〜上げる）

export interface AudioLevel { time: number; rmsDb: number }
export interface AudioSource {
  listDevices(): Promise<{ id: string; label: string }[]>;
  start(deviceId?: string): Promise<void>; stop(): void;
  onLevel(listener: (x: AudioLevel) => void): () => void;                                   // 10ms ごと
  onSamples(listener: (samples: Float32Array, sampleRate: number, time: number) => void): () => void;
}
export interface LipSyncProducer extends LayerProducer {   // id 'lipSync'
  configure(o: { mouthSource: 'max' | 'micOnly' | 'cameraOnly'; strength: 'low' | 'standard' | 'high'; silenceThresholdDb: number }): void;
  update(level: AudioLevel): void;
}
export interface AutoBlink { tick(now: number): { EyeOpenL: number; EyeOpenR: number } }
export interface BodyFollowProducer extends LayerProducer { setStrength(s: 'low' | 'standard' | 'high'): void }   // id 'bodyFollow'
export interface ExpressionController extends LayerProducer {   // id 'expression'
  apply(expressionId: string | null, now: number): void;        // null で解除。STEP1では1つだけ
  active(): string | null;
}
export type CalibrationStep = 'neutral' | 'eyesClosed' | 'mouthOpen';
export interface CalibrationService { capture(step: CalibrationStep, frames: TrackingFrame[]): void; result(): Environment['calibration']; reset(): void }
// TrackingLayerProducer に足すメソッド
//   setCalibration(c: Environment['calibration']): void
//   setPreset(p: 'stable' | 'standard' | 'large' | 'custom', custom?: { minCutoff: number; beta: number; gain: number; deadZone: number }): void
//   setEyeTracking(on: boolean): void   // off のときと外れたときは AutoBlink の値を使う
export interface HotkeyService { register(hotkey: Hotkey, handler: (phase: 'down' | 'up') => void): Promise<'ok' | 'conflict'>; unregisterAll(): Promise<void> }
export interface OutputSink {
  start(o: { width: number; height: number; fps: number }): Promise<void>;
  setTextures(pngs: Record<string, Uint8Array>): Promise<void>;
  submit(model: DeformedModel, view: ViewTransform, background: Background): void;
  stop(): Promise<void>;
}
// KeyGenerator に足すメソッド
//   rotate(binding: Binding, model: Model): Binding                    // 頂点・制御点をピボット中心の円弧で補間
//   surface(binding: Binding, model: Model): Binding                   // ワープの制御点を球面に沿って生成
//   ease(binding: Binding): Binding                                     // 中間キーの値をゆるやかに
//   regenerate(binding: Binding, model: Model, range?: [number, number]): Binding   // ロックされたキーを残して作り直す
// Services に足すもの: audio, lipSync, autoBlink, bodyFollow, expressions, calibration, hotkeys, spout（OutputSink）
```

### STEP1で増える画面の部品（apps/desktop/src/shell）

```ts
// かんたん/詳細のプリセットに一致するかを調べる。一致しなければ 'custom'
export function presetOf<T extends Record<string, number>>(values: T, presets: Record<string, T>, tolerance?: number): string | 'custom';
// かんたんモードで、その項目だけ詳細を一時的に開く
export function DetailDisclosure(props: { label?: string; children: React.ReactNode }): JSX.Element;
```

## 作らないもの

各部品の本物（S1・S2のカード）。

## 完了条件

- [ ] 型検査が通り、MVP のテストがすべて通ったまま
- [ ] 仮実装でアプリが起動する
- [ ] presetOf のテスト（一致・不一致・許容差）


---

# 27. かんたん/詳細の切り替え

> このカードだけで実装できるように、必要な仕様・型・約束をすべて書いている。ほかのカードや設計書を読む必要はない。「前提」に書いたものは、このカードの時点で必ずある。名前と形を変えないこと。

| 項目 | 内容 |
| --- | --- |
| フェーズ / 段階 | STEP1 / S1 部品 |
| 並行作業 | 同じ段階の 27〜41 と並行して作れる（触るフォルダは重ならない） |
| 担当の目安 | 画面 |
| 作業場所 | apps/desktop/src/shell/level/、apps/desktop/src/shell/Header.tsx |

## 目的

かんたん/詳細の切り替えを使えるようにし、状態をモードごとに保持する。

## 前提（このカードの時点ですでにあるもの）

ヘッダーに非表示の切り替えボタンがあり、EditorState.uiLevel にモードごとの状態がある。パネルとセクションは level で出し分けられる。

抜粋に名前だけ出てくる型も、すべて `@app/schema` か `@app/contracts` から import できる。

### ストアの契約（@app/contracts）

```ts
export interface Command { label: string; apply(project: Project): Project }   // 純粋関数
export interface ProjectStore {
  get(): Project;
  subscribe(listener: (project: Project) => void): () => void;
  dispatch(command: Command): void;                                          // 1回の Undo 単位
  transaction(label: string, run: (dispatch: (c: Command) => void) => void): void;   // まとめて1回の Undo
  undo(): void; redo(): void; canUndo(): boolean; canRedo(): boolean;
  load(project: Project): void;                                              // 履歴を消して置き換える
}
export interface EditorState {
  mode: ModeId;
  uiLevel: Record<ModeId, UiLevel>;
  selectedPartIds: string[];
  activeParameterIds: string[];        // 編集中のパラメータ（0〜2個）
  editorParamValues: ParamValues;      // モデリング中のプレビュー値（無いパラメータはデフォルト値）
}
export interface EditorStore { get(): EditorState; set(patch: Partial<EditorState>): void; subscribe(l: (s: EditorState) => void): () => void }
```

### アプリの枠の差し込み口（apps/desktop/src/shell/api.ts）

```ts
export interface PanelDef { id: string; mode: ModeId; area: 'left' | 'right' | 'bottom'; title: string; order?: number; level?: 'easy' | 'detail' | 'both'; component: React.FC }
export function registerPanel(def: PanelDef): void;
export interface SectionDef { id: string; panelId: string; order?: number; level?: 'easy' | 'detail' | 'both'; component: React.FC }
export function registerPanelSection(def: SectionDef): void;      // パネルの中の <PanelSections panelId=… /> に入る
export function PanelSections(props: { panelId: string }): JSX.Element;
export function registerCenter(mode: 'studio' | 'animation', component: React.FC): void;
export function registerSetupScreen(component: React.FC): void;   // 素材が1つも無いとき中央に出す
export function registerMenuItem(item: { id: string; label: string; shortcut?: string; run(): void }): void;

export interface CanvasPointerEvent { canvasPoint: Vec2; screenPoint: Vec2; button: number; shiftKey: boolean; altKey: boolean; ctrlKey: boolean }
export interface CanvasTool {
  id: string; label: string; cursor?: string;
  onPointerDown?(e: CanvasPointerEvent): void; onPointerMove?(e: CanvasPointerEvent): void; onPointerUp?(e: CanvasPointerEvent): void;
  onKeyDown?(e: KeyboardEvent): void;
  drawOverlay?(ctx: CanvasRenderingContext2D, view: ViewTransform): void;
}
export function registerCanvasTool(tool: CanvasTool): void;        // 最初に登録したものが既定のツール
export function registerCanvasOverlay(id: string, draw: (ctx: CanvasRenderingContext2D, view: ViewTransform) => void): void;
export function useCanvas(): { view: ViewTransform; activeToolId: string; setActiveTool(id: string): void; requestRedraw(): void; lastDeformed(): DeformedModel | null; screenToCanvas(p: Vec2): Vec2 };

export function useServices(): Services;
export function useProject(): Project;
export function useDispatch(): (c: Command) => void;
export function useEditor(): [EditorState, (patch: Partial<EditorState>) => void];
export function useEnvironment(): [Environment, (patch: Partial<Environment>) => void];
export function useDialogs(): { confirm(message: string): Promise<boolean>; notify(message: string): void; prompt(message: string, initial?: string): Promise<string | null> };
export function emitAppEvent(name: string, payload?: unknown): void;
export function onAppEvent(name: string, listener: (payload: unknown) => void): () => void;
```

### STEP1で増える画面の部品（apps/desktop/src/shell）

```ts
// かんたん/詳細のプリセットに一致するかを調べる。一致しなければ 'custom'
export function presetOf<T extends Record<string, number>>(values: T, presets: Record<string, T>, tolerance?: number): string | 'custom';
// かんたんモードで、その項目だけ詳細を一時的に開く
export function DetailDisclosure(props: { label?: string; children: React.ReactNode }): JSX.Element;
```

### Environment（@app/schema。PCごとの設定でプロジェクトの外に保存）

```ts
export interface Environment {
  cameraDeviceId: string | null;
  mirror: boolean;
  calibration: { neutral: { yaw: number; pitch: number; roll: number }; eyeClosed: { l: number; r: number }; mouthOpenMax: number } | null;
  microphoneDeviceId: string | null;
  silenceThreshold: number;        // dBFS
  trackingPreset: 'stable' | 'standard' | 'large' | 'custom';
  output: { method: 'window' | 'spout2'; width: number; height: number; fps: number };
  uiLevel: Record<ModeId, UiLevel>;
  lastProjectDir: string | null;
}
```

## 作るもの

- 切り替えボタンを表示する。押すと、今のモードの uiLevel だけを変える。
- uiLevel を Environment.uiLevel に保存し、起動時に戻す。初期値はすべて 'easy'。
- 詳細からかんたんへ戻しても、詳細でだけ変えられる値は消さない（表示を隠すだけ）。
- かんたんのプリセットを選び直すときは、presetOf が 'custom' なら「個別に調整した値を上書きします」と確認する（各機能が使う確認の関数 `confirmOverwriteCustom()` をここに置く）。

## 作らないもの

各機能の詳細の画面（それぞれのカード）。

## 完了条件

- [ ] モデリングを詳細、スタジオをかんたんにしたまま、行き来しても保たれる
- [ ] 再起動しても状態が戻る
- [ ] confirmOverwriteCustom の確認が出る


---

# 28. メッシュの密度と変形の転写

> このカードだけで実装できるように、必要な仕様・型・約束をすべて書いている。ほかのカードや設計書を読む必要はない。「前提」に書いたものは、このカードの時点で必ずある。名前と形を変えないこと。

| 項目 | 内容 |
| --- | --- |
| フェーズ / 段階 | STEP1 / S1 部品 |
| 並行作業 | 同じ段階の 27〜41 と並行して作れる（触るフォルダは重ならない） |
| 担当の目安 | コア |
| 作業場所 | packages/core/src/mesh/transfer.ts、apps/desktop/src/modes/modeling/mesh/、apps/desktop/src/modes/modeling/structure/replaceAsset.ts |

## 目的

メッシュを作り直しても、既存の変形を新しいメッシュへ移せるようにする（MVPのリセットを置き換える）。

## 前提（このカードの時点ですでにあるもの）

MVPのメッシュ編集ツール（形が変わる操作で頂点のキーをリセットする）と、素材の差し替え（replaceAsset.ts）がある。

抜粋に名前だけ出てくる型も、すべて `@app/schema` か `@app/contracts` から import できる。

### Mesh（@app/schema）

```ts
export interface Mesh {
  id: Id;
  vertices: Vec2[];                // 基準状態の頂点（キャンバス座標）
  uvs: Vec2[];                     // 0..1（素材画像の中の位置）
  triangles: [number, number, number][];
  density: 'light' | 'standard' | 'smooth' | 'custom';
  edited: boolean;                 // 手で編集したか
}
```

### Binding と ParameterKey（@app/schema）

```ts
export type Channel = 'transform' | 'vertices' | 'warpPoints';
export interface TransformDelta { position: Vec2; rotation: number; scale: Vec2; opacity: number }
// position・rotation は加算、scale・opacity は倍率（1 = 変化なし）
export interface Binding {
  id: Id;
  target: { type: 'part' | 'mesh' | 'warp'; id: Id };   // transform → part、vertices → mesh、warpPoints → warp
  channel: Channel;
  parameterIds: Id[];              // 1 または 2
  keyValues: number[][];           // パラメータごとのキー位置（昇順。デフォルト値を必ず含む）
  keys: ParameterKey[];
  generation: 'linear' | 'depth' | 'rotate' | 'surface' | 'ease';
  divisions: number | null;        // 中間キーの分割数（自動なら null）
}
export interface ParameterKey {
  coords: number[];                // parameterIds と同じ順の値
  delta: TransformDelta | Vec2[];  // transform は TransformDelta、それ以外は頂点・制御点ごとの差分
  source: 'manual' | 'auto' | 'generated' | 'combined';
  locked: boolean;
}
```

### メッシュ生成の契約（@app/contracts）

```ts
export interface MeshGenerator {
  generate(alpha: ImageData, offset: Vec2, density: 'light' | 'standard' | 'smooth'):
    { vertices: Vec2[]; uvs: Vec2[]; triangles: [number, number, number][] };   // 頂点はキャンバス座標
}
```

### アプリの枠の差し込み口（apps/desktop/src/shell/api.ts）

```ts
export interface PanelDef { id: string; mode: ModeId; area: 'left' | 'right' | 'bottom'; title: string; order?: number; level?: 'easy' | 'detail' | 'both'; component: React.FC }
export function registerPanel(def: PanelDef): void;
export interface SectionDef { id: string; panelId: string; order?: number; level?: 'easy' | 'detail' | 'both'; component: React.FC }
export function registerPanelSection(def: SectionDef): void;      // パネルの中の <PanelSections panelId=… /> に入る
export function PanelSections(props: { panelId: string }): JSX.Element;
export function registerCenter(mode: 'studio' | 'animation', component: React.FC): void;
export function registerSetupScreen(component: React.FC): void;   // 素材が1つも無いとき中央に出す
export function registerMenuItem(item: { id: string; label: string; shortcut?: string; run(): void }): void;

export interface CanvasPointerEvent { canvasPoint: Vec2; screenPoint: Vec2; button: number; shiftKey: boolean; altKey: boolean; ctrlKey: boolean }
export interface CanvasTool {
  id: string; label: string; cursor?: string;
  onPointerDown?(e: CanvasPointerEvent): void; onPointerMove?(e: CanvasPointerEvent): void; onPointerUp?(e: CanvasPointerEvent): void;
  onKeyDown?(e: KeyboardEvent): void;
  drawOverlay?(ctx: CanvasRenderingContext2D, view: ViewTransform): void;
}
export function registerCanvasTool(tool: CanvasTool): void;        // 最初に登録したものが既定のツール
export function registerCanvasOverlay(id: string, draw: (ctx: CanvasRenderingContext2D, view: ViewTransform) => void): void;
export function useCanvas(): { view: ViewTransform; activeToolId: string; setActiveTool(id: string): void; requestRedraw(): void; lastDeformed(): DeformedModel | null; screenToCanvas(p: Vec2): Vec2 };

export function useServices(): Services;
export function useProject(): Project;
export function useDispatch(): (c: Command) => void;
export function useEditor(): [EditorState, (patch: Partial<EditorState>) => void];
export function useEnvironment(): [Environment, (patch: Partial<Environment>) => void];
export function useDialogs(): { confirm(message: string): Promise<boolean>; notify(message: string): void; prompt(message: string, initial?: string): Promise<string | null> };
export function emitAppEvent(name: string, payload?: unknown): void;
export function onAppEvent(name: string, listener: (payload: unknown) => void): () => void;
```

### ストアの契約（@app/contracts）

```ts
export interface Command { label: string; apply(project: Project): Project }   // 純粋関数
export interface ProjectStore {
  get(): Project;
  subscribe(listener: (project: Project) => void): () => void;
  dispatch(command: Command): void;                                          // 1回の Undo 単位
  transaction(label: string, run: (dispatch: (c: Command) => void) => void): void;   // まとめて1回の Undo
  undo(): void; redo(): void; canUndo(): boolean; canRedo(): boolean;
  load(project: Project): void;                                              // 履歴を消して置き換える
}
export interface EditorState {
  mode: ModeId;
  uiLevel: Record<ModeId, UiLevel>;
  selectedPartIds: string[];
  activeParameterIds: string[];        // 編集中のパラメータ（0〜2個）
  editorParamValues: ParamValues;      // モデリング中のプレビュー値（無いパラメータはデフォルト値）
}
export interface EditorStore { get(): EditorState; set(patch: Partial<EditorState>): void; subscribe(l: (s: EditorState) => void): () => void }
```

## 作るもの

- `transferPointDeltas(oldVertices: Vec2[], oldTriangles: [number, number, number][], newVertices: Vec2[], deltas: Vec2[]): Vec2[]`: 新しい頂点ごとに、旧メッシュ（基準状態）で含まれる三角形を探し、重心座標で旧い差分を補間する。どの三角形にも入らない点は、いちばん近い三角形の重心座標（0..1 に丸める）を使う。
- `transferMeshKeys(model, meshId, newMesh): Model`: そのメッシュを対象にする vertices バインディングの全キーを転写する。
- 変形の細かさ（「パーツの設定」パネルのセクション、画像パーツのとき）: 軽い / 標準 / なめらか。選ぶとメッシュを作り直して転写する（density を更新）。
- メッシュ編集ツールの頂点の追加・削除・自動生成を、リセットから転写に替える。確認の文は「変形を新しいメッシュへ移します」。
- 素材の差し替えでサイズが違うときも、リセットから転写に替える。
- どれも1つの transaction で、Undo できる。

## 作らないもの

PSD の再読み込み（別のカード）。

## 完了条件

- [ ] 同じメッシュへの転写で差分が変わらない
- [ ] 一様な平行移動の差分が、より細かいメッシュへ正しく移る
- [ ] 外側の点の扱い
- [ ] 密度の変更・頂点の追加と削除・差し替えで、見た目がほぼ変わらない


---

# 29. ワープ

> このカードだけで実装できるように、必要な仕様・型・約束をすべて書いている。ほかのカードや設計書を読む必要はない。「前提」に書いたものは、このカードの時点で必ずある。名前と形を変えないこと。

| 項目 | 内容 |
| --- | --- |
| フェーズ / 段階 | STEP1 / S1 部品 |
| 並行作業 | 同じ段階の 27〜41 と並行して作れる（触るフォルダは重ならない） |
| 担当の目安 | コア |
| 作業場所 | packages/core/src/deform/warp.ts、packages/core/src/deform/space.ts、apps/desktop/src/modes/modeling/warp/ |

## 目的

グループに格子のワープを付け、子パーツをまとめて曲げられるようにする。

## 前提（このカードの時点ですでにあるもの）

変形パイプラインが `warp.ts` の `applyWarp(points, warp, delta)` を親グループごとに呼んでいる（今は何もしない）。KeyEditor は pointsEdit（{kind: 'warp'}）でワープの制御点を基準状態かキーに記録できる。

抜粋に名前だけ出てくる型も、すべて `@app/schema` か `@app/contracts` から import できる。

### パーツの変形と計算の順序

- パーツの変形は、点 p を `p' = position + pivot + R(rotation)·(scale ⊙ (p − pivot))` に動かす。R は y が下向きの座標で `[cos −sin; sin cos]`（正の角度で時計回り）。
- 実際に使う値: `position = Part.position + Δposition`、`rotation = Part.rotation + Δrotation`、`scale = Part.scale ⊙ Δscale`、`opacity = Part.opacity × Δopacity`（Δ はキーの合成結果）。
- 取り込み直後は position (0,0)・rotation 0・scale (1,1)。メッシュの頂点と pivot はキャンバス座標。
- 画像パーツの最終頂点は内側から外側へ求める。(1) メッシュの基準頂点 + 頂点の差分 → (2) 自身のパーツの変形 → (3) 親グループのワープ（あれば）→ (4) 親グループのパーツの変形 → ルートまで (3)(4) を繰り返す。
- 不透明度は、自身から親までの値をすべて掛け合わせる。

### Warp（@app/schema）

```ts
export interface Warp {
  id: Id;
  partId: Id;                      // ワープを付ける group パーツ
  columns: number; rows: number;   // 格子の分割数
  bounds: { x: number; y: number; width: number; height: number };   // キャンバス座標
  points: Vec2[];                  // (columns+1)×(rows+1) 個、行優先。基準状態の制御点
}
```

### Binding と ParameterKey（@app/schema）

```ts
export type Channel = 'transform' | 'vertices' | 'warpPoints';
export interface TransformDelta { position: Vec2; rotation: number; scale: Vec2; opacity: number }
// position・rotation は加算、scale・opacity は倍率（1 = 変化なし）
export interface Binding {
  id: Id;
  target: { type: 'part' | 'mesh' | 'warp'; id: Id };   // transform → part、vertices → mesh、warpPoints → warp
  channel: Channel;
  parameterIds: Id[];              // 1 または 2
  keyValues: number[][];           // パラメータごとのキー位置（昇順。デフォルト値を必ず含む）
  keys: ParameterKey[];
  generation: 'linear' | 'depth' | 'rotate' | 'surface' | 'ease';
  divisions: number | null;        // 中間キーの分割数（自動なら null）
}
export interface ParameterKey {
  coords: number[];                // parameterIds と同じ順の値
  delta: TransformDelta | Vec2[];  // transform は TransformDelta、それ以外は頂点・制御点ごとの差分
  source: 'manual' | 'auto' | 'generated' | 'combined';
  locked: boolean;
}
```

### キー編集の契約（@app/contracts）

```ts
export type TransformChange = { dPosition?: Vec2; dRotation?: number; scaleFactor?: Vec2; opacityFactor?: number; dPivot?: Vec2 };
export type PointsTarget = { kind: 'mesh'; meshId: string } | { kind: 'warp'; warpId: string };
export interface KeyEditor {
  // EditorState の activeParameterIds と editorParamValues に応じて、基準状態かキーを変えるコマンドを返す
  transformEdit(project: Project, editor: EditorState, partIds: string[], change: TransformChange): Command | 'needsKey';
  pointsEdit(project: Project, editor: EditorState, target: PointsTarget, moves: { index: number; d: Vec2 }[]): Command | 'needsKey';
  addKeyAtCurrentValue(project: Project, editor: EditorState, target: { partId: string } | PointsTarget): Command;
}
```

### アプリの枠の差し込み口（apps/desktop/src/shell/api.ts）

```ts
export interface PanelDef { id: string; mode: ModeId; area: 'left' | 'right' | 'bottom'; title: string; order?: number; level?: 'easy' | 'detail' | 'both'; component: React.FC }
export function registerPanel(def: PanelDef): void;
export interface SectionDef { id: string; panelId: string; order?: number; level?: 'easy' | 'detail' | 'both'; component: React.FC }
export function registerPanelSection(def: SectionDef): void;      // パネルの中の <PanelSections panelId=… /> に入る
export function PanelSections(props: { panelId: string }): JSX.Element;
export function registerCenter(mode: 'studio' | 'animation', component: React.FC): void;
export function registerSetupScreen(component: React.FC): void;   // 素材が1つも無いとき中央に出す
export function registerMenuItem(item: { id: string; label: string; shortcut?: string; run(): void }): void;

export interface CanvasPointerEvent { canvasPoint: Vec2; screenPoint: Vec2; button: number; shiftKey: boolean; altKey: boolean; ctrlKey: boolean }
export interface CanvasTool {
  id: string; label: string; cursor?: string;
  onPointerDown?(e: CanvasPointerEvent): void; onPointerMove?(e: CanvasPointerEvent): void; onPointerUp?(e: CanvasPointerEvent): void;
  onKeyDown?(e: KeyboardEvent): void;
  drawOverlay?(ctx: CanvasRenderingContext2D, view: ViewTransform): void;
}
export function registerCanvasTool(tool: CanvasTool): void;        // 最初に登録したものが既定のツール
export function registerCanvasOverlay(id: string, draw: (ctx: CanvasRenderingContext2D, view: ViewTransform) => void): void;
export function useCanvas(): { view: ViewTransform; activeToolId: string; setActiveTool(id: string): void; requestRedraw(): void; lastDeformed(): DeformedModel | null; screenToCanvas(p: Vec2): Vec2 };

export function useServices(): Services;
export function useProject(): Project;
export function useDispatch(): (c: Command) => void;
export function useEditor(): [EditorState, (patch: Partial<EditorState>) => void];
export function useEnvironment(): [Environment, (patch: Partial<Environment>) => void];
export function useDialogs(): { confirm(message: string): Promise<boolean>; notify(message: string): void; prompt(message: string, initial?: string): Promise<string | null> };
export function emitAppEvent(name: string, payload?: unknown): void;
export function onAppEvent(name: string, listener: (payload: unknown) => void): () => void;
```

### ストアの契約（@app/contracts）

```ts
export interface Command { label: string; apply(project: Project): Project }   // 純粋関数
export interface ProjectStore {
  get(): Project;
  subscribe(listener: (project: Project) => void): () => void;
  dispatch(command: Command): void;                                          // 1回の Undo 単位
  transaction(label: string, run: (dispatch: (c: Command) => void) => void): void;   // まとめて1回の Undo
  undo(): void; redo(): void; canUndo(): boolean; canRedo(): boolean;
  load(project: Project): void;                                              // 履歴を消して置き換える
}
export interface EditorState {
  mode: ModeId;
  uiLevel: Record<ModeId, UiLevel>;
  selectedPartIds: string[];
  activeParameterIds: string[];        // 編集中のパラメータ（0〜2個）
  editorParamValues: ParamValues;      // モデリング中のプレビュー値（無いパラメータはデフォルト値）
}
export interface EditorStore { get(): EditorState; set(patch: Partial<EditorState>): void; subscribe(l: (s: EditorState) => void): () => void }
```

## 作るもの

- `applyWarp`: 点 p について、u = (p.x − bounds.x) / bounds.width × columns、v = (p.y − bounds.y) / bounds.height × rows。セル i = floor(u) と j = floor(v) を 0..columns−1、0..rows−1 に丸め、s = u − i、t = v − j（範囲外の点では 0..1 を超えてよい。外へなめらかに延ばす）。4つの角の点（基準の points + delta）を双線形補間した位置へ動かす。
- `space.ts`: `pointsToModelSpace(model, deltas, partId, points)`（グループの点を、祖先の変形とワープを掛けたキャンバス上の位置にする）を作る。ツールの表示に使う。
- [ワープを追加]（詳細モード。「パーツの設定」のセクション、グループのとき）: bounds = 子孫の画像パーツの外接矩形（基準状態）に 5% の余白、分割は 4×4（2〜8 で変えられる）、points = 規則的な格子。[ワープを削除] も用意する（関係するバインディングも消す）。
- ワープ編集ツール（registerCanvasTool）: 格子を変形後の位置に描き、制御点のドラッグを keyEditor.pointsEdit({kind: 'warp'}) で記録する。'needsKey' の扱いはほかのツールと同じ。

## 作らないもの

曲面の生成（別のカード）。

## 完了条件

- [ ] 規則的な格子で恒等になる
- [ ] 全制御点の平行移動で子も同じだけ動く
- [ ] 双線形補間の値、範囲外での連続
- [ ] ワープの追加・編集・削除と Undo


---

# 30. 2Dパラメータと組み合わせキー

> このカードだけで実装できるように、必要な仕様・型・約束をすべて書いている。ほかのカードや設計書を読む必要はない。「前提」に書いたものは、このカードの時点で必ずある。名前と形を変えないこと。

| 項目 | 内容 |
| --- | --- |
| フェーズ / 段階 | STEP1 / S1 部品 |
| 並行作業 | 同じ段階の 27〜41 と並行して作れる（触るフォルダは重ならない） |
| 担当の目安 | 画面 |
| 作業場所 | apps/desktop/src/modes/modeling/grid2d/ |

## 目的

顔の向きの斜め（左上など）を方向グリッドで直せるようにし、詳細モードでは任意の2パラメータの組み合わせを補正できるようにする。

## 前提（このカードの時点ですでにあるもの）

KeyEditor は編集中のパラメータが2つのとき、2パラメータのバインディング（補正用。軸のキーは差分 0）を作って記録する。評価は双線形で、格子に無い組み合わせは軸の差分の和で代用する。顔の左右と上下は、それぞれ1パラメータのバインディングで動いている。

抜粋に名前だけ出てくる型も、すべて `@app/schema` か `@app/contracts` から import できる。

### Binding と ParameterKey（@app/schema）

```ts
export type Channel = 'transform' | 'vertices' | 'warpPoints';
export interface TransformDelta { position: Vec2; rotation: number; scale: Vec2; opacity: number }
// position・rotation は加算、scale・opacity は倍率（1 = 変化なし）
export interface Binding {
  id: Id;
  target: { type: 'part' | 'mesh' | 'warp'; id: Id };   // transform → part、vertices → mesh、warpPoints → warp
  channel: Channel;
  parameterIds: Id[];              // 1 または 2
  keyValues: number[][];           // パラメータごとのキー位置（昇順。デフォルト値を必ず含む）
  keys: ParameterKey[];
  generation: 'linear' | 'depth' | 'rotate' | 'surface' | 'ease';
  divisions: number | null;        // 中間キーの分割数（自動なら null）
}
export interface ParameterKey {
  coords: number[];                // parameterIds と同じ順の値
  delta: TransformDelta | Vec2[];  // transform は TransformDelta、それ以外は頂点・制御点ごとの差分
  source: 'manual' | 'auto' | 'generated' | 'combined';
  locked: boolean;
}
```

### ストアの契約（@app/contracts）

```ts
export interface Command { label: string; apply(project: Project): Project }   // 純粋関数
export interface ProjectStore {
  get(): Project;
  subscribe(listener: (project: Project) => void): () => void;
  dispatch(command: Command): void;                                          // 1回の Undo 単位
  transaction(label: string, run: (dispatch: (c: Command) => void) => void): void;   // まとめて1回の Undo
  undo(): void; redo(): void; canUndo(): boolean; canRedo(): boolean;
  load(project: Project): void;                                              // 履歴を消して置き換える
}
export interface EditorState {
  mode: ModeId;
  uiLevel: Record<ModeId, UiLevel>;
  selectedPartIds: string[];
  activeParameterIds: string[];        // 編集中のパラメータ（0〜2個）
  editorParamValues: ParamValues;      // モデリング中のプレビュー値（無いパラメータはデフォルト値）
}
export interface EditorStore { get(): EditorState; set(patch: Partial<EditorState>): void; subscribe(l: (s: EditorState) => void): () => void }
```

### アプリの枠の差し込み口（apps/desktop/src/shell/api.ts）

```ts
export interface PanelDef { id: string; mode: ModeId; area: 'left' | 'right' | 'bottom'; title: string; order?: number; level?: 'easy' | 'detail' | 'both'; component: React.FC }
export function registerPanel(def: PanelDef): void;
export interface SectionDef { id: string; panelId: string; order?: number; level?: 'easy' | 'detail' | 'both'; component: React.FC }
export function registerPanelSection(def: SectionDef): void;      // パネルの中の <PanelSections panelId=… /> に入る
export function PanelSections(props: { panelId: string }): JSX.Element;
export function registerCenter(mode: 'studio' | 'animation', component: React.FC): void;
export function registerSetupScreen(component: React.FC): void;   // 素材が1つも無いとき中央に出す
export function registerMenuItem(item: { id: string; label: string; shortcut?: string; run(): void }): void;

export interface CanvasPointerEvent { canvasPoint: Vec2; screenPoint: Vec2; button: number; shiftKey: boolean; altKey: boolean; ctrlKey: boolean }
export interface CanvasTool {
  id: string; label: string; cursor?: string;
  onPointerDown?(e: CanvasPointerEvent): void; onPointerMove?(e: CanvasPointerEvent): void; onPointerUp?(e: CanvasPointerEvent): void;
  onKeyDown?(e: KeyboardEvent): void;
  drawOverlay?(ctx: CanvasRenderingContext2D, view: ViewTransform): void;
}
export function registerCanvasTool(tool: CanvasTool): void;        // 最初に登録したものが既定のツール
export function registerCanvasOverlay(id: string, draw: (ctx: CanvasRenderingContext2D, view: ViewTransform) => void): void;
export function useCanvas(): { view: ViewTransform; activeToolId: string; setActiveTool(id: string): void; requestRedraw(): void; lastDeformed(): DeformedModel | null; screenToCanvas(p: Vec2): Vec2 };

export function useServices(): Services;
export function useProject(): Project;
export function useDispatch(): (c: Command) => void;
export function useEditor(): [EditorState, (patch: Partial<EditorState>) => void];
export function useEnvironment(): [Environment, (patch: Partial<Environment>) => void];
export function useDialogs(): { confirm(message: string): Promise<boolean>; notify(message: string): void; prompt(message: string, initial?: string): Promise<string | null> };
export function emitAppEvent(name: string, payload?: unknown): void;
export function onAppEvent(name: string, listener: (payload: unknown) => void): () => void;
```

### キー編集の契約（@app/contracts）

```ts
export type TransformChange = { dPosition?: Vec2; dRotation?: number; scaleFactor?: Vec2; opacityFactor?: number; dPivot?: Vec2 };
export type PointsTarget = { kind: 'mesh'; meshId: string } | { kind: 'warp'; warpId: string };
export interface KeyEditor {
  // EditorState の activeParameterIds と editorParamValues に応じて、基準状態かキーを変えるコマンドを返す
  transformEdit(project: Project, editor: EditorState, partIds: string[], change: TransformChange): Command | 'needsKey';
  pointsEdit(project: Project, editor: EditorState, target: PointsTarget, moves: { index: number; d: Vec2 }[]): Command | 'needsKey';
  addKeyAtCurrentValue(project: Project, editor: EditorState, target: { partId: string } | PointsTarget): Command;
}
```

## 作るもの

- 方向グリッド（パラメータパネルのセクション、かんたん）: FaceAngleX × FaceAngleY の 3×3（−30 / 0 / 30）。マスを押すと activeParameterIds = ['FaceAngleX', 'FaceAngleY']、editorParamValues をその値にする。中央以外の上下左右のマスは1パラメータの編集に戻す（activeParameterIds を片方だけにする）。
- 斜めのマスは、何もしなければ上下と左右の差分の和で動く。そのまま直すと補正用のキーができる（ロック）。
- マスの状態を出す: 自動 / 修正済み（補正のキーがある）。[自動に戻す] で補正のキーを消す。
- 組み合わせの補正（詳細のセクション）: 任意の2パラメータを選び、その組の格子（各パラメータのキー位置の組み合わせ）を同じ方法で編集できる（例: 目 開閉 × 目 笑顔）。

## 作らないもの

評価の処理（MVPで実装済み）。

## 完了条件

- [ ] 斜めのマスの見た目が、補正前は上下と左右の和になる
- [ ] 斜めのマスを直すと補正のキーができ、[自動に戻す] で消える
- [ ] 詳細で任意の2パラメータの組を編集できる


---

# 31. 生成方式の追加と、中間キーの編集・ロック・再補間

> このカードだけで実装できるように、必要な仕様・型・約束をすべて書いている。ほかのカードや設計書を読む必要はない。「前提」に書いたものは、このカードの時点で必ずある。名前と形を変えないこと。

| 項目 | 内容 |
| --- | --- |
| フェーズ / 段階 | STEP1 / S1 部品 |
| 並行作業 | 同じ段階の 27〜41 と並行して作れる（触るフォルダは重ならない） |
| 担当の目安 | コア |
| 作業場所 | packages/core/src/generate/（rotate.ts・surface.ts・ease.ts・regenerate.ts）、apps/desktop/src/modes/modeling/parameters/KeySlider.tsx |

## 目的

回転・曲面・なめらかの生成方式を加え、中間キーを直接直し、ロックしたまま作り直せるようにする。

## 前提（このカードの時点ですでにあるもの）

KeyGenerator の linear と depthParallax がある。パラメータパネルの KeySlider がキーの印を出している。

抜粋に名前だけ出てくる型も、すべて `@app/schema` か `@app/contracts` から import できる。

### パーツの変形と計算の順序

- パーツの変形は、点 p を `p' = position + pivot + R(rotation)·(scale ⊙ (p − pivot))` に動かす。R は y が下向きの座標で `[cos −sin; sin cos]`（正の角度で時計回り）。
- 実際に使う値: `position = Part.position + Δposition`、`rotation = Part.rotation + Δrotation`、`scale = Part.scale ⊙ Δscale`、`opacity = Part.opacity × Δopacity`（Δ はキーの合成結果）。
- 取り込み直後は position (0,0)・rotation 0・scale (1,1)。メッシュの頂点と pivot はキャンバス座標。
- 画像パーツの最終頂点は内側から外側へ求める。(1) メッシュの基準頂点 + 頂点の差分 → (2) 自身のパーツの変形 → (3) 親グループのワープ（あれば）→ (4) 親グループのパーツの変形 → ルートまで (3)(4) を繰り返す。
- 不透明度は、自身から親までの値をすべて掛け合わせる。

### Warp（@app/schema）

```ts
export interface Warp {
  id: Id;
  partId: Id;                      // ワープを付ける group パーツ
  columns: number; rows: number;   // 格子の分割数
  bounds: { x: number; y: number; width: number; height: number };   // キャンバス座標
  points: Vec2[];                  // (columns+1)×(rows+1) 個、行優先。基準状態の制御点
}
```

### Binding と ParameterKey（@app/schema）

```ts
export type Channel = 'transform' | 'vertices' | 'warpPoints';
export interface TransformDelta { position: Vec2; rotation: number; scale: Vec2; opacity: number }
// position・rotation は加算、scale・opacity は倍率（1 = 変化なし）
export interface Binding {
  id: Id;
  target: { type: 'part' | 'mesh' | 'warp'; id: Id };   // transform → part、vertices → mesh、warpPoints → warp
  channel: Channel;
  parameterIds: Id[];              // 1 または 2
  keyValues: number[][];           // パラメータごとのキー位置（昇順。デフォルト値を必ず含む）
  keys: ParameterKey[];
  generation: 'linear' | 'depth' | 'rotate' | 'surface' | 'ease';
  divisions: number | null;        // 中間キーの分割数（自動なら null）
}
export interface ParameterKey {
  coords: number[];                // parameterIds と同じ順の値
  delta: TransformDelta | Vec2[];  // transform は TransformDelta、それ以外は頂点・制御点ごとの差分
  source: 'manual' | 'auto' | 'generated' | 'combined';
  locked: boolean;
}
```

### Model と Project（@app/schema）

```ts
export interface Model {
  parts: Part[];
  meshes: Mesh[];
  warps: Warp[];
  drawOrder: Id[];                 // 画像パーツの id。背面 → 前面
  parameters: Parameter[];
  parameterGroups: ParameterGroup[];
  bindings: Binding[];
  lipSync: LipSync;
  setupHints: { closedLineL: Vec2[] | null; closedLineR: Vec2[] | null };   // かんたんセットアップ用（閉じた目の線。STEP1で使う）
}
export interface Project {
  schemaVersion: number;           // 現在は 1
  id: Id;
  name: string;
  assets: Asset[];
  model: Model;
  expressions: Expression[];
  animations: Animation[];
  physics: Physics[];
  trackingMappings: TrackingMapping[];   // 空なら既定のマッピング
  studio: { scenes: Scene[]; activeSceneId: Id | null; hotkeys: Hotkey[] };
}
```

### 生成・セットアップの契約（@app/contracts）

```ts
export interface KeyGenerator {
  linear(binding: Binding, divisions?: number): Binding;
  depthParallax(model: Model, parameterId: 'FaceAngleX' | 'FaceAngleY'): Binding[];   // 作り直した transform バインディング
}
export interface AutoSetup { plan(project: Project): { command: Command; warnings: string[] } }
```

### STEP1で増える契約（@app/contracts）

```ts
// TrackingFrame に足す任意の項目（無いときは undefined）
//   mouthForm?: number;  // -1..1（への字〜笑顔）
//   mouthWidth?: number; // -1..1（すぼめ〜横に開く）
//   browY?: number;      // -1..1（下げる〜上げる）

export interface AudioLevel { time: number; rmsDb: number }
export interface AudioSource {
  listDevices(): Promise<{ id: string; label: string }[]>;
  start(deviceId?: string): Promise<void>; stop(): void;
  onLevel(listener: (x: AudioLevel) => void): () => void;                                   // 10ms ごと
  onSamples(listener: (samples: Float32Array, sampleRate: number, time: number) => void): () => void;
}
export interface LipSyncProducer extends LayerProducer {   // id 'lipSync'
  configure(o: { mouthSource: 'max' | 'micOnly' | 'cameraOnly'; strength: 'low' | 'standard' | 'high'; silenceThresholdDb: number }): void;
  update(level: AudioLevel): void;
}
export interface AutoBlink { tick(now: number): { EyeOpenL: number; EyeOpenR: number } }
export interface BodyFollowProducer extends LayerProducer { setStrength(s: 'low' | 'standard' | 'high'): void }   // id 'bodyFollow'
export interface ExpressionController extends LayerProducer {   // id 'expression'
  apply(expressionId: string | null, now: number): void;        // null で解除。STEP1では1つだけ
  active(): string | null;
}
export type CalibrationStep = 'neutral' | 'eyesClosed' | 'mouthOpen';
export interface CalibrationService { capture(step: CalibrationStep, frames: TrackingFrame[]): void; result(): Environment['calibration']; reset(): void }
// TrackingLayerProducer に足すメソッド
//   setCalibration(c: Environment['calibration']): void
//   setPreset(p: 'stable' | 'standard' | 'large' | 'custom', custom?: { minCutoff: number; beta: number; gain: number; deadZone: number }): void
//   setEyeTracking(on: boolean): void   // off のときと外れたときは AutoBlink の値を使う
export interface HotkeyService { register(hotkey: Hotkey, handler: (phase: 'down' | 'up') => void): Promise<'ok' | 'conflict'>; unregisterAll(): Promise<void> }
export interface OutputSink {
  start(o: { width: number; height: number; fps: number }): Promise<void>;
  setTextures(pngs: Record<string, Uint8Array>): Promise<void>;
  submit(model: DeformedModel, view: ViewTransform, background: Background): void;
  stop(): Promise<void>;
}
// KeyGenerator に足すメソッド
//   rotate(binding: Binding, model: Model): Binding                    // 頂点・制御点をピボット中心の円弧で補間
//   surface(binding: Binding, model: Model): Binding                   // ワープの制御点を球面に沿って生成
//   ease(binding: Binding): Binding                                     // 中間キーの値をゆるやかに
//   regenerate(binding: Binding, model: Model, range?: [number, number]): Binding   // ロックされたキーを残して作り直す
// Services に足すもの: audio, lipSync, autoBlink, bodyFollow, expressions, calibration, hotkeys, spout（OutputSink）
```

### ストアの契約（@app/contracts）

```ts
export interface Command { label: string; apply(project: Project): Project }   // 純粋関数
export interface ProjectStore {
  get(): Project;
  subscribe(listener: (project: Project) => void): () => void;
  dispatch(command: Command): void;                                          // 1回の Undo 単位
  transaction(label: string, run: (dispatch: (c: Command) => void) => void): void;   // まとめて1回の Undo
  undo(): void; redo(): void; canUndo(): boolean; canRedo(): boolean;
  load(project: Project): void;                                              // 履歴を消して置き換える
}
export interface EditorState {
  mode: ModeId;
  uiLevel: Record<ModeId, UiLevel>;
  selectedPartIds: string[];
  activeParameterIds: string[];        // 編集中のパラメータ（0〜2個）
  editorParamValues: ParamValues;      // モデリング中のプレビュー値（無いパラメータはデフォルト値）
}
export interface EditorStore { get(): EditorState; set(patch: Partial<EditorState>): void; subscribe(l: (s: EditorState) => void): () => void }
```

## 作るもの

- `rotate.ts` の `generateRotateKeys(base: Vec2[], pivot: Vec2, a: Vec2[], b: Vec2[], ts: number[]): Vec2[][]`: 代表状態 a・b の各点を pivot からの角度と距離にし、ts（0..1）ごとに角度と距離を線形に補間した点の差分を返す。KeyGenerator.rotate はこれで vertices・warpPoints のバインディングの中間キーを作る（ピボットは対象のパーツ、ワープなら持ち主のグループ）。
- `surface.ts` の `generateSurfaceKeys(warp: Warp, parameterId: 'FaceAngleX' | 'FaceAngleY', values: number[]): Vec2[][]`: 制御点を球面に沿って動かす差分。中心 c = bounds の中心、半径 r = 0.6 × max(幅, 高さ)、角度 θ = value / 30 × 20°。X なら x' = c.x + r·sin(asin(clamp((x − c.x) / r, −1, 1)) + θ)、Y なら y について同様（上向きが正なので符号に注意）。KeyGenerator.surface は −30・0・30 と10刻みのキーをこれで作る（0 は差分 0）。
- `ease.ts`: KeyGenerator.ease は、中間キーの値を代表状態の間の smoothstep で作る。
- `regenerate.ts`: KeyGenerator.regenerate は、ロックされたキーと代表状態を残し、range の中（無ければ全体）の中間キーを binding.generation の方式で作り直す。
- KeySlider: 印をクリックするとその値へ移動（その値のキーを編集できる）。右クリックでロック / ロック解除。Shift＋ドラッグで範囲を選び、[選択範囲をロック] [選択範囲をロック解除] [選択範囲だけ再補間] を出す。[すべて再補間] も置く。生成方式（線形・回転・曲面・なめらか）は詳細モードで選べる。

## 作らないもの

かんたんセットアップでの曲面の自動作成（別のカード）。

## 完了条件

- [ ] rotate: 円弧上を通り、途中で縮まない
- [ ] surface: 中央の点ほど大きく動き、端は小さく動く
- [ ] ease: 両端で変化がゆるやか
- [ ] regenerate: ロックされたキーと範囲外が変わらない
- [ ] KeySlider の操作と Undo


---

# 32. 合成モードとPSDの合成・クリッピング

> このカードだけで実装できるように、必要な仕様・型・約束をすべて書いている。ほかのカードや設計書を読む必要はない。「前提」に書いたものは、このカードの時点で必ずある。名前と形を変えないこと。

| 項目 | 内容 |
| --- | --- |
| フェーズ / 段階 | STEP1 / S1 部品 |
| 並行作業 | 同じ段階の 27〜41 と並行して作れる（触るフォルダは重ならない） |
| 担当の目安 | 描画 |
| 作業場所 | packages/render/src/blend.ts、packages/io/src/import/、apps/desktop/src/modes/modeling/blend/、apps/desktop/src/modes/modeling/assets/ |

## 目的

乗算・スクリーン・加算で描けるようにし、PSD の合成モードを引き継ぎ、クリッピングを自動で統合する。

## 前提（このカードの時点ですでにあるもの）

レンダラーの合成は `blend.ts` の `applyBlend(gl, mode)` に集まっていて、今は normal だけ。取り込みは合成モードを sourceBlendMode に記録し、クリッピングなどを needsMerge で警告している。

抜粋に名前だけ出てくる型も、すべて `@app/schema` か `@app/contracts` から import できる。

### 基本の型（@app/schema）

```ts
export type Id = string;
export interface Vec2 { x: number; y: number }
export type BlendMode = 'normal' | 'multiply' | 'screen' | 'add';
export type ParameterGroupId = 'face' | 'eye' | 'brow' | 'mouth' | 'cheek' | 'body' | 'armL' | 'armR' | 'sway' | 'other';
export type ModeId = 'modeling' | 'animation' | 'studio';
export type UiLevel = 'easy' | 'detail';
export function newId(): string;   // ULID
```

### Asset（@app/schema）

```ts
export interface Asset {
  id: Id;
  path: string;                    // 例: assets/<id>.png
  hash: string;                    // png の SHA-256（16進）
  width: number; height: number;   // トリミング後のサイズ
  offset: Vec2;                    // トリミング後の左上のキャンバス座標
  canvasSize: { width: number; height: number };
  source: { kind: 'psd' | 'png'; file: string; layerName?: string; layerPath?: string[]; hidden?: boolean };
  sourceBlendMode: BlendMode;
  sourceOpacity: number;           // 0..1
}
```

### Part と StandardPartType（@app/schema）

```ts
export interface Part {
  id: Id;
  name: string;
  kind: 'image' | 'group';
  standardType: StandardPartType | null;   // 自由パーツは null
  assetId: Id | null;                      // image のみ
  meshId: Id | null;                       // image のみ
  parentId: Id | null;
  position: Vec2;                          // 初期値 {x: 0, y: 0}
  rotation: number;                        // 度。初期値 0
  scale: Vec2;                             // 初期値 {x: 1, y: 1}
  pivot: Vec2;                             // 回転・拡縮の中心（キャンバス座標）
  opacity: number;                         // 0..1
  blendMode: BlendMode;
  depth: number;                           // 奥行き。手前が正（-1..1 が目安）
  mask: { sourcePartIds: Id[]; inverted: boolean } | null;
  physicsId: Id | null;
  visible: boolean;
  locked: boolean;
}
export type StandardPartType =
  | 'face' | 'earL' | 'earR' | 'cheek'
  | 'eyeWhiteL' | 'irisL' | 'highlightL' | 'upperLidL' | 'lowerLidL' | 'eyeWholeL'
  | 'eyeWhiteR' | 'irisR' | 'highlightR' | 'upperLidR' | 'lowerLidR' | 'eyeWholeR'
  | 'browL' | 'browR'
  | 'upperLip' | 'lowerLip' | 'mouthInside' | 'teeth' | 'tongue' | 'mouthWhole'
  | 'frontHair' | 'sideHairL' | 'sideHairR' | 'backHair'
  | 'neck' | 'torso' | 'armL' | 'armR'
  // 変形グループ（かんたんセットアップが作る）
  | 'bodyRoot' | 'armRootL' | 'armRootR' | 'neckRoot' | 'headRoot'
  | 'faceGroup' | 'eyeGroupL' | 'eyeGroupR' | 'mouthGroup';
```

### 取り込み・保存の契約（@app/contracts）

```ts
export interface FileSystem {          // パスは / 区切りの絶対パス
  readText(path: string): Promise<string>; writeText(path: string, data: string): Promise<void>;
  readBinary(path: string): Promise<Uint8Array>; writeBinary(path: string, data: Uint8Array): Promise<void>;
  exists(path: string): Promise<boolean>; mkdir(path: string): Promise<void>;
  list(dir: string): Promise<string[]>; remove(path: string): Promise<void>; rename(from: string, to: string): Promise<void>;
}
export interface ImportedAsset { asset: Asset; png: Uint8Array }   // png はトリミング済み
export interface ImportWarning { kind: 'canvasMismatch' | 'noTransparency' | 'resolution' | 'needsMerge'; assetIds: string[]; layerNames: string[]; message: string }
export interface Importer { importFiles(files: { name: string; data: Uint8Array }[]): Promise<{ assets: ImportedAsset[]; warnings: ImportWarning[] }> }
export interface ProjectIO {
  save(dir: string, project: Project, assetPngs: Record<string, Uint8Array>): Promise<void>;
  load(dir: string): Promise<{ project: Project; assetPngs: Record<string, Uint8Array> }>;
}
export interface AutoSaver { start(dir: string): void; stop(): void; findRecoverable(dir: string): Promise<string | null> }
```

### アプリの枠の差し込み口（apps/desktop/src/shell/api.ts）

```ts
export interface PanelDef { id: string; mode: ModeId; area: 'left' | 'right' | 'bottom'; title: string; order?: number; level?: 'easy' | 'detail' | 'both'; component: React.FC }
export function registerPanel(def: PanelDef): void;
export interface SectionDef { id: string; panelId: string; order?: number; level?: 'easy' | 'detail' | 'both'; component: React.FC }
export function registerPanelSection(def: SectionDef): void;      // パネルの中の <PanelSections panelId=… /> に入る
export function PanelSections(props: { panelId: string }): JSX.Element;
export function registerCenter(mode: 'studio' | 'animation', component: React.FC): void;
export function registerSetupScreen(component: React.FC): void;   // 素材が1つも無いとき中央に出す
export function registerMenuItem(item: { id: string; label: string; shortcut?: string; run(): void }): void;

export interface CanvasPointerEvent { canvasPoint: Vec2; screenPoint: Vec2; button: number; shiftKey: boolean; altKey: boolean; ctrlKey: boolean }
export interface CanvasTool {
  id: string; label: string; cursor?: string;
  onPointerDown?(e: CanvasPointerEvent): void; onPointerMove?(e: CanvasPointerEvent): void; onPointerUp?(e: CanvasPointerEvent): void;
  onKeyDown?(e: KeyboardEvent): void;
  drawOverlay?(ctx: CanvasRenderingContext2D, view: ViewTransform): void;
}
export function registerCanvasTool(tool: CanvasTool): void;        // 最初に登録したものが既定のツール
export function registerCanvasOverlay(id: string, draw: (ctx: CanvasRenderingContext2D, view: ViewTransform) => void): void;
export function useCanvas(): { view: ViewTransform; activeToolId: string; setActiveTool(id: string): void; requestRedraw(): void; lastDeformed(): DeformedModel | null; screenToCanvas(p: Vec2): Vec2 };

export function useServices(): Services;
export function useProject(): Project;
export function useDispatch(): (c: Command) => void;
export function useEditor(): [EditorState, (patch: Partial<EditorState>) => void];
export function useEnvironment(): [Environment, (patch: Partial<Environment>) => void];
export function useDialogs(): { confirm(message: string): Promise<boolean>; notify(message: string): void; prompt(message: string, initial?: string): Promise<string | null> };
export function emitAppEvent(name: string, payload?: unknown): void;
export function onAppEvent(name: string, listener: (payload: unknown) => void): () => void;
```

## 作るもの

- `applyBlend`（乗算済みアルファ）: normal = (ONE, ONE_MINUS_SRC_ALPHA)、add = (ONE, ONE)、multiply = (DST_COLOR, ONE_MINUS_SRC_ALPHA)、screen = (ONE, ONE_MINUS_SRC_COLOR)。マスクのアルファは合成の前に掛ける。
- 取り込み: クリッピングされたレイヤーを、それぞれの合成モードと不透明度でクリップ先に重ね、クリップ先のアルファで切り抜いて1枚の素材にする（クリップ先の名前を使う）。needsMerge は、調整レイヤー・レイヤー効果・スマートオブジェクト・対応していない合成モードだけに出す。
- 割り当て: 画像パーツを作るときに blendMode = asset.sourceBlendMode にする。
- 合成モードの選択（「transform」のセクション）: 通常・乗算・スクリーン・加算。

## 作らないもの

そのほかの合成モード。

## 完了条件

- [ ] 4つの合成モードのピクセルのテスト（参照の式との差が ±3 以内）
- [ ] クリッピングの統合のテスト（PSD をテストの中で作る）
- [ ] 割り当てで合成モードが引き継がれる


---

# 33. 反転マスクと複数のマスク元

> このカードだけで実装できるように、必要な仕様・型・約束をすべて書いている。ほかのカードや設計書を読む必要はない。「前提」に書いたものは、このカードの時点で必ずある。名前と形を変えないこと。

| 項目 | 内容 |
| --- | --- |
| フェーズ / 段階 | STEP1 / S1 部品 |
| 並行作業 | 同じ段階の 27〜41 と並行して作れる（触るフォルダは重ならない） |
| 担当の目安 | 画面 |
| 作業場所 | apps/desktop/src/modes/modeling/structure/MaskPanel.tsx |

## 目的

マスクの反転と、複数のマスク元を画面から設定できるようにする。

## 前提（このカードの時点ですでにあるもの）

レンダラーは、複数のマスク元の和と反転にすでに対応している（マスク元自身のマスクは掛けない）。MaskPanel は1つのマスク元のドロップダウンだけ。

抜粋に名前だけ出てくる型も、すべて `@app/schema` か `@app/contracts` から import できる。

### Part と StandardPartType（@app/schema）

```ts
export interface Part {
  id: Id;
  name: string;
  kind: 'image' | 'group';
  standardType: StandardPartType | null;   // 自由パーツは null
  assetId: Id | null;                      // image のみ
  meshId: Id | null;                       // image のみ
  parentId: Id | null;
  position: Vec2;                          // 初期値 {x: 0, y: 0}
  rotation: number;                        // 度。初期値 0
  scale: Vec2;                             // 初期値 {x: 1, y: 1}
  pivot: Vec2;                             // 回転・拡縮の中心（キャンバス座標）
  opacity: number;                         // 0..1
  blendMode: BlendMode;
  depth: number;                           // 奥行き。手前が正（-1..1 が目安）
  mask: { sourcePartIds: Id[]; inverted: boolean } | null;
  physicsId: Id | null;
  visible: boolean;
  locked: boolean;
}
export type StandardPartType =
  | 'face' | 'earL' | 'earR' | 'cheek'
  | 'eyeWhiteL' | 'irisL' | 'highlightL' | 'upperLidL' | 'lowerLidL' | 'eyeWholeL'
  | 'eyeWhiteR' | 'irisR' | 'highlightR' | 'upperLidR' | 'lowerLidR' | 'eyeWholeR'
  | 'browL' | 'browR'
  | 'upperLip' | 'lowerLip' | 'mouthInside' | 'teeth' | 'tongue' | 'mouthWhole'
  | 'frontHair' | 'sideHairL' | 'sideHairR' | 'backHair'
  | 'neck' | 'torso' | 'armL' | 'armR'
  // 変形グループ（かんたんセットアップが作る）
  | 'bodyRoot' | 'armRootL' | 'armRootR' | 'neckRoot' | 'headRoot'
  | 'faceGroup' | 'eyeGroupL' | 'eyeGroupR' | 'mouthGroup';
```

### ストアの契約（@app/contracts）

```ts
export interface Command { label: string; apply(project: Project): Project }   // 純粋関数
export interface ProjectStore {
  get(): Project;
  subscribe(listener: (project: Project) => void): () => void;
  dispatch(command: Command): void;                                          // 1回の Undo 単位
  transaction(label: string, run: (dispatch: (c: Command) => void) => void): void;   // まとめて1回の Undo
  undo(): void; redo(): void; canUndo(): boolean; canRedo(): boolean;
  load(project: Project): void;                                              // 履歴を消して置き換える
}
export interface EditorState {
  mode: ModeId;
  uiLevel: Record<ModeId, UiLevel>;
  selectedPartIds: string[];
  activeParameterIds: string[];        // 編集中のパラメータ（0〜2個）
  editorParamValues: ParamValues;      // モデリング中のプレビュー値（無いパラメータはデフォルト値）
}
export interface EditorStore { get(): EditorState; set(patch: Partial<EditorState>): void; subscribe(l: (s: EditorState) => void): () => void }
```

## 作るもの

- マスク元を複数選べる一覧（チェック）と、[反転]（範囲の外を表示）のチェック。
- 選べないもの: 自身と子孫、画像でないパーツ。
- 説明の文: 「複数選ぶと、どれかの範囲を表示します。反転すると、その外側を表示します」。

## 作らないもの

範囲の積・差（将来検討）。

## 完了条件

- [ ] 複数・反転の設定が保存され、描画に反映される
- [ ] 選べないパーツが出ない
- [ ] Undo できる


---

# 34. 不透明度のキー・標準パラメータの追加・ユーザー定義パラメータ

> このカードだけで実装できるように、必要な仕様・型・約束をすべて書いている。ほかのカードや設計書を読む必要はない。「前提」に書いたものは、このカードの時点で必ずある。名前と形を変えないこと。

| 項目 | 内容 |
| --- | --- |
| フェーズ / 段階 | STEP1 / S1 部品 |
| 並行作業 | 同じ段階の 27〜41 と並行して作れる（触るフォルダは重ならない） |
| 担当の目安 | 画面 |
| 作業場所 | apps/desktop/src/modes/modeling/opacity/、apps/desktop/src/modes/modeling/userParams/、apps/desktop/src/project/step1Params.ts |

## 目的

パラメータで不透明度を変えられるようにし、STEP1の標準パラメータとユーザー定義パラメータを使えるようにする。

## 前提（このカードの時点ですでにあるもの）

KeyEditor は transformEdit の opacityFactor をキーに記録できる。評価と変形は不透明度の倍率に対応している。プロジェクトを開いたときと新規作成のときに、アプリイベント 'projectLoaded' が出る。

抜粋に名前だけ出てくる型も、すべて `@app/schema` か `@app/contracts` から import できる。

### Parameter と ParameterGroup（@app/schema）

```ts
export interface ParameterGroup { id: ParameterGroupId; name: string }
export interface Parameter {
  id: Id;                          // 標準は 'FaceAngleX' など。ユーザー定義は任意の文字列
  name: string;                    // 表示名
  groupId: ParameterGroupId;
  min: number; max: number; default: number;
  standard: boolean;
}
```

### Binding と ParameterKey（@app/schema）

```ts
export type Channel = 'transform' | 'vertices' | 'warpPoints';
export interface TransformDelta { position: Vec2; rotation: number; scale: Vec2; opacity: number }
// position・rotation は加算、scale・opacity は倍率（1 = 変化なし）
export interface Binding {
  id: Id;
  target: { type: 'part' | 'mesh' | 'warp'; id: Id };   // transform → part、vertices → mesh、warpPoints → warp
  channel: Channel;
  parameterIds: Id[];              // 1 または 2
  keyValues: number[][];           // パラメータごとのキー位置（昇順。デフォルト値を必ず含む）
  keys: ParameterKey[];
  generation: 'linear' | 'depth' | 'rotate' | 'surface' | 'ease';
  divisions: number | null;        // 中間キーの分割数（自動なら null）
}
export interface ParameterKey {
  coords: number[];                // parameterIds と同じ順の値
  delta: TransformDelta | Vec2[];  // transform は TransformDelta、それ以外は頂点・制御点ごとの差分
  source: 'manual' | 'auto' | 'generated' | 'combined';
  locked: boolean;
}
```

### 標準パラメータ（STANDARD_PARAMETERS）

| id | 表示名 | group | min | max | default | フェーズ |
| --- | --- | --- | --- | --- | --- | --- |
| FaceAngleX | 顔 左右 | face | -30 | 30 | 0 | MVP |
| FaceAngleY | 顔 上下 | face | -30 | 30 | 0 | MVP |
| FaceAngleZ | 顔 傾き | face | -30 | 30 | 0 | MVP |
| EyeOpenL / EyeOpenR | 目 開閉 L / R | eye | 0 | 1 | 1 | MVP |
| EyeBallX / EyeBallY | 瞳 左右 / 上下 | eye | -1 | 1 | 0 | MVP |
| MouthOpen | 口 開閉 | mouth | 0 | 1 | 0 | MVP |
| EyeSmileL / EyeSmileR | 目 笑顔 L / R | eye | 0 | 1 | 0 | STEP1 |
| BrowYL / BrowYR | 眉 上下 L / R | brow | -1 | 1 | 0 | STEP1 |
| BrowFormL / BrowFormR | 眉 形 L / R（困り〜怒り） | brow | -1 | 1 | 0 | STEP1 |
| MouthForm | 口 形（への字〜笑顔） | mouth | -1 | 1 | 0 | STEP1 |
| MouthWidth | 口 横幅（すぼめ〜横に開く） | mouth | -1 | 1 | 0 | STEP1 |
| Cheek | 頬染め | cheek | 0 | 1 | 0 | STEP1 |
| BodyAngleX / BodyAngleY / BodyAngleZ | 体 左右 / 上下 / 傾き | body | -10 | 10 | 0 | STEP1 |
| Breath | 呼吸 | body | 0 | 1 | 0 | STEP2 |
| ArmL / ArmR | 腕 L / R | armL / armR | -1 | 1 | 0 | STEP2 |
| HairFront / HairSide / HairBack | 髪揺れ 前 / 横 / 後ろ | sway | -1 | 1 | 0 | STEP2 |

### スキーマの関数（@app/schema）

```ts
export const SCHEMA_VERSION = 1;
export function validateProject(json: unknown): Project;       // 失敗時は項目のパス付きのエラー
export function migrate(json: unknown): unknown;               // 古い版を現在の版へ変換
export function loadProjectJson(text: string): Project;        // 解析 → migrate → validate
export function createEmptyProject(name: string): Project;     // MVPの標準パラメータ入り
export function ensureStandardParameters(model: Model, phase: 'mvp' | 'step1' | 'step2'): Model;
```

### キー編集の契約（@app/contracts）

```ts
export type TransformChange = { dPosition?: Vec2; dRotation?: number; scaleFactor?: Vec2; opacityFactor?: number; dPivot?: Vec2 };
export type PointsTarget = { kind: 'mesh'; meshId: string } | { kind: 'warp'; warpId: string };
export interface KeyEditor {
  // EditorState の activeParameterIds と editorParamValues に応じて、基準状態かキーを変えるコマンドを返す
  transformEdit(project: Project, editor: EditorState, partIds: string[], change: TransformChange): Command | 'needsKey';
  pointsEdit(project: Project, editor: EditorState, target: PointsTarget, moves: { index: number; d: Vec2 }[]): Command | 'needsKey';
  addKeyAtCurrentValue(project: Project, editor: EditorState, target: { partId: string } | PointsTarget): Command;
}
```

### アプリの枠の差し込み口（apps/desktop/src/shell/api.ts）

```ts
export interface PanelDef { id: string; mode: ModeId; area: 'left' | 'right' | 'bottom'; title: string; order?: number; level?: 'easy' | 'detail' | 'both'; component: React.FC }
export function registerPanel(def: PanelDef): void;
export interface SectionDef { id: string; panelId: string; order?: number; level?: 'easy' | 'detail' | 'both'; component: React.FC }
export function registerPanelSection(def: SectionDef): void;      // パネルの中の <PanelSections panelId=… /> に入る
export function PanelSections(props: { panelId: string }): JSX.Element;
export function registerCenter(mode: 'studio' | 'animation', component: React.FC): void;
export function registerSetupScreen(component: React.FC): void;   // 素材が1つも無いとき中央に出す
export function registerMenuItem(item: { id: string; label: string; shortcut?: string; run(): void }): void;

export interface CanvasPointerEvent { canvasPoint: Vec2; screenPoint: Vec2; button: number; shiftKey: boolean; altKey: boolean; ctrlKey: boolean }
export interface CanvasTool {
  id: string; label: string; cursor?: string;
  onPointerDown?(e: CanvasPointerEvent): void; onPointerMove?(e: CanvasPointerEvent): void; onPointerUp?(e: CanvasPointerEvent): void;
  onKeyDown?(e: KeyboardEvent): void;
  drawOverlay?(ctx: CanvasRenderingContext2D, view: ViewTransform): void;
}
export function registerCanvasTool(tool: CanvasTool): void;        // 最初に登録したものが既定のツール
export function registerCanvasOverlay(id: string, draw: (ctx: CanvasRenderingContext2D, view: ViewTransform) => void): void;
export function useCanvas(): { view: ViewTransform; activeToolId: string; setActiveTool(id: string): void; requestRedraw(): void; lastDeformed(): DeformedModel | null; screenToCanvas(p: Vec2): Vec2 };

export function useServices(): Services;
export function useProject(): Project;
export function useDispatch(): (c: Command) => void;
export function useEditor(): [EditorState, (patch: Partial<EditorState>) => void];
export function useEnvironment(): [Environment, (patch: Partial<Environment>) => void];
export function useDialogs(): { confirm(message: string): Promise<boolean>; notify(message: string): void; prompt(message: string, initial?: string): Promise<string | null> };
export function emitAppEvent(name: string, payload?: unknown): void;
export function onAppEvent(name: string, listener: (payload: unknown) => void): () => void;
```

### ストアの契約（@app/contracts）

```ts
export interface Command { label: string; apply(project: Project): Project }   // 純粋関数
export interface ProjectStore {
  get(): Project;
  subscribe(listener: (project: Project) => void): () => void;
  dispatch(command: Command): void;                                          // 1回の Undo 単位
  transaction(label: string, run: (dispatch: (c: Command) => void) => void): void;   // まとめて1回の Undo
  undo(): void; redo(): void; canUndo(): boolean; canRedo(): boolean;
  load(project: Project): void;                                              // 履歴を消して置き換える
}
export interface EditorState {
  mode: ModeId;
  uiLevel: Record<ModeId, UiLevel>;
  selectedPartIds: string[];
  activeParameterIds: string[];        // 編集中のパラメータ（0〜2個）
  editorParamValues: ParamValues;      // モデリング中のプレビュー値（無いパラメータはデフォルト値）
}
export interface EditorStore { get(): EditorState; set(patch: Partial<EditorState>): void; subscribe(l: (s: EditorState) => void): () => void }
```

## 作るもの

- 不透明度（「transform」のセクション）: パラメータの編集中に「不透明度（このキー）」のスライダーを出し、keyEditor.transformEdit の opacityFactor で記録する（例: 頬染めを Cheek で出し入れ）。
- `step1Params.ts`: 'projectLoaded' で ensureStandardParameters(model, 'step1') を実行する（足りないものがあるときだけ）。
- パラメータパネルの結果の言葉に STEP1 の標準パラメータを足す（目 笑顔: なし / 笑顔、眉 上下: 下げる / – / 上げる、眉 形: 困り / – / 怒り、口 形: への字 / – / 笑顔、口 横幅: すぼめる / – / 横に開く、頬染め: なし / 染める、体: 頭と同じ言葉）。
- ユーザー定義パラメータ（パラメータパネルのセクション）: 一覧、[追加]（名前・最小・最大・デフォルト値・グループ）、編集、削除。削除はそのパラメータを使うバインディング・トラッキングのマッピング・表情の項目も消す（確認あり）。id は newId()、standard は false。

## 作らないもの

トラッキングやホットキーへの割り当ての画面（それぞれのカード）。

## 完了条件

- [ ] 不透明度をキーで変えられる
- [ ] 開いたプロジェクトに STEP1 の標準パラメータが足される
- [ ] ユーザー定義パラメータの追加・編集・削除と Undo


---

# 35. キャリブレーション・トラッキング簡易設定・追加の入力

> このカードだけで実装できるように、必要な仕様・型・約束をすべて書いている。ほかのカードや設計書を読む必要はない。「前提」に書いたものは、このカードの時点で必ずある。名前と形を変えないこと。

| 項目 | 内容 |
| --- | --- |
| フェーズ / 段階 | STEP1 / S1 部品 |
| 並行作業 | 同じ段階の 27〜41 と並行して作れる（触るフォルダは重ならない） |
| 担当の目安 | トラッキング |
| 作業場所 | packages/tracking/src/、apps/desktop/src/modes/studio/calibration/ |

## 目的

個人差を吸収するキャリブレーションと、動きの簡易設定、口の形・眉の入力を加える。

## 前提（このカードの時点ですでにあるもの）

MVPのトラッキング（createMediaPipeTrackingSource・createTrackingLayerProducer）がある。services.autoBlink（AutoBlink）がある。スタジオの right パネルに `<PanelSections panelId="studioSettings" />` がある。

抜粋に名前だけ出てくる型も、すべて `@app/schema` か `@app/contracts` から import できる。

### 座標と値の約束

- 座標はキャンバス（元のPSD・PNG）のピクセル。原点は左上、x は右、y は下が正。
- 回転は度。画面上の時計回りが正。
- L / R はキャラクター自身から見た左右。画面では L が右側に描かれる。
- FaceAngleX はキャラクターが画面の右を向くと正、FaceAngleY は上を向くと正、FaceAngleZ は時計回りが正。EyeBallX は画面の右を見ると正、EyeBallY は上を見ると正。
- 基準状態 = 素材を配置しただけの状態 = 全パラメータがデフォルト値の状態。素材は「目を開け、口を閉じた」状態で描かれている前提。
- キーは基準状態からの差分。位置・回転・頂点は加算、拡縮・不透明度は倍率（1 = 変化なし）。

### トラッキングの契約（@app/contracts）

```ts
export interface TrackingFrame {
  time: number;                    // ミリ秒（performance.now）
  detected: boolean;
  faceYaw: number;                 // 度。ユーザーが自分の右を向くと正
  facePitch: number;               // 度。上を向くと正
  faceRoll: number;                // 度。ユーザーが自分の右へ傾けると正
  eyeOpenL: number; eyeOpenR: number;   // 0..1。ユーザー自身の左目・右目
  eyeBallX: number;                // -1..1。ユーザーが自分の右を見ると正
  eyeBallY: number;                // -1..1。上を見ると正
  mouthOpen: number;               // 0..1
}
export interface TrackingSource {
  listDevices(): Promise<{ id: string; label: string }[]>;
  start(deviceId?: string): Promise<void>;
  stop(): void;
  onFrame(listener: (frame: TrackingFrame) => void): () => void;
}
export interface TrackingLayerProducer {
  update(frame: TrackingFrame): void;
  tick(now: number): Layer;        // id 'tracking'
  status(): 'tracking' | 'lost';
  setMirror(on: boolean): void;
  setLostBehavior(b: 'returnToFront' | 'hold'): void;
}
```

### STEP1で増える契約（@app/contracts）

```ts
// TrackingFrame に足す任意の項目（無いときは undefined）
//   mouthForm?: number;  // -1..1（への字〜笑顔）
//   mouthWidth?: number; // -1..1（すぼめ〜横に開く）
//   browY?: number;      // -1..1（下げる〜上げる）

export interface AudioLevel { time: number; rmsDb: number }
export interface AudioSource {
  listDevices(): Promise<{ id: string; label: string }[]>;
  start(deviceId?: string): Promise<void>; stop(): void;
  onLevel(listener: (x: AudioLevel) => void): () => void;                                   // 10ms ごと
  onSamples(listener: (samples: Float32Array, sampleRate: number, time: number) => void): () => void;
}
export interface LipSyncProducer extends LayerProducer {   // id 'lipSync'
  configure(o: { mouthSource: 'max' | 'micOnly' | 'cameraOnly'; strength: 'low' | 'standard' | 'high'; silenceThresholdDb: number }): void;
  update(level: AudioLevel): void;
}
export interface AutoBlink { tick(now: number): { EyeOpenL: number; EyeOpenR: number } }
export interface BodyFollowProducer extends LayerProducer { setStrength(s: 'low' | 'standard' | 'high'): void }   // id 'bodyFollow'
export interface ExpressionController extends LayerProducer {   // id 'expression'
  apply(expressionId: string | null, now: number): void;        // null で解除。STEP1では1つだけ
  active(): string | null;
}
export type CalibrationStep = 'neutral' | 'eyesClosed' | 'mouthOpen';
export interface CalibrationService { capture(step: CalibrationStep, frames: TrackingFrame[]): void; result(): Environment['calibration']; reset(): void }
// TrackingLayerProducer に足すメソッド
//   setCalibration(c: Environment['calibration']): void
//   setPreset(p: 'stable' | 'standard' | 'large' | 'custom', custom?: { minCutoff: number; beta: number; gain: number; deadZone: number }): void
//   setEyeTracking(on: boolean): void   // off のときと外れたときは AutoBlink の値を使う
export interface HotkeyService { register(hotkey: Hotkey, handler: (phase: 'down' | 'up') => void): Promise<'ok' | 'conflict'>; unregisterAll(): Promise<void> }
export interface OutputSink {
  start(o: { width: number; height: number; fps: number }): Promise<void>;
  setTextures(pngs: Record<string, Uint8Array>): Promise<void>;
  submit(model: DeformedModel, view: ViewTransform, background: Background): void;
  stop(): Promise<void>;
}
// KeyGenerator に足すメソッド
//   rotate(binding: Binding, model: Model): Binding                    // 頂点・制御点をピボット中心の円弧で補間
//   surface(binding: Binding, model: Model): Binding                   // ワープの制御点を球面に沿って生成
//   ease(binding: Binding): Binding                                     // 中間キーの値をゆるやかに
//   regenerate(binding: Binding, model: Model, range?: [number, number]): Binding   // ロックされたキーを残して作り直す
// Services に足すもの: audio, lipSync, autoBlink, bodyFollow, expressions, calibration, hotkeys, spout（OutputSink）
```

### TrackingMapping（@app/schema）

```ts
export type TrackingInput = 'faceYaw' | 'facePitch' | 'faceRoll' | 'eyeOpenL' | 'eyeOpenR' | 'eyeBallX' | 'eyeBallY'
  | 'mouthOpen' | 'mouthForm' | 'mouthWidth' | 'browY';
export interface TrackingMapping {
  input: TrackingInput; parameterId: Id;
  inputRange: [number, number]; outputRange: [number, number];
  invert: boolean; curve: 'linear' | 'smooth';
  smoothing: number;               // 0..1
  deadZone: number;                // 入力の単位
}
```

### Environment（@app/schema。PCごとの設定でプロジェクトの外に保存）

```ts
export interface Environment {
  cameraDeviceId: string | null;
  mirror: boolean;
  calibration: { neutral: { yaw: number; pitch: number; roll: number }; eyeClosed: { l: number; r: number }; mouthOpenMax: number } | null;
  microphoneDeviceId: string | null;
  silenceThreshold: number;        // dBFS
  trackingPreset: 'stable' | 'standard' | 'large' | 'custom';
  output: { method: 'window' | 'spout2'; width: number; height: number; fps: number };
  uiLevel: Record<ModeId, UiLevel>;
  lastProjectDir: string | null;
}
```

### アプリの枠の差し込み口（apps/desktop/src/shell/api.ts）

```ts
export interface PanelDef { id: string; mode: ModeId; area: 'left' | 'right' | 'bottom'; title: string; order?: number; level?: 'easy' | 'detail' | 'both'; component: React.FC }
export function registerPanel(def: PanelDef): void;
export interface SectionDef { id: string; panelId: string; order?: number; level?: 'easy' | 'detail' | 'both'; component: React.FC }
export function registerPanelSection(def: SectionDef): void;      // パネルの中の <PanelSections panelId=… /> に入る
export function PanelSections(props: { panelId: string }): JSX.Element;
export function registerCenter(mode: 'studio' | 'animation', component: React.FC): void;
export function registerSetupScreen(component: React.FC): void;   // 素材が1つも無いとき中央に出す
export function registerMenuItem(item: { id: string; label: string; shortcut?: string; run(): void }): void;

export interface CanvasPointerEvent { canvasPoint: Vec2; screenPoint: Vec2; button: number; shiftKey: boolean; altKey: boolean; ctrlKey: boolean }
export interface CanvasTool {
  id: string; label: string; cursor?: string;
  onPointerDown?(e: CanvasPointerEvent): void; onPointerMove?(e: CanvasPointerEvent): void; onPointerUp?(e: CanvasPointerEvent): void;
  onKeyDown?(e: KeyboardEvent): void;
  drawOverlay?(ctx: CanvasRenderingContext2D, view: ViewTransform): void;
}
export function registerCanvasTool(tool: CanvasTool): void;        // 最初に登録したものが既定のツール
export function registerCanvasOverlay(id: string, draw: (ctx: CanvasRenderingContext2D, view: ViewTransform) => void): void;
export function useCanvas(): { view: ViewTransform; activeToolId: string; setActiveTool(id: string): void; requestRedraw(): void; lastDeformed(): DeformedModel | null; screenToCanvas(p: Vec2): Vec2 };

export function useServices(): Services;
export function useProject(): Project;
export function useDispatch(): (c: Command) => void;
export function useEditor(): [EditorState, (patch: Partial<EditorState>) => void];
export function useEnvironment(): [Environment, (patch: Partial<Environment>) => void];
export function useDialogs(): { confirm(message: string): Promise<boolean>; notify(message: string): void; prompt(message: string, initial?: string): Promise<string | null> };
export function emitAppEvent(name: string, payload?: unknown): void;
export function onAppEvent(name: string, listener: (payload: unknown) => void): () => void;
```

## 作るもの

- 推定に足す: mouthForm = (mouthSmileLeft + mouthSmileRight)/2 − (mouthFrownLeft + mouthFrownRight)/2、mouthWidth = (mouthStretchLeft + mouthStretchRight)/2 − mouthPucker、browY = browInnerUp − (browDownLeft + browDownRight)/2（いずれも −1..1 に丸める）。
- 既定のマッピングに足す: mouthForm → MouthForm、mouthWidth → MouthWidth、browY → BrowYL と BrowYR。
- `createCalibrationService()`: neutral は yaw・pitch・roll の中央値、eyesClosed は目の開きの中央値、mouthOpen は口の開きの90パーセンタイル。
- setCalibration: yaw・pitch・roll から neutral を引く。目は [eyeClosed, 1] を [0, 1] に、口は [0, mouthOpenMax] を [0, 1] に写す。
- setPreset: stable（minCutoff 0.5、beta 0.01、gain 0.9、deadZone 1.5）、standard（1.0、0.02、1.0、0.5）、large（1.5、0.05、1.2、0）、custom。gain は写像の後に中央からの差へ掛ける。
- setEyeTracking(false) のときと外れたときは、EyeOpenL / R に autoBlink.tick(now) の値を使う。
- 画面（studioSettings のセクション）: [キャリブレーション] で3手順（正面を向く・目を閉じる・口を大きく開ける）。各手順は 3・2・1 のあと1秒ぶんのフレームを集める。結果は Environment.calibration に保存。「動き」の 安定 / 標準 / 大きく動く（presetOf で「カスタム」を表示。「安定は動きの遅れが少し増えます」と添える）。[目のトラッキング] のオン・オフ。アプリイベント 'recalibrate' でキャリブレーションを開く。

## 作らないもの

自動まばたきの中身（別のカード）。

## 完了条件

- [ ] 合成したブレンドシェイプから mouthForm・mouthWidth・browY が正しく出る
- [ ] キャリブレーションの値の計算と、写像への反映
- [ ] プリセットごとのフィルタの値
- [ ] 目のトラッキングをオフにすると AutoBlink の値になる


---

# 36. 自動まばたきと体の追従

> このカードだけで実装できるように、必要な仕様・型・約束をすべて書いている。ほかのカードや設計書を読む必要はない。「前提」に書いたものは、このカードの時点で必ずある。名前と形を変えないこと。

| 項目 | 内容 |
| --- | --- |
| フェーズ / 段階 | STEP1 / S1 部品 |
| 並行作業 | 同じ段階の 27〜41 と並行して作れる（触るフォルダは重ならない） |
| 担当の目安 | コア |
| 作業場所 | packages/core/src/layers/autoBlink.ts・bodyFollow.ts、apps/desktop/src/modes/studio/producers/bodyFollow.ts |

## 目的

目の入力が無いときの自然なまばたきと、顔の動きに体がついてくる動きを作る。

## 前提（このカードの時点ですでにあるもの）

スタジオの実行部に registerLayerProducer がある。Environment に設定を保存できる。

抜粋に名前だけ出てくる型も、すべて `@app/schema` か `@app/contracts` から import できる。

### 合成の契約（@app/contracts）

```ts
export type LayerId = 'tracking' | 'bodyFollow' | 'expression' | 'animation' | 'lipSync' | 'periodic' | 'physics';
export const LAYER_ORDER: LayerId[] = ['tracking', 'bodyFollow', 'expression', 'animation', 'lipSync', 'periodic', 'physics'];
export interface Layer {
  id: LayerId;
  weight: number;                     // 0..1
  values: ParamValues;                // このレイヤーが担当するパラメータの値だけ
  blend?: Record<string, BlendOp>;    // パラメータごとの合成方法。無ければ override
}
export interface ParameterMixer { mix(parameters: Parameter[], layers: Layer[]): ParamValues }

// スタジオの1フレームの文脈。producer は LAYER_ORDER の順に呼ばれる
export interface FrameContext {
  now: number; dt: number;            // ミリ秒
  project: Project;
  mixedSoFar: ParamValues;            // それまでのレイヤーを合成した値
  flags: { lipSyncWeight: number; physicsActive: boolean };   // 前のレイヤーが後のレイヤーへ伝える値（初期値 1・true）
}
export interface LayerProducer { id: LayerId; produce(ctx: FrameContext): Layer | null }
```

### STEP1で増える契約（@app/contracts）

```ts
// TrackingFrame に足す任意の項目（無いときは undefined）
//   mouthForm?: number;  // -1..1（への字〜笑顔）
//   mouthWidth?: number; // -1..1（すぼめ〜横に開く）
//   browY?: number;      // -1..1（下げる〜上げる）

export interface AudioLevel { time: number; rmsDb: number }
export interface AudioSource {
  listDevices(): Promise<{ id: string; label: string }[]>;
  start(deviceId?: string): Promise<void>; stop(): void;
  onLevel(listener: (x: AudioLevel) => void): () => void;                                   // 10ms ごと
  onSamples(listener: (samples: Float32Array, sampleRate: number, time: number) => void): () => void;
}
export interface LipSyncProducer extends LayerProducer {   // id 'lipSync'
  configure(o: { mouthSource: 'max' | 'micOnly' | 'cameraOnly'; strength: 'low' | 'standard' | 'high'; silenceThresholdDb: number }): void;
  update(level: AudioLevel): void;
}
export interface AutoBlink { tick(now: number): { EyeOpenL: number; EyeOpenR: number } }
export interface BodyFollowProducer extends LayerProducer { setStrength(s: 'low' | 'standard' | 'high'): void }   // id 'bodyFollow'
export interface ExpressionController extends LayerProducer {   // id 'expression'
  apply(expressionId: string | null, now: number): void;        // null で解除。STEP1では1つだけ
  active(): string | null;
}
export type CalibrationStep = 'neutral' | 'eyesClosed' | 'mouthOpen';
export interface CalibrationService { capture(step: CalibrationStep, frames: TrackingFrame[]): void; result(): Environment['calibration']; reset(): void }
// TrackingLayerProducer に足すメソッド
//   setCalibration(c: Environment['calibration']): void
//   setPreset(p: 'stable' | 'standard' | 'large' | 'custom', custom?: { minCutoff: number; beta: number; gain: number; deadZone: number }): void
//   setEyeTracking(on: boolean): void   // off のときと外れたときは AutoBlink の値を使う
export interface HotkeyService { register(hotkey: Hotkey, handler: (phase: 'down' | 'up') => void): Promise<'ok' | 'conflict'>; unregisterAll(): Promise<void> }
export interface OutputSink {
  start(o: { width: number; height: number; fps: number }): Promise<void>;
  setTextures(pngs: Record<string, Uint8Array>): Promise<void>;
  submit(model: DeformedModel, view: ViewTransform, background: Background): void;
  stop(): Promise<void>;
}
// KeyGenerator に足すメソッド
//   rotate(binding: Binding, model: Model): Binding                    // 頂点・制御点をピボット中心の円弧で補間
//   surface(binding: Binding, model: Model): Binding                   // ワープの制御点を球面に沿って生成
//   ease(binding: Binding): Binding                                     // 中間キーの値をゆるやかに
//   regenerate(binding: Binding, model: Model, range?: [number, number]): Binding   // ロックされたキーを残して作り直す
// Services に足すもの: audio, lipSync, autoBlink, bodyFollow, expressions, calibration, hotkeys, spout（OutputSink）
```

### スタジオの実行部の差し込み口（apps/desktop/src/modes/studio/runtime.ts）

```ts
export function registerLayerProducer(p: LayerProducer): () => void;   // LayerProducer・FrameContext は @app/contracts
export interface StudioFrame { model: DeformedModel; view: ViewTransform; background: Background; params: ParamValues; now: number }
export function registerFrameSink(sink: (frame: StudioFrame) => void): () => void;
export function useStudioRuntime(): { running: boolean; status: 'tracking' | 'lost' | 'stopped'; lastFrame(): StudioFrame | null };
```

1フレームの処理: LAYER_ORDER の順に producer を呼び、呼ぶたびに mixedSoFar を更新する → mixer.mix → evaluator → pipeline → プレビューの renderer と、登録された sink へ渡す。

### アプリの枠の差し込み口（apps/desktop/src/shell/api.ts）

```ts
export interface PanelDef { id: string; mode: ModeId; area: 'left' | 'right' | 'bottom'; title: string; order?: number; level?: 'easy' | 'detail' | 'both'; component: React.FC }
export function registerPanel(def: PanelDef): void;
export interface SectionDef { id: string; panelId: string; order?: number; level?: 'easy' | 'detail' | 'both'; component: React.FC }
export function registerPanelSection(def: SectionDef): void;      // パネルの中の <PanelSections panelId=… /> に入る
export function PanelSections(props: { panelId: string }): JSX.Element;
export function registerCenter(mode: 'studio' | 'animation', component: React.FC): void;
export function registerSetupScreen(component: React.FC): void;   // 素材が1つも無いとき中央に出す
export function registerMenuItem(item: { id: string; label: string; shortcut?: string; run(): void }): void;

export interface CanvasPointerEvent { canvasPoint: Vec2; screenPoint: Vec2; button: number; shiftKey: boolean; altKey: boolean; ctrlKey: boolean }
export interface CanvasTool {
  id: string; label: string; cursor?: string;
  onPointerDown?(e: CanvasPointerEvent): void; onPointerMove?(e: CanvasPointerEvent): void; onPointerUp?(e: CanvasPointerEvent): void;
  onKeyDown?(e: KeyboardEvent): void;
  drawOverlay?(ctx: CanvasRenderingContext2D, view: ViewTransform): void;
}
export function registerCanvasTool(tool: CanvasTool): void;        // 最初に登録したものが既定のツール
export function registerCanvasOverlay(id: string, draw: (ctx: CanvasRenderingContext2D, view: ViewTransform) => void): void;
export function useCanvas(): { view: ViewTransform; activeToolId: string; setActiveTool(id: string): void; requestRedraw(): void; lastDeformed(): DeformedModel | null; screenToCanvas(p: Vec2): Vec2 };

export function useServices(): Services;
export function useProject(): Project;
export function useDispatch(): (c: Command) => void;
export function useEditor(): [EditorState, (patch: Partial<EditorState>) => void];
export function useEnvironment(): [Environment, (patch: Partial<Environment>) => void];
export function useDialogs(): { confirm(message: string): Promise<boolean>; notify(message: string): void; prompt(message: string, initial?: string): Promise<string | null> };
export function emitAppEvent(name: string, payload?: unknown): void;
export function onAppEvent(name: string, listener: (payload: unknown) => void): () => void;
```

## 作るもの

- `createAutoBlink(random?: () => number): AutoBlink`: 間隔は 2〜6秒の一様乱数（平均4秒）。1回のまばたきは、閉じる 80ms → 閉じたまま 40ms → 開く 120ms（ease-in-out）。左右は同時。tick(now) は EyeOpenL / R（0..1）を返す。
- `createBodyFollowProducer(): BodyFollowProducer`（id 'bodyFollow'、override、weight 1）: BodyAngleX = mixedSoFar.FaceAngleX × 率、BodyAngleZ = mixedSoFar.FaceAngleZ × 率。率は low 0.15、standard 0.3、high 0.45。
- スタジオに体の追従の producer を登録し、設定（studioSettings のセクション）に「体の動き 控えめ / 標準 / 大きめ」を置く。

## 作らないもの

体のバインディングの自動作成（別のカード）。

## 完了条件

- [ ] まばたきの間隔と形（乱数を固定したテスト）
- [ ] 体の追従の値と率
- [ ] スタジオで BodyAngleX・BodyAngleZ が顔に合わせて出る（計測の表示で確認）


---

# 37. 音量のリップシンク

> このカードだけで実装できるように、必要な仕様・型・約束をすべて書いている。ほかのカードや設計書を読む必要はない。「前提」に書いたものは、このカードの時点で必ずある。名前と形を変えないこと。

| 項目 | 内容 |
| --- | --- |
| フェーズ / 段階 | STEP1 / S1 部品 |
| 並行作業 | 同じ段階の 27〜41 と並行して作れる（触るフォルダは重ならない） |
| 担当の目安 | 入出力 |
| 作業場所 | packages/audio/src/、apps/desktop/src/modes/studio/lipsync/ |

## 目的

マイクの音量で口を開閉し、カメラの口とのかかわりを選べるようにする。

## 前提（このカードの時点ですでにあるもの）

スタジオの実行部に registerLayerProducer がある。プロジェクトの model.lipSync に mouthSource と strength がある。

抜粋に名前だけ出てくる型も、すべて `@app/schema` か `@app/contracts` から import できる。

### LipSync（@app/schema）

```ts
export interface LipSync {
  mouthSource: 'max' | 'micOnly' | 'cameraOnly';
  strength: 'low' | 'standard' | 'high';
  vowels: { vowel: 'closed' | 'a' | 'i' | 'u' | 'e' | 'o'; values: Record<Id, number> }[];   // STEP2で使う
}
```

### 合成の契約（@app/contracts）

```ts
export type LayerId = 'tracking' | 'bodyFollow' | 'expression' | 'animation' | 'lipSync' | 'periodic' | 'physics';
export const LAYER_ORDER: LayerId[] = ['tracking', 'bodyFollow', 'expression', 'animation', 'lipSync', 'periodic', 'physics'];
export interface Layer {
  id: LayerId;
  weight: number;                     // 0..1
  values: ParamValues;                // このレイヤーが担当するパラメータの値だけ
  blend?: Record<string, BlendOp>;    // パラメータごとの合成方法。無ければ override
}
export interface ParameterMixer { mix(parameters: Parameter[], layers: Layer[]): ParamValues }

// スタジオの1フレームの文脈。producer は LAYER_ORDER の順に呼ばれる
export interface FrameContext {
  now: number; dt: number;            // ミリ秒
  project: Project;
  mixedSoFar: ParamValues;            // それまでのレイヤーを合成した値
  flags: { lipSyncWeight: number; physicsActive: boolean };   // 前のレイヤーが後のレイヤーへ伝える値（初期値 1・true）
}
export interface LayerProducer { id: LayerId; produce(ctx: FrameContext): Layer | null }
```

### STEP1で増える契約（@app/contracts）

```ts
// TrackingFrame に足す任意の項目（無いときは undefined）
//   mouthForm?: number;  // -1..1（への字〜笑顔）
//   mouthWidth?: number; // -1..1（すぼめ〜横に開く）
//   browY?: number;      // -1..1（下げる〜上げる）

export interface AudioLevel { time: number; rmsDb: number }
export interface AudioSource {
  listDevices(): Promise<{ id: string; label: string }[]>;
  start(deviceId?: string): Promise<void>; stop(): void;
  onLevel(listener: (x: AudioLevel) => void): () => void;                                   // 10ms ごと
  onSamples(listener: (samples: Float32Array, sampleRate: number, time: number) => void): () => void;
}
export interface LipSyncProducer extends LayerProducer {   // id 'lipSync'
  configure(o: { mouthSource: 'max' | 'micOnly' | 'cameraOnly'; strength: 'low' | 'standard' | 'high'; silenceThresholdDb: number }): void;
  update(level: AudioLevel): void;
}
export interface AutoBlink { tick(now: number): { EyeOpenL: number; EyeOpenR: number } }
export interface BodyFollowProducer extends LayerProducer { setStrength(s: 'low' | 'standard' | 'high'): void }   // id 'bodyFollow'
export interface ExpressionController extends LayerProducer {   // id 'expression'
  apply(expressionId: string | null, now: number): void;        // null で解除。STEP1では1つだけ
  active(): string | null;
}
export type CalibrationStep = 'neutral' | 'eyesClosed' | 'mouthOpen';
export interface CalibrationService { capture(step: CalibrationStep, frames: TrackingFrame[]): void; result(): Environment['calibration']; reset(): void }
// TrackingLayerProducer に足すメソッド
//   setCalibration(c: Environment['calibration']): void
//   setPreset(p: 'stable' | 'standard' | 'large' | 'custom', custom?: { minCutoff: number; beta: number; gain: number; deadZone: number }): void
//   setEyeTracking(on: boolean): void   // off のときと外れたときは AutoBlink の値を使う
export interface HotkeyService { register(hotkey: Hotkey, handler: (phase: 'down' | 'up') => void): Promise<'ok' | 'conflict'>; unregisterAll(): Promise<void> }
export interface OutputSink {
  start(o: { width: number; height: number; fps: number }): Promise<void>;
  setTextures(pngs: Record<string, Uint8Array>): Promise<void>;
  submit(model: DeformedModel, view: ViewTransform, background: Background): void;
  stop(): Promise<void>;
}
// KeyGenerator に足すメソッド
//   rotate(binding: Binding, model: Model): Binding                    // 頂点・制御点をピボット中心の円弧で補間
//   surface(binding: Binding, model: Model): Binding                   // ワープの制御点を球面に沿って生成
//   ease(binding: Binding): Binding                                     // 中間キーの値をゆるやかに
//   regenerate(binding: Binding, model: Model, range?: [number, number]): Binding   // ロックされたキーを残して作り直す
// Services に足すもの: audio, lipSync, autoBlink, bodyFollow, expressions, calibration, hotkeys, spout（OutputSink）
```

### スタジオの実行部の差し込み口（apps/desktop/src/modes/studio/runtime.ts）

```ts
export function registerLayerProducer(p: LayerProducer): () => void;   // LayerProducer・FrameContext は @app/contracts
export interface StudioFrame { model: DeformedModel; view: ViewTransform; background: Background; params: ParamValues; now: number }
export function registerFrameSink(sink: (frame: StudioFrame) => void): () => void;
export function useStudioRuntime(): { running: boolean; status: 'tracking' | 'lost' | 'stopped'; lastFrame(): StudioFrame | null };
```

1フレームの処理: LAYER_ORDER の順に producer を呼び、呼ぶたびに mixedSoFar を更新する → mixer.mix → evaluator → pipeline → プレビューの renderer と、登録された sink へ渡す。

### 標準の合成ルール

| パラメータ | 表情 | アニメーション | リップシンク | 周期 |
| --- | --- | --- | --- | --- |
| 顔・体の角度 | add | override（遷移の blendMode が addToTracking なら add） | – | add |
| 目 開閉 | multiply（例: 笑顔 0.6、ウィンク 0） | override | – | – |
| 目 笑顔・頬染め | override | override | – | – |
| 眉 | add | override | – | – |
| 口 開閉 | add | override | max | – |
| 口 形・横幅 | override | override | override（音量に応じた重み） | – |

トラッキングと体の追従は担当するパラメータを override、物理演算は揺れもののパラメータを override で合成する。

### Environment（@app/schema。PCごとの設定でプロジェクトの外に保存）

```ts
export interface Environment {
  cameraDeviceId: string | null;
  mirror: boolean;
  calibration: { neutral: { yaw: number; pitch: number; roll: number }; eyeClosed: { l: number; r: number }; mouthOpenMax: number } | null;
  microphoneDeviceId: string | null;
  silenceThreshold: number;        // dBFS
  trackingPreset: 'stable' | 'standard' | 'large' | 'custom';
  output: { method: 'window' | 'spout2'; width: number; height: number; fps: number };
  uiLevel: Record<ModeId, UiLevel>;
  lastProjectDir: string | null;
}
```

### アプリの枠の差し込み口（apps/desktop/src/shell/api.ts）

```ts
export interface PanelDef { id: string; mode: ModeId; area: 'left' | 'right' | 'bottom'; title: string; order?: number; level?: 'easy' | 'detail' | 'both'; component: React.FC }
export function registerPanel(def: PanelDef): void;
export interface SectionDef { id: string; panelId: string; order?: number; level?: 'easy' | 'detail' | 'both'; component: React.FC }
export function registerPanelSection(def: SectionDef): void;      // パネルの中の <PanelSections panelId=… /> に入る
export function PanelSections(props: { panelId: string }): JSX.Element;
export function registerCenter(mode: 'studio' | 'animation', component: React.FC): void;
export function registerSetupScreen(component: React.FC): void;   // 素材が1つも無いとき中央に出す
export function registerMenuItem(item: { id: string; label: string; shortcut?: string; run(): void }): void;

export interface CanvasPointerEvent { canvasPoint: Vec2; screenPoint: Vec2; button: number; shiftKey: boolean; altKey: boolean; ctrlKey: boolean }
export interface CanvasTool {
  id: string; label: string; cursor?: string;
  onPointerDown?(e: CanvasPointerEvent): void; onPointerMove?(e: CanvasPointerEvent): void; onPointerUp?(e: CanvasPointerEvent): void;
  onKeyDown?(e: KeyboardEvent): void;
  drawOverlay?(ctx: CanvasRenderingContext2D, view: ViewTransform): void;
}
export function registerCanvasTool(tool: CanvasTool): void;        // 最初に登録したものが既定のツール
export function registerCanvasOverlay(id: string, draw: (ctx: CanvasRenderingContext2D, view: ViewTransform) => void): void;
export function useCanvas(): { view: ViewTransform; activeToolId: string; setActiveTool(id: string): void; requestRedraw(): void; lastDeformed(): DeformedModel | null; screenToCanvas(p: Vec2): Vec2 };

export function useServices(): Services;
export function useProject(): Project;
export function useDispatch(): (c: Command) => void;
export function useEditor(): [EditorState, (patch: Partial<EditorState>) => void];
export function useEnvironment(): [Environment, (patch: Partial<Environment>) => void];
export function useDialogs(): { confirm(message: string): Promise<boolean>; notify(message: string): void; prompt(message: string, initial?: string): Promise<string | null> };
export function emitAppEvent(name: string, payload?: unknown): void;
export function onAppEvent(name: string, listener: (payload: unknown) => void): () => void;
```

## 作るもの

- `createAudioSource(): AudioSource`: getUserMedia（音声）→ AudioWorklet。10ms ごとに RMS を dBFS で出す（onLevel）。生の波形も渡す（onSamples）。
- `createLipSyncProducer(): LipSyncProducer`（id 'lipSync'）:
  - 音量 → 開き: silenceThreshold 以下は 0。そこから +30dB で 1 になる線形の写像に、強さの倍率（low 0.7、standard 1.0、high 1.3）を掛けて 0..1 に丸める。立ち上がり 30ms・戻り 120ms でならす。
  - 出力: MouthOpen。blend は mouthSource が 'max' なら max、'micOnly' なら override、'cameraOnly' なら weight 0。
  - weight には ctx.flags.lipSyncWeight を掛ける（アニメーションが止めるときに使う）。
- 画面（studioSettings のセクション）: マイクの選択、無音とみなす音量（スライダーと今の音量の表示）、「口の動き 控えめ / 標準 / 大きめ」、カメラの口との関係（大きい方 / マイクのみ / カメラのみ）。マイクとしきい値は Environment、ほかは model.lipSync に保存する。
- スタジオに producer を登録し、AudioSource の onLevel を update に渡す。

## 作らないもの

母音（あいうえお）の判定（STEP2）。

## 完了条件

- [ ] 合成した音声のバッファで、しきい値・写像・ならしのテスト
- [ ] 3つの mouthSource で合成の結果が正しい（ミキサーと組み合わせたテスト）
- [ ] 実機で話すと口が動き、遅延が小さい


---

# 38. 表情

> このカードだけで実装できるように、必要な仕様・型・約束をすべて書いている。ほかのカードや設計書を読む必要はない。「前提」に書いたものは、このカードの時点で必ずある。名前と形を変えないこと。

| 項目 | 内容 |
| --- | --- |
| フェーズ / 段階 | STEP1 / S1 部品 |
| 並行作業 | 同じ段階の 27〜41 と並行して作れる（触るフォルダは重ならない） |
| 担当の目安 | コア |
| 作業場所 | packages/core/src/layers/expression.ts、apps/desktop/src/modes/modeling/expressions/、apps/desktop/src/modes/studio/expressions/ |

## 目的

表情を作って登録し、スタジオでフェードしながら1つずつ切り替えられるようにする。

## 前提（このカードの時点ですでにあるもの）

スタジオの実行部に registerLayerProducer がある。モデリングのキャンバスは EditorState.editorParamValues の状態を描く。

抜粋に名前だけ出てくる型も、すべて `@app/schema` か `@app/contracts` から import できる。

### Expression（@app/schema）

```ts
export type BlendOp = 'override' | 'add' | 'multiply' | 'max';
export interface Expression {
  id: Id; name: string;
  entries: { parameterId: Id; value: number; blend: BlendOp }[];
  fadeIn: number; fadeOut: number;          // 秒
}
```

### Parameter と ParameterGroup（@app/schema）

```ts
export interface ParameterGroup { id: ParameterGroupId; name: string }
export interface Parameter {
  id: Id;                          // 標準は 'FaceAngleX' など。ユーザー定義は任意の文字列
  name: string;                    // 表示名
  groupId: ParameterGroupId;
  min: number; max: number; default: number;
  standard: boolean;
}
```

### 合成の契約（@app/contracts）

```ts
export type LayerId = 'tracking' | 'bodyFollow' | 'expression' | 'animation' | 'lipSync' | 'periodic' | 'physics';
export const LAYER_ORDER: LayerId[] = ['tracking', 'bodyFollow', 'expression', 'animation', 'lipSync', 'periodic', 'physics'];
export interface Layer {
  id: LayerId;
  weight: number;                     // 0..1
  values: ParamValues;                // このレイヤーが担当するパラメータの値だけ
  blend?: Record<string, BlendOp>;    // パラメータごとの合成方法。無ければ override
}
export interface ParameterMixer { mix(parameters: Parameter[], layers: Layer[]): ParamValues }

// スタジオの1フレームの文脈。producer は LAYER_ORDER の順に呼ばれる
export interface FrameContext {
  now: number; dt: number;            // ミリ秒
  project: Project;
  mixedSoFar: ParamValues;            // それまでのレイヤーを合成した値
  flags: { lipSyncWeight: number; physicsActive: boolean };   // 前のレイヤーが後のレイヤーへ伝える値（初期値 1・true）
}
export interface LayerProducer { id: LayerId; produce(ctx: FrameContext): Layer | null }
```

### STEP1で増える契約（@app/contracts）

```ts
// TrackingFrame に足す任意の項目（無いときは undefined）
//   mouthForm?: number;  // -1..1（への字〜笑顔）
//   mouthWidth?: number; // -1..1（すぼめ〜横に開く）
//   browY?: number;      // -1..1（下げる〜上げる）

export interface AudioLevel { time: number; rmsDb: number }
export interface AudioSource {
  listDevices(): Promise<{ id: string; label: string }[]>;
  start(deviceId?: string): Promise<void>; stop(): void;
  onLevel(listener: (x: AudioLevel) => void): () => void;                                   // 10ms ごと
  onSamples(listener: (samples: Float32Array, sampleRate: number, time: number) => void): () => void;
}
export interface LipSyncProducer extends LayerProducer {   // id 'lipSync'
  configure(o: { mouthSource: 'max' | 'micOnly' | 'cameraOnly'; strength: 'low' | 'standard' | 'high'; silenceThresholdDb: number }): void;
  update(level: AudioLevel): void;
}
export interface AutoBlink { tick(now: number): { EyeOpenL: number; EyeOpenR: number } }
export interface BodyFollowProducer extends LayerProducer { setStrength(s: 'low' | 'standard' | 'high'): void }   // id 'bodyFollow'
export interface ExpressionController extends LayerProducer {   // id 'expression'
  apply(expressionId: string | null, now: number): void;        // null で解除。STEP1では1つだけ
  active(): string | null;
}
export type CalibrationStep = 'neutral' | 'eyesClosed' | 'mouthOpen';
export interface CalibrationService { capture(step: CalibrationStep, frames: TrackingFrame[]): void; result(): Environment['calibration']; reset(): void }
// TrackingLayerProducer に足すメソッド
//   setCalibration(c: Environment['calibration']): void
//   setPreset(p: 'stable' | 'standard' | 'large' | 'custom', custom?: { minCutoff: number; beta: number; gain: number; deadZone: number }): void
//   setEyeTracking(on: boolean): void   // off のときと外れたときは AutoBlink の値を使う
export interface HotkeyService { register(hotkey: Hotkey, handler: (phase: 'down' | 'up') => void): Promise<'ok' | 'conflict'>; unregisterAll(): Promise<void> }
export interface OutputSink {
  start(o: { width: number; height: number; fps: number }): Promise<void>;
  setTextures(pngs: Record<string, Uint8Array>): Promise<void>;
  submit(model: DeformedModel, view: ViewTransform, background: Background): void;
  stop(): Promise<void>;
}
// KeyGenerator に足すメソッド
//   rotate(binding: Binding, model: Model): Binding                    // 頂点・制御点をピボット中心の円弧で補間
//   surface(binding: Binding, model: Model): Binding                   // ワープの制御点を球面に沿って生成
//   ease(binding: Binding): Binding                                     // 中間キーの値をゆるやかに
//   regenerate(binding: Binding, model: Model, range?: [number, number]): Binding   // ロックされたキーを残して作り直す
// Services に足すもの: audio, lipSync, autoBlink, bodyFollow, expressions, calibration, hotkeys, spout（OutputSink）
```

### スタジオの実行部の差し込み口（apps/desktop/src/modes/studio/runtime.ts）

```ts
export function registerLayerProducer(p: LayerProducer): () => void;   // LayerProducer・FrameContext は @app/contracts
export interface StudioFrame { model: DeformedModel; view: ViewTransform; background: Background; params: ParamValues; now: number }
export function registerFrameSink(sink: (frame: StudioFrame) => void): () => void;
export function useStudioRuntime(): { running: boolean; status: 'tracking' | 'lost' | 'stopped'; lastFrame(): StudioFrame | null };
```

1フレームの処理: LAYER_ORDER の順に producer を呼び、呼ぶたびに mixedSoFar を更新する → mixer.mix → evaluator → pipeline → プレビューの renderer と、登録された sink へ渡す。

### 標準の合成ルール

| パラメータ | 表情 | アニメーション | リップシンク | 周期 |
| --- | --- | --- | --- | --- |
| 顔・体の角度 | add | override（遷移の blendMode が addToTracking なら add） | – | add |
| 目 開閉 | multiply（例: 笑顔 0.6、ウィンク 0） | override | – | – |
| 目 笑顔・頬染め | override | override | – | – |
| 眉 | add | override | – | – |
| 口 開閉 | add | override | max | – |
| 口 形・横幅 | override | override | override（音量に応じた重み） | – |

トラッキングと体の追従は担当するパラメータを override、物理演算は揺れもののパラメータを override で合成する。

### アプリの枠の差し込み口（apps/desktop/src/shell/api.ts）

```ts
export interface PanelDef { id: string; mode: ModeId; area: 'left' | 'right' | 'bottom'; title: string; order?: number; level?: 'easy' | 'detail' | 'both'; component: React.FC }
export function registerPanel(def: PanelDef): void;
export interface SectionDef { id: string; panelId: string; order?: number; level?: 'easy' | 'detail' | 'both'; component: React.FC }
export function registerPanelSection(def: SectionDef): void;      // パネルの中の <PanelSections panelId=… /> に入る
export function PanelSections(props: { panelId: string }): JSX.Element;
export function registerCenter(mode: 'studio' | 'animation', component: React.FC): void;
export function registerSetupScreen(component: React.FC): void;   // 素材が1つも無いとき中央に出す
export function registerMenuItem(item: { id: string; label: string; shortcut?: string; run(): void }): void;

export interface CanvasPointerEvent { canvasPoint: Vec2; screenPoint: Vec2; button: number; shiftKey: boolean; altKey: boolean; ctrlKey: boolean }
export interface CanvasTool {
  id: string; label: string; cursor?: string;
  onPointerDown?(e: CanvasPointerEvent): void; onPointerMove?(e: CanvasPointerEvent): void; onPointerUp?(e: CanvasPointerEvent): void;
  onKeyDown?(e: KeyboardEvent): void;
  drawOverlay?(ctx: CanvasRenderingContext2D, view: ViewTransform): void;
}
export function registerCanvasTool(tool: CanvasTool): void;        // 最初に登録したものが既定のツール
export function registerCanvasOverlay(id: string, draw: (ctx: CanvasRenderingContext2D, view: ViewTransform) => void): void;
export function useCanvas(): { view: ViewTransform; activeToolId: string; setActiveTool(id: string): void; requestRedraw(): void; lastDeformed(): DeformedModel | null; screenToCanvas(p: Vec2): Vec2 };

export function useServices(): Services;
export function useProject(): Project;
export function useDispatch(): (c: Command) => void;
export function useEditor(): [EditorState, (patch: Partial<EditorState>) => void];
export function useEnvironment(): [Environment, (patch: Partial<Environment>) => void];
export function useDialogs(): { confirm(message: string): Promise<boolean>; notify(message: string): void; prompt(message: string, initial?: string): Promise<string | null> };
export function emitAppEvent(name: string, payload?: unknown): void;
export function onAppEvent(name: string, listener: (payload: unknown) => void): () => void;
```

### ストアの契約（@app/contracts）

```ts
export interface Command { label: string; apply(project: Project): Project }   // 純粋関数
export interface ProjectStore {
  get(): Project;
  subscribe(listener: (project: Project) => void): () => void;
  dispatch(command: Command): void;                                          // 1回の Undo 単位
  transaction(label: string, run: (dispatch: (c: Command) => void) => void): void;   // まとめて1回の Undo
  undo(): void; redo(): void; canUndo(): boolean; canRedo(): boolean;
  load(project: Project): void;                                              // 履歴を消して置き換える
}
export interface EditorState {
  mode: ModeId;
  uiLevel: Record<ModeId, UiLevel>;
  selectedPartIds: string[];
  activeParameterIds: string[];        // 編集中のパラメータ（0〜2個）
  editorParamValues: ParamValues;      // モデリング中のプレビュー値（無いパラメータはデフォルト値）
}
export interface EditorStore { get(): EditorState; set(patch: Partial<EditorState>): void; subscribe(l: (s: EditorState) => void): () => void }
```

## 作るもの

- `createExpressionController(): ExpressionController`（id 'expression'）: apply で切り替える。前の表情は fadeOut、新しい表情は fadeIn の秒数で重みを変える（ease-in-out）。フェード中は2つのレイヤーを返してよいよう、内部で前後の値を重みで混ぜた1つのレイヤーにまとめる（パラメータごとの blend は新しい表情のものを使い、前の表情だけにある項目は前の blend で重みを下げる）。
- 作成（モデリングの「表情」パネル）: [新しい表情] → パラメータを動かして状態を作る（editorParamValues）→ 名前を付けて登録。項目の合成方法は上の「標準の合成ルール」で自動的に決める。詳細モードでは、グループごとに「トラッキングに重ねる（ルールどおり）/ 固定する（override）」の2択だけを選べる。標準の表情（通常・笑顔・怒り・悲しみ・驚き・照れ・ウィンク）のひな形を用意する（値は空。ユーザーが作る）。fadeIn・fadeOut の初期値は 0.2秒。
- 適用（スタジオの bottom のパネル）: 表情のカード。押すと apply、もう一度押すと解除。詳細モードでフェードの秒数を変えられる。シーンの切り替えでは、そのシーンの expressionIds の先頭を適用する。
- スタジオに producer を登録する。

## 作らないもの

複数の表情の同時適用（STEP2）。

## 完了条件

- [ ] フェード中の値（0・半分・終わりの時点）のテスト
- [ ] 2択の合成方法が、ルールどおりの blend になる
- [ ] 作成・編集・削除と Undo
- [ ] スタジオでカードを押すと切り替わる


---

# 39. シーンと背景プリセット

> このカードだけで実装できるように、必要な仕様・型・約束をすべて書いている。ほかのカードや設計書を読む必要はない。「前提」に書いたものは、このカードの時点で必ずある。名前と形を変えないこと。

| 項目 | 内容 |
| --- | --- |
| フェーズ / 段階 | STEP1 / S1 部品 |
| 並行作業 | 同じ段階の 27〜41 と並行して作れる（触るフォルダは重ならない） |
| 担当の目安 | 画面 |
| 作業場所 | apps/desktop/src/modes/studio/scenes/ |

## 目的

背景・モデルの配置・表情の組み合わせをシーンとして切り替えられるようにする。

## 前提（このカードの時点ですでにあるもの）

スタジオの実行部は activeSceneId のシーン（無ければ先頭）の背景と modelTransform を使う。

抜粋に名前だけ出てくる型も、すべて `@app/schema` か `@app/contracts` から import できる。

### Scene と Hotkey（@app/schema）

```ts
export interface Scene {
  id: Id; name: string;
  background: { type: 'transparent' } | { type: 'color'; color: string } | { type: 'image'; path: string };   // path はプロジェクトからの相対パス
  modelTransform: { position: Vec2; scale: number };   // 出力画面での位置（px）と倍率
  expressionIds: Id[];             // シーンに切り替えたときに適用する表情
  periodicAnimationIds: Id[];      // STEP2で使う
}
export interface Hotkey {
  id: Id;
  keys: string;                    // 例: 'Ctrl+Shift+1'
  action: 'expression' | 'scene' | 'background' | 'animation' | 'parameter' | 'pauseTracking' | 'recalibrate';
  targetId: Id | null;
  mode: 'toggle' | 'hold';
}
```

### アプリの枠の差し込み口（apps/desktop/src/shell/api.ts）

```ts
export interface PanelDef { id: string; mode: ModeId; area: 'left' | 'right' | 'bottom'; title: string; order?: number; level?: 'easy' | 'detail' | 'both'; component: React.FC }
export function registerPanel(def: PanelDef): void;
export interface SectionDef { id: string; panelId: string; order?: number; level?: 'easy' | 'detail' | 'both'; component: React.FC }
export function registerPanelSection(def: SectionDef): void;      // パネルの中の <PanelSections panelId=… /> に入る
export function PanelSections(props: { panelId: string }): JSX.Element;
export function registerCenter(mode: 'studio' | 'animation', component: React.FC): void;
export function registerSetupScreen(component: React.FC): void;   // 素材が1つも無いとき中央に出す
export function registerMenuItem(item: { id: string; label: string; shortcut?: string; run(): void }): void;

export interface CanvasPointerEvent { canvasPoint: Vec2; screenPoint: Vec2; button: number; shiftKey: boolean; altKey: boolean; ctrlKey: boolean }
export interface CanvasTool {
  id: string; label: string; cursor?: string;
  onPointerDown?(e: CanvasPointerEvent): void; onPointerMove?(e: CanvasPointerEvent): void; onPointerUp?(e: CanvasPointerEvent): void;
  onKeyDown?(e: KeyboardEvent): void;
  drawOverlay?(ctx: CanvasRenderingContext2D, view: ViewTransform): void;
}
export function registerCanvasTool(tool: CanvasTool): void;        // 最初に登録したものが既定のツール
export function registerCanvasOverlay(id: string, draw: (ctx: CanvasRenderingContext2D, view: ViewTransform) => void): void;
export function useCanvas(): { view: ViewTransform; activeToolId: string; setActiveTool(id: string): void; requestRedraw(): void; lastDeformed(): DeformedModel | null; screenToCanvas(p: Vec2): Vec2 };

export function useServices(): Services;
export function useProject(): Project;
export function useDispatch(): (c: Command) => void;
export function useEditor(): [EditorState, (patch: Partial<EditorState>) => void];
export function useEnvironment(): [Environment, (patch: Partial<Environment>) => void];
export function useDialogs(): { confirm(message: string): Promise<boolean>; notify(message: string): void; prompt(message: string, initial?: string): Promise<string | null> };
export function emitAppEvent(name: string, payload?: unknown): void;
export function onAppEvent(name: string, listener: (payload: unknown) => void): () => void;
```

### ストアの契約（@app/contracts）

```ts
export interface Command { label: string; apply(project: Project): Project }   // 純粋関数
export interface ProjectStore {
  get(): Project;
  subscribe(listener: (project: Project) => void): () => void;
  dispatch(command: Command): void;                                          // 1回の Undo 単位
  transaction(label: string, run: (dispatch: (c: Command) => void) => void): void;   // まとめて1回の Undo
  undo(): void; redo(): void; canUndo(): boolean; canRedo(): boolean;
  load(project: Project): void;                                              // 履歴を消して置き換える
}
export interface EditorState {
  mode: ModeId;
  uiLevel: Record<ModeId, UiLevel>;
  selectedPartIds: string[];
  activeParameterIds: string[];        // 編集中のパラメータ（0〜2個）
  editorParamValues: ParamValues;      // モデリング中のプレビュー値（無いパラメータはデフォルト値）
}
export interface EditorStore { get(): EditorState; set(patch: Partial<EditorState>): void; subscribe(l: (s: EditorState) => void): () => void }
```

## 作るもの

- シーンの一覧（スタジオの left のパネル）: 追加・名前の変更・複製・削除・並べ替え。押すと activeSceneId を変える（コマンド）。パネルの中に `<PanelSections panelId="scene" />` を置く。
- 選んだシーンの編集: 背景、適用する表情（expressionIds）、モデルの配置（プレビューでの操作がそのシーンに入る）。
- 背景プリセット: 透明・緑・青・白・黒と、ユーザーが足した画像（`backgrounds/` に写す）。
- シーンを切り替えたら、アプリイベント 'sceneChanged'（値はシーンの id）を出す。

## 作らないもの

周期アニメーションの切り替え（STEP2）。

## 完了条件

- [ ] シーンの追加・切り替え・削除と Undo
- [ ] 背景と配置がシーンごとに保たれる
- [ ] sceneChanged が出る


---

# 40. グローバルホットキー

> このカードだけで実装できるように、必要な仕様・型・約束をすべて書いている。ほかのカードや設計書を読む必要はない。「前提」に書いたものは、このカードの時点で必ずある。名前と形を変えないこと。

| 項目 | 内容 |
| --- | --- |
| フェーズ / 段階 | STEP1 / S1 部品 |
| 並行作業 | 同じ段階の 27〜41 と並行して作れる（触るフォルダは重ならない） |
| 担当の目安 | 入出力 |
| 作業場所 | apps/desktop/src/hotkeys/ |

## 目的

アプリが裏にあっても、表情・シーンなどをキーで操作できるようにする。

## 前提（このカードの時点ですでにあるもの）

Tauri の global-shortcut プラグインが入っている。services.expressions（ExpressionController）がある。シーンは activeSceneId で切り替わる。スタジオの実行部に registerLayerProducer がある。

抜粋に名前だけ出てくる型も、すべて `@app/schema` か `@app/contracts` から import できる。

### Scene と Hotkey（@app/schema）

```ts
export interface Scene {
  id: Id; name: string;
  background: { type: 'transparent' } | { type: 'color'; color: string } | { type: 'image'; path: string };   // path はプロジェクトからの相対パス
  modelTransform: { position: Vec2; scale: number };   // 出力画面での位置（px）と倍率
  expressionIds: Id[];             // シーンに切り替えたときに適用する表情
  periodicAnimationIds: Id[];      // STEP2で使う
}
export interface Hotkey {
  id: Id;
  keys: string;                    // 例: 'Ctrl+Shift+1'
  action: 'expression' | 'scene' | 'background' | 'animation' | 'parameter' | 'pauseTracking' | 'recalibrate';
  targetId: Id | null;
  mode: 'toggle' | 'hold';
}
```

### STEP1で増える契約（@app/contracts）

```ts
// TrackingFrame に足す任意の項目（無いときは undefined）
//   mouthForm?: number;  // -1..1（への字〜笑顔）
//   mouthWidth?: number; // -1..1（すぼめ〜横に開く）
//   browY?: number;      // -1..1（下げる〜上げる）

export interface AudioLevel { time: number; rmsDb: number }
export interface AudioSource {
  listDevices(): Promise<{ id: string; label: string }[]>;
  start(deviceId?: string): Promise<void>; stop(): void;
  onLevel(listener: (x: AudioLevel) => void): () => void;                                   // 10ms ごと
  onSamples(listener: (samples: Float32Array, sampleRate: number, time: number) => void): () => void;
}
export interface LipSyncProducer extends LayerProducer {   // id 'lipSync'
  configure(o: { mouthSource: 'max' | 'micOnly' | 'cameraOnly'; strength: 'low' | 'standard' | 'high'; silenceThresholdDb: number }): void;
  update(level: AudioLevel): void;
}
export interface AutoBlink { tick(now: number): { EyeOpenL: number; EyeOpenR: number } }
export interface BodyFollowProducer extends LayerProducer { setStrength(s: 'low' | 'standard' | 'high'): void }   // id 'bodyFollow'
export interface ExpressionController extends LayerProducer {   // id 'expression'
  apply(expressionId: string | null, now: number): void;        // null で解除。STEP1では1つだけ
  active(): string | null;
}
export type CalibrationStep = 'neutral' | 'eyesClosed' | 'mouthOpen';
export interface CalibrationService { capture(step: CalibrationStep, frames: TrackingFrame[]): void; result(): Environment['calibration']; reset(): void }
// TrackingLayerProducer に足すメソッド
//   setCalibration(c: Environment['calibration']): void
//   setPreset(p: 'stable' | 'standard' | 'large' | 'custom', custom?: { minCutoff: number; beta: number; gain: number; deadZone: number }): void
//   setEyeTracking(on: boolean): void   // off のときと外れたときは AutoBlink の値を使う
export interface HotkeyService { register(hotkey: Hotkey, handler: (phase: 'down' | 'up') => void): Promise<'ok' | 'conflict'>; unregisterAll(): Promise<void> }
export interface OutputSink {
  start(o: { width: number; height: number; fps: number }): Promise<void>;
  setTextures(pngs: Record<string, Uint8Array>): Promise<void>;
  submit(model: DeformedModel, view: ViewTransform, background: Background): void;
  stop(): Promise<void>;
}
// KeyGenerator に足すメソッド
//   rotate(binding: Binding, model: Model): Binding                    // 頂点・制御点をピボット中心の円弧で補間
//   surface(binding: Binding, model: Model): Binding                   // ワープの制御点を球面に沿って生成
//   ease(binding: Binding): Binding                                     // 中間キーの値をゆるやかに
//   regenerate(binding: Binding, model: Model, range?: [number, number]): Binding   // ロックされたキーを残して作り直す
// Services に足すもの: audio, lipSync, autoBlink, bodyFollow, expressions, calibration, hotkeys, spout（OutputSink）
```

### 合成の契約（@app/contracts）

```ts
export type LayerId = 'tracking' | 'bodyFollow' | 'expression' | 'animation' | 'lipSync' | 'periodic' | 'physics';
export const LAYER_ORDER: LayerId[] = ['tracking', 'bodyFollow', 'expression', 'animation', 'lipSync', 'periodic', 'physics'];
export interface Layer {
  id: LayerId;
  weight: number;                     // 0..1
  values: ParamValues;                // このレイヤーが担当するパラメータの値だけ
  blend?: Record<string, BlendOp>;    // パラメータごとの合成方法。無ければ override
}
export interface ParameterMixer { mix(parameters: Parameter[], layers: Layer[]): ParamValues }

// スタジオの1フレームの文脈。producer は LAYER_ORDER の順に呼ばれる
export interface FrameContext {
  now: number; dt: number;            // ミリ秒
  project: Project;
  mixedSoFar: ParamValues;            // それまでのレイヤーを合成した値
  flags: { lipSyncWeight: number; physicsActive: boolean };   // 前のレイヤーが後のレイヤーへ伝える値（初期値 1・true）
}
export interface LayerProducer { id: LayerId; produce(ctx: FrameContext): Layer | null }
```

### スタジオの実行部の差し込み口（apps/desktop/src/modes/studio/runtime.ts）

```ts
export function registerLayerProducer(p: LayerProducer): () => void;   // LayerProducer・FrameContext は @app/contracts
export interface StudioFrame { model: DeformedModel; view: ViewTransform; background: Background; params: ParamValues; now: number }
export function registerFrameSink(sink: (frame: StudioFrame) => void): () => void;
export function useStudioRuntime(): { running: boolean; status: 'tracking' | 'lost' | 'stopped'; lastFrame(): StudioFrame | null };
```

1フレームの処理: LAYER_ORDER の順に producer を呼び、呼ぶたびに mixedSoFar を更新する → mixer.mix → evaluator → pipeline → プレビューの renderer と、登録された sink へ渡す。

### アプリの枠の差し込み口（apps/desktop/src/shell/api.ts）

```ts
export interface PanelDef { id: string; mode: ModeId; area: 'left' | 'right' | 'bottom'; title: string; order?: number; level?: 'easy' | 'detail' | 'both'; component: React.FC }
export function registerPanel(def: PanelDef): void;
export interface SectionDef { id: string; panelId: string; order?: number; level?: 'easy' | 'detail' | 'both'; component: React.FC }
export function registerPanelSection(def: SectionDef): void;      // パネルの中の <PanelSections panelId=… /> に入る
export function PanelSections(props: { panelId: string }): JSX.Element;
export function registerCenter(mode: 'studio' | 'animation', component: React.FC): void;
export function registerSetupScreen(component: React.FC): void;   // 素材が1つも無いとき中央に出す
export function registerMenuItem(item: { id: string; label: string; shortcut?: string; run(): void }): void;

export interface CanvasPointerEvent { canvasPoint: Vec2; screenPoint: Vec2; button: number; shiftKey: boolean; altKey: boolean; ctrlKey: boolean }
export interface CanvasTool {
  id: string; label: string; cursor?: string;
  onPointerDown?(e: CanvasPointerEvent): void; onPointerMove?(e: CanvasPointerEvent): void; onPointerUp?(e: CanvasPointerEvent): void;
  onKeyDown?(e: KeyboardEvent): void;
  drawOverlay?(ctx: CanvasRenderingContext2D, view: ViewTransform): void;
}
export function registerCanvasTool(tool: CanvasTool): void;        // 最初に登録したものが既定のツール
export function registerCanvasOverlay(id: string, draw: (ctx: CanvasRenderingContext2D, view: ViewTransform) => void): void;
export function useCanvas(): { view: ViewTransform; activeToolId: string; setActiveTool(id: string): void; requestRedraw(): void; lastDeformed(): DeformedModel | null; screenToCanvas(p: Vec2): Vec2 };

export function useServices(): Services;
export function useProject(): Project;
export function useDispatch(): (c: Command) => void;
export function useEditor(): [EditorState, (patch: Partial<EditorState>) => void];
export function useEnvironment(): [Environment, (patch: Partial<Environment>) => void];
export function useDialogs(): { confirm(message: string): Promise<boolean>; notify(message: string): void; prompt(message: string, initial?: string): Promise<string | null> };
export function emitAppEvent(name: string, payload?: unknown): void;
export function onAppEvent(name: string, listener: (payload: unknown) => void): () => void;
```

### ストアの契約（@app/contracts）

```ts
export interface Command { label: string; apply(project: Project): Project }   // 純粋関数
export interface ProjectStore {
  get(): Project;
  subscribe(listener: (project: Project) => void): () => void;
  dispatch(command: Command): void;                                          // 1回の Undo 単位
  transaction(label: string, run: (dispatch: (c: Command) => void) => void): void;   // まとめて1回の Undo
  undo(): void; redo(): void; canUndo(): boolean; canRedo(): boolean;
  load(project: Project): void;                                              // 履歴を消して置き換える
}
export interface EditorState {
  mode: ModeId;
  uiLevel: Record<ModeId, UiLevel>;
  selectedPartIds: string[];
  activeParameterIds: string[];        // 編集中のパラメータ（0〜2個）
  editorParamValues: ParamValues;      // モデリング中のプレビュー値（無いパラメータはデフォルト値）
}
export interface EditorStore { get(): EditorState; set(patch: Partial<EditorState>): void; subscribe(l: (s: EditorState) => void): () => void }
```

## 作るもの

- `createHotkeyService(): HotkeyService`: global-shortcut で登録し、押した・離したを handler へ渡す。登録に失敗したら 'conflict'。
- 割り当ての画面（studioSettings のセクション）: 一覧、[追加]（キーを押して記録 → 対象と動作を選ぶ）、削除。重なって登録できないときは「ほかのアプリと重なっています」と出す。
- 動作:
  - expression: toggle は apply / 解除、hold は押している間だけ apply。
  - scene・background: activeSceneId や背景を変えるコマンド。
  - parameter: ユーザー定義などのパラメータを、押している間（hold）か切り替え（toggle）で max にする。producer（id 'expression'、override）を登録して値を出す。
  - pauseTracking: services.tracking の停止と再開。
  - recalibrate: アプリイベント 'recalibrate' を出す。
  - animation: アプリイベント 'hotkey:animation'（targetId と phase）を出すだけにする。
- project.studio.hotkeys が変わったら登録し直す。

## 作らないもの

MIDI・Stream Deck などの外部機器。

## 完了条件

- [ ] ゲームなど別のアプリが前面でも反応する（手動で確認）
- [ ] toggle と hold の動き
- [ ] 重なったときの表示


---

# 41. Spout2出力

> このカードだけで実装できるように、必要な仕様・型・約束をすべて書いている。ほかのカードや設計書を読む必要はない。「前提」に書いたものは、このカードの時点で必ずある。名前と形を変えないこと。

| 項目 | 内容 |
| --- | --- |
| フェーズ / 段階 | STEP1 / S1 部品 |
| 並行作業 | 同じ段階の 27〜41 と並行して作れる（触るフォルダは重ならない） |
| 担当の目安 | ネイティブ |
| 作業場所 | apps/desktop/src-tauri/src/output/、apps/desktop/src/output/spout/ |

## 目的

Windows で、背景を透過したまま OBS へ映像を渡せるようにする。

## 前提（このカードの時点ですでにあるもの）

スタジオの実行部に registerFrameSink がある（毎フレームの DeformedModel・view・背景が届く）。Environment.output に方式と解像度がある。

抜粋に名前だけ出てくる型も、すべて `@app/schema` か `@app/contracts` から import できる。

### 変形の契約（@app/contracts）

```ts
export interface DrawItem {
  partId: string; assetId: string;
  positions: Float32Array;         // 変形後の頂点（キャンバス座標）[x0, y0, x1, y1, ...]
  uvs: Float32Array;               // [u0, v0, ...]（0..1）
  indices: Uint32Array;
  opacity: number;                 // 親まで掛けた最終値
  blendMode: BlendMode;
  mask: { sourcePartIds: string[]; inverted: boolean } | null;
}
export interface DeformedModel {
  items: DrawItem[];               // 描画順（背面 → 前面）。非表示のパーツは含めない
  byPartId: Record<string, DrawItem>;
}
export interface DeformPipeline { deform(model: Model, deltas: TargetDeltas): DeformedModel }
```

### 描画の契約（@app/contracts）

```ts
export type Background = { type: 'transparent' } | { type: 'color'; color: string } | { type: 'image'; image: ImageBitmap };
export interface ViewTransform { scale: number; offset: Vec2 }   // 画面座標（CSSピクセル）= キャンバス座標 × scale + offset
export interface Renderer {
  init(canvas: HTMLCanvasElement): void;
  setTextures(images: Record<string, ImageBitmap>): void;       // assetId → 画像
  render(model: DeformedModel, view: ViewTransform, background: Background): void;
  dispose(): void;
}
```

### STEP1で増える契約（@app/contracts）

```ts
// TrackingFrame に足す任意の項目（無いときは undefined）
//   mouthForm?: number;  // -1..1（への字〜笑顔）
//   mouthWidth?: number; // -1..1（すぼめ〜横に開く）
//   browY?: number;      // -1..1（下げる〜上げる）

export interface AudioLevel { time: number; rmsDb: number }
export interface AudioSource {
  listDevices(): Promise<{ id: string; label: string }[]>;
  start(deviceId?: string): Promise<void>; stop(): void;
  onLevel(listener: (x: AudioLevel) => void): () => void;                                   // 10ms ごと
  onSamples(listener: (samples: Float32Array, sampleRate: number, time: number) => void): () => void;
}
export interface LipSyncProducer extends LayerProducer {   // id 'lipSync'
  configure(o: { mouthSource: 'max' | 'micOnly' | 'cameraOnly'; strength: 'low' | 'standard' | 'high'; silenceThresholdDb: number }): void;
  update(level: AudioLevel): void;
}
export interface AutoBlink { tick(now: number): { EyeOpenL: number; EyeOpenR: number } }
export interface BodyFollowProducer extends LayerProducer { setStrength(s: 'low' | 'standard' | 'high'): void }   // id 'bodyFollow'
export interface ExpressionController extends LayerProducer {   // id 'expression'
  apply(expressionId: string | null, now: number): void;        // null で解除。STEP1では1つだけ
  active(): string | null;
}
export type CalibrationStep = 'neutral' | 'eyesClosed' | 'mouthOpen';
export interface CalibrationService { capture(step: CalibrationStep, frames: TrackingFrame[]): void; result(): Environment['calibration']; reset(): void }
// TrackingLayerProducer に足すメソッド
//   setCalibration(c: Environment['calibration']): void
//   setPreset(p: 'stable' | 'standard' | 'large' | 'custom', custom?: { minCutoff: number; beta: number; gain: number; deadZone: number }): void
//   setEyeTracking(on: boolean): void   // off のときと外れたときは AutoBlink の値を使う
export interface HotkeyService { register(hotkey: Hotkey, handler: (phase: 'down' | 'up') => void): Promise<'ok' | 'conflict'>; unregisterAll(): Promise<void> }
export interface OutputSink {
  start(o: { width: number; height: number; fps: number }): Promise<void>;
  setTextures(pngs: Record<string, Uint8Array>): Promise<void>;
  submit(model: DeformedModel, view: ViewTransform, background: Background): void;
  stop(): Promise<void>;
}
// KeyGenerator に足すメソッド
//   rotate(binding: Binding, model: Model): Binding                    // 頂点・制御点をピボット中心の円弧で補間
//   surface(binding: Binding, model: Model): Binding                   // ワープの制御点を球面に沿って生成
//   ease(binding: Binding): Binding                                     // 中間キーの値をゆるやかに
//   regenerate(binding: Binding, model: Model, range?: [number, number]): Binding   // ロックされたキーを残して作り直す
// Services に足すもの: audio, lipSync, autoBlink, bodyFollow, expressions, calibration, hotkeys, spout（OutputSink）
```

### スタジオの実行部の差し込み口（apps/desktop/src/modes/studio/runtime.ts）

```ts
export function registerLayerProducer(p: LayerProducer): () => void;   // LayerProducer・FrameContext は @app/contracts
export interface StudioFrame { model: DeformedModel; view: ViewTransform; background: Background; params: ParamValues; now: number }
export function registerFrameSink(sink: (frame: StudioFrame) => void): () => void;
export function useStudioRuntime(): { running: boolean; status: 'tracking' | 'lost' | 'stopped'; lastFrame(): StudioFrame | null };
```

1フレームの処理: LAYER_ORDER の順に producer を呼び、呼ぶたびに mixedSoFar を更新する → mixer.mix → evaluator → pipeline → プレビューの renderer と、登録された sink へ渡す。

### Environment（@app/schema。PCごとの設定でプロジェクトの外に保存）

```ts
export interface Environment {
  cameraDeviceId: string | null;
  mirror: boolean;
  calibration: { neutral: { yaw: number; pitch: number; roll: number }; eyeClosed: { l: number; r: number }; mouthOpenMax: number } | null;
  microphoneDeviceId: string | null;
  silenceThreshold: number;        // dBFS
  trackingPreset: 'stable' | 'standard' | 'large' | 'custom';
  output: { method: 'window' | 'spout2'; width: number; height: number; fps: number };
  uiLevel: Record<ModeId, UiLevel>;
  lastProjectDir: string | null;
}
```

### アプリの枠の差し込み口（apps/desktop/src/shell/api.ts）

```ts
export interface PanelDef { id: string; mode: ModeId; area: 'left' | 'right' | 'bottom'; title: string; order?: number; level?: 'easy' | 'detail' | 'both'; component: React.FC }
export function registerPanel(def: PanelDef): void;
export interface SectionDef { id: string; panelId: string; order?: number; level?: 'easy' | 'detail' | 'both'; component: React.FC }
export function registerPanelSection(def: SectionDef): void;      // パネルの中の <PanelSections panelId=… /> に入る
export function PanelSections(props: { panelId: string }): JSX.Element;
export function registerCenter(mode: 'studio' | 'animation', component: React.FC): void;
export function registerSetupScreen(component: React.FC): void;   // 素材が1つも無いとき中央に出す
export function registerMenuItem(item: { id: string; label: string; shortcut?: string; run(): void }): void;

export interface CanvasPointerEvent { canvasPoint: Vec2; screenPoint: Vec2; button: number; shiftKey: boolean; altKey: boolean; ctrlKey: boolean }
export interface CanvasTool {
  id: string; label: string; cursor?: string;
  onPointerDown?(e: CanvasPointerEvent): void; onPointerMove?(e: CanvasPointerEvent): void; onPointerUp?(e: CanvasPointerEvent): void;
  onKeyDown?(e: KeyboardEvent): void;
  drawOverlay?(ctx: CanvasRenderingContext2D, view: ViewTransform): void;
}
export function registerCanvasTool(tool: CanvasTool): void;        // 最初に登録したものが既定のツール
export function registerCanvasOverlay(id: string, draw: (ctx: CanvasRenderingContext2D, view: ViewTransform) => void): void;
export function useCanvas(): { view: ViewTransform; activeToolId: string; setActiveTool(id: string): void; requestRedraw(): void; lastDeformed(): DeformedModel | null; screenToCanvas(p: Vec2): Vec2 };

export function useServices(): Services;
export function useProject(): Project;
export function useDispatch(): (c: Command) => void;
export function useEditor(): [EditorState, (patch: Partial<EditorState>) => void];
export function useEnvironment(): [Environment, (patch: Partial<Environment>) => void];
export function useDialogs(): { confirm(message: string): Promise<boolean>; notify(message: string): void; prompt(message: string, initial?: string): Promise<string | null> };
export function emitAppEvent(name: string, payload?: unknown): void;
export function onAppEvent(name: string, listener: (payload: unknown) => void): () => void;
```

## 作るもの

- Rust 側: wgpu（D3D11）で、決めた解像度の透過のテクスチャに描き、Spout2 SDK で送る（送り手の名前は「2D Liver」）。描画の規則は WebGL のレンダラーと同じにする（乗算済みアルファ、不透明度、マスク元のアルファの和と反転、通常・乗算・スクリーン・加算）。
- テクスチャ: setTextures で PNG を1回だけ送る（素材が変わったときに送り直す）。
- 毎フレームの送信: Tauri の IPC でバイナリを送る。形式は「品目数 → 品目ごとに partId の番号・assetId の番号・頂点数・positions（f32）・uvs（f32）・indices（u32）・opacity・blendMode・マスク元の番号の配列・inverted」と view・背景。
- JS 側: `createSpoutSink(): OutputSink` と、registerFrameSink で submit する sink。Environment.output.method が 'spout2' のときだけ動かす。
- 出力の設定（studioSettings のセクション）: 方式（ウィンドウ / Spout2）、解像度、fps。OBS の設定手順（Spout2 のプラグインを入れて追加する）を説明に出す。

## 作らないもの

macOS の Syphon、ブラウザソース、仮想カメラ。

## 完了条件

- [ ] OBS（Spout2 のプラグイン）で透過のまま受け取れる
- [ ] 1920×1080・60fps で送れる（基準PC）
- [ ] プレビューとの見た目の差が小さい（ピクセルの比較で ±3 以内が 99% 以上）


---

# 42. かんたんセットアップの拡張

> このカードだけで実装できるように、必要な仕様・型・約束をすべて書いている。ほかのカードや設計書を読む必要はない。「前提」に書いたものは、このカードの時点で必ずある。名前と形を変えないこと。

| 項目 | 内容 |
| --- | --- |
| フェーズ / 段階 | STEP1 / S2 部品 |
| 並行作業 | 42 と 43 は並行して作れる |
| 担当の目安 | コア |
| 作業場所 | packages/core/src/setup/、apps/desktop/src/modes/modeling/setupTools/ |

## 目的

曲面の顔の向き・曲線のまばたき・目の笑顔・眉・口の形・体の追従・頬染めのたたき台を自動で作る。

## 前提（このカードの時点ですでにあるもの）

MVPのかんたんセットアップ（createAutoSetup。変形グループ・階層・ピボット・基本の動き）がある。STEP1で次ができている: ワープの評価と追加、`packages/core/src/generate/surface.ts` の `generateSurfaceKeys(warp, parameterId, values)`、`rotate.ts` の `generateRotateKeys(...)`、不透明度のキー、STEP1 の標準パラメータ。

抜粋に名前だけ出てくる型も、すべて `@app/schema` か `@app/contracts` から import できる。

### 座標と値の約束

- 座標はキャンバス（元のPSD・PNG）のピクセル。原点は左上、x は右、y は下が正。
- 回転は度。画面上の時計回りが正。
- L / R はキャラクター自身から見た左右。画面では L が右側に描かれる。
- FaceAngleX はキャラクターが画面の右を向くと正、FaceAngleY は上を向くと正、FaceAngleZ は時計回りが正。EyeBallX は画面の右を見ると正、EyeBallY は上を見ると正。
- 基準状態 = 素材を配置しただけの状態 = 全パラメータがデフォルト値の状態。素材は「目を開け、口を閉じた」状態で描かれている前提。
- キーは基準状態からの差分。位置・回転・頂点は加算、拡縮・不透明度は倍率（1 = 変化なし）。

### パーツの変形と計算の順序

- パーツの変形は、点 p を `p' = position + pivot + R(rotation)·(scale ⊙ (p − pivot))` に動かす。R は y が下向きの座標で `[cos −sin; sin cos]`（正の角度で時計回り）。
- 実際に使う値: `position = Part.position + Δposition`、`rotation = Part.rotation + Δrotation`、`scale = Part.scale ⊙ Δscale`、`opacity = Part.opacity × Δopacity`（Δ はキーの合成結果）。
- 取り込み直後は position (0,0)・rotation 0・scale (1,1)。メッシュの頂点と pivot はキャンバス座標。
- 画像パーツの最終頂点は内側から外側へ求める。(1) メッシュの基準頂点 + 頂点の差分 → (2) 自身のパーツの変形 → (3) 親グループのワープ（あれば）→ (4) 親グループのパーツの変形 → ルートまで (3)(4) を繰り返す。
- 不透明度は、自身から親までの値をすべて掛け合わせる。

### Part と StandardPartType（@app/schema）

```ts
export interface Part {
  id: Id;
  name: string;
  kind: 'image' | 'group';
  standardType: StandardPartType | null;   // 自由パーツは null
  assetId: Id | null;                      // image のみ
  meshId: Id | null;                       // image のみ
  parentId: Id | null;
  position: Vec2;                          // 初期値 {x: 0, y: 0}
  rotation: number;                        // 度。初期値 0
  scale: Vec2;                             // 初期値 {x: 1, y: 1}
  pivot: Vec2;                             // 回転・拡縮の中心（キャンバス座標）
  opacity: number;                         // 0..1
  blendMode: BlendMode;
  depth: number;                           // 奥行き。手前が正（-1..1 が目安）
  mask: { sourcePartIds: Id[]; inverted: boolean } | null;
  physicsId: Id | null;
  visible: boolean;
  locked: boolean;
}
export type StandardPartType =
  | 'face' | 'earL' | 'earR' | 'cheek'
  | 'eyeWhiteL' | 'irisL' | 'highlightL' | 'upperLidL' | 'lowerLidL' | 'eyeWholeL'
  | 'eyeWhiteR' | 'irisR' | 'highlightR' | 'upperLidR' | 'lowerLidR' | 'eyeWholeR'
  | 'browL' | 'browR'
  | 'upperLip' | 'lowerLip' | 'mouthInside' | 'teeth' | 'tongue' | 'mouthWhole'
  | 'frontHair' | 'sideHairL' | 'sideHairR' | 'backHair'
  | 'neck' | 'torso' | 'armL' | 'armR'
  // 変形グループ（かんたんセットアップが作る）
  | 'bodyRoot' | 'armRootL' | 'armRootR' | 'neckRoot' | 'headRoot'
  | 'faceGroup' | 'eyeGroupL' | 'eyeGroupR' | 'mouthGroup';
```

### Warp（@app/schema）

```ts
export interface Warp {
  id: Id;
  partId: Id;                      // ワープを付ける group パーツ
  columns: number; rows: number;   // 格子の分割数
  bounds: { x: number; y: number; width: number; height: number };   // キャンバス座標
  points: Vec2[];                  // (columns+1)×(rows+1) 個、行優先。基準状態の制御点
}
```

### Binding と ParameterKey（@app/schema）

```ts
export type Channel = 'transform' | 'vertices' | 'warpPoints';
export interface TransformDelta { position: Vec2; rotation: number; scale: Vec2; opacity: number }
// position・rotation は加算、scale・opacity は倍率（1 = 変化なし）
export interface Binding {
  id: Id;
  target: { type: 'part' | 'mesh' | 'warp'; id: Id };   // transform → part、vertices → mesh、warpPoints → warp
  channel: Channel;
  parameterIds: Id[];              // 1 または 2
  keyValues: number[][];           // パラメータごとのキー位置（昇順。デフォルト値を必ず含む）
  keys: ParameterKey[];
  generation: 'linear' | 'depth' | 'rotate' | 'surface' | 'ease';
  divisions: number | null;        // 中間キーの分割数（自動なら null）
}
export interface ParameterKey {
  coords: number[];                // parameterIds と同じ順の値
  delta: TransformDelta | Vec2[];  // transform は TransformDelta、それ以外は頂点・制御点ごとの差分
  source: 'manual' | 'auto' | 'generated' | 'combined';
  locked: boolean;
}
```

### Model と Project（@app/schema）

```ts
export interface Model {
  parts: Part[];
  meshes: Mesh[];
  warps: Warp[];
  drawOrder: Id[];                 // 画像パーツの id。背面 → 前面
  parameters: Parameter[];
  parameterGroups: ParameterGroup[];
  bindings: Binding[];
  lipSync: LipSync;
  setupHints: { closedLineL: Vec2[] | null; closedLineR: Vec2[] | null };   // かんたんセットアップ用（閉じた目の線。STEP1で使う）
}
export interface Project {
  schemaVersion: number;           // 現在は 1
  id: Id;
  name: string;
  assets: Asset[];
  model: Model;
  expressions: Expression[];
  animations: Animation[];
  physics: Physics[];
  trackingMappings: TrackingMapping[];   // 空なら既定のマッピング
  studio: { scenes: Scene[]; activeSceneId: Id | null; hotkeys: Hotkey[] };
}
```

### 標準パラメータ（STANDARD_PARAMETERS）

| id | 表示名 | group | min | max | default | フェーズ |
| --- | --- | --- | --- | --- | --- | --- |
| FaceAngleX | 顔 左右 | face | -30 | 30 | 0 | MVP |
| FaceAngleY | 顔 上下 | face | -30 | 30 | 0 | MVP |
| FaceAngleZ | 顔 傾き | face | -30 | 30 | 0 | MVP |
| EyeOpenL / EyeOpenR | 目 開閉 L / R | eye | 0 | 1 | 1 | MVP |
| EyeBallX / EyeBallY | 瞳 左右 / 上下 | eye | -1 | 1 | 0 | MVP |
| MouthOpen | 口 開閉 | mouth | 0 | 1 | 0 | MVP |
| EyeSmileL / EyeSmileR | 目 笑顔 L / R | eye | 0 | 1 | 0 | STEP1 |
| BrowYL / BrowYR | 眉 上下 L / R | brow | -1 | 1 | 0 | STEP1 |
| BrowFormL / BrowFormR | 眉 形 L / R（困り〜怒り） | brow | -1 | 1 | 0 | STEP1 |
| MouthForm | 口 形（への字〜笑顔） | mouth | -1 | 1 | 0 | STEP1 |
| MouthWidth | 口 横幅（すぼめ〜横に開く） | mouth | -1 | 1 | 0 | STEP1 |
| Cheek | 頬染め | cheek | 0 | 1 | 0 | STEP1 |
| BodyAngleX / BodyAngleY / BodyAngleZ | 体 左右 / 上下 / 傾き | body | -10 | 10 | 0 | STEP1 |
| Breath | 呼吸 | body | 0 | 1 | 0 | STEP2 |
| ArmL / ArmR | 腕 L / R | armL / armR | -1 | 1 | 0 | STEP2 |
| HairFront / HairSide / HairBack | 髪揺れ 前 / 横 / 後ろ | sway | -1 | 1 | 0 | STEP2 |

### 生成・セットアップの契約（@app/contracts）

```ts
export interface KeyGenerator {
  linear(binding: Binding, divisions?: number): Binding;
  depthParallax(model: Model, parameterId: 'FaceAngleX' | 'FaceAngleY'): Binding[];   // 作り直した transform バインディング
}
export interface AutoSetup { plan(project: Project): { command: Command; warnings: string[] } }
```

### アプリの枠の差し込み口（apps/desktop/src/shell/api.ts）

```ts
export interface PanelDef { id: string; mode: ModeId; area: 'left' | 'right' | 'bottom'; title: string; order?: number; level?: 'easy' | 'detail' | 'both'; component: React.FC }
export function registerPanel(def: PanelDef): void;
export interface SectionDef { id: string; panelId: string; order?: number; level?: 'easy' | 'detail' | 'both'; component: React.FC }
export function registerPanelSection(def: SectionDef): void;      // パネルの中の <PanelSections panelId=… /> に入る
export function PanelSections(props: { panelId: string }): JSX.Element;
export function registerCenter(mode: 'studio' | 'animation', component: React.FC): void;
export function registerSetupScreen(component: React.FC): void;   // 素材が1つも無いとき中央に出す
export function registerMenuItem(item: { id: string; label: string; shortcut?: string; run(): void }): void;

export interface CanvasPointerEvent { canvasPoint: Vec2; screenPoint: Vec2; button: number; shiftKey: boolean; altKey: boolean; ctrlKey: boolean }
export interface CanvasTool {
  id: string; label: string; cursor?: string;
  onPointerDown?(e: CanvasPointerEvent): void; onPointerMove?(e: CanvasPointerEvent): void; onPointerUp?(e: CanvasPointerEvent): void;
  onKeyDown?(e: KeyboardEvent): void;
  drawOverlay?(ctx: CanvasRenderingContext2D, view: ViewTransform): void;
}
export function registerCanvasTool(tool: CanvasTool): void;        // 最初に登録したものが既定のツール
export function registerCanvasOverlay(id: string, draw: (ctx: CanvasRenderingContext2D, view: ViewTransform) => void): void;
export function useCanvas(): { view: ViewTransform; activeToolId: string; setActiveTool(id: string): void; requestRedraw(): void; lastDeformed(): DeformedModel | null; screenToCanvas(p: Vec2): Vec2 };

export function useServices(): Services;
export function useProject(): Project;
export function useDispatch(): (c: Command) => void;
export function useEditor(): [EditorState, (patch: Partial<EditorState>) => void];
export function useEnvironment(): [Environment, (patch: Partial<Environment>) => void];
export function useDialogs(): { confirm(message: string): Promise<boolean>; notify(message: string): void; prompt(message: string, initial?: string): Promise<string | null> };
export function emitAppEvent(name: string, payload?: unknown): void;
export function onAppEvent(name: string, listener: (payload: unknown) => void): () => void;
```

## 作るもの

- plan に規則を足す（source 'auto'。manual と locked のキーは残す）。

| 対象 | 作るもの |
| --- | --- |
| 顔の向き（曲面） | faceGroup にワープ（4×4）が無ければ足し、FaceAngleX・Y の warpPoints キーを generateSurfaceKeys で作る（−30・0・30 と10刻み） |
| 目 開閉（曲線） | 閉じた線がある場合: 値 0 で上まぶたの頂点をその線へ、白目の上側の頂点をその線へ寄せる（vertices） |
| 目 笑顔 L / R | 値 1 で下まぶた Δposition.y = −白目の高さ × 0.25、白目 Δscale.y = 0.6（ピボットは下端） |
| 眉 上下 / 形 | 上下: 値 1 で Δposition.y = −眉の高さ × 0.8。形: 値 1（怒り）で内側を下げる回転 Δrotation = ±12（L と R で逆） |
| 口 形 | 値 1 で上唇・下唇の両端 20% の頂点を Δy = −口の幅 × 0.06、値 −1 で逆（vertices） |
| 口 横幅 | 値 1 で唇と口の中の Δscale.x = 1.2、値 −1 で 0.75 |
| 体の追従 | BodyAngleZ: bodyRoot の Δrotation = ±4（値 ±10）。BodyAngleX: bodyRoot の Δposition.x = ±胴体の幅 × 0.03 |
| 頬染め | Cheek: 値 0 で不透明度 0（opacity 0）、値 1 で差分なし |

- 閉じた線のなぞり（`setupTools/`）: キャンバスのツールで、左右の目それぞれに閉じたときの線を1本なぞり、`model.setupHints.closedLineL` / `closedLineR`（キャンバス座標の点の列）に保存する（コマンド）。

## 作らないもの

呼吸と腕（STEP2）、物理（STEP2）。

## 完了条件

- [ ] fixtures で各規則のキーの向きと値が表のとおり
- [ ] 閉じた線がある・無いの両方
- [ ] 再実行で manual と locked のキーが残る


---

# 43. PSDの再読み込み

> このカードだけで実装できるように、必要な仕様・型・約束をすべて書いている。ほかのカードや設計書を読む必要はない。「前提」に書いたものは、このカードの時点で必ずある。名前と形を変えないこと。

| 項目 | 内容 |
| --- | --- |
| フェーズ / 段階 | STEP1 / S2 部品 |
| 並行作業 | 42 と 43 は並行して作れる |
| 担当の目安 | 入出力 |
| 作業場所 | packages/io/src/import/reload.ts、apps/desktop/src/modes/modeling/assets/reload/ |

## 目的

絵を直した PSD を読み込み直し、同じレイヤーの素材をまとめて更新する。

## 前提（このカードの時点ですでにあるもの）

取り込み（createImporter）がある。メッシュの転写（`packages/core/src/mesh/transfer.ts` の transferMeshKeys）と、素材の差し替えの処理がある。素材には source.file・layerName・layerPath が記録されている。

抜粋に名前だけ出てくる型も、すべて `@app/schema` か `@app/contracts` から import できる。

### Asset（@app/schema）

```ts
export interface Asset {
  id: Id;
  path: string;                    // 例: assets/<id>.png
  hash: string;                    // png の SHA-256（16進）
  width: number; height: number;   // トリミング後のサイズ
  offset: Vec2;                    // トリミング後の左上のキャンバス座標
  canvasSize: { width: number; height: number };
  source: { kind: 'psd' | 'png'; file: string; layerName?: string; layerPath?: string[]; hidden?: boolean };
  sourceBlendMode: BlendMode;
  sourceOpacity: number;           // 0..1
}
```

### Part と StandardPartType（@app/schema）

```ts
export interface Part {
  id: Id;
  name: string;
  kind: 'image' | 'group';
  standardType: StandardPartType | null;   // 自由パーツは null
  assetId: Id | null;                      // image のみ
  meshId: Id | null;                       // image のみ
  parentId: Id | null;
  position: Vec2;                          // 初期値 {x: 0, y: 0}
  rotation: number;                        // 度。初期値 0
  scale: Vec2;                             // 初期値 {x: 1, y: 1}
  pivot: Vec2;                             // 回転・拡縮の中心（キャンバス座標）
  opacity: number;                         // 0..1
  blendMode: BlendMode;
  depth: number;                           // 奥行き。手前が正（-1..1 が目安）
  mask: { sourcePartIds: Id[]; inverted: boolean } | null;
  physicsId: Id | null;
  visible: boolean;
  locked: boolean;
}
export type StandardPartType =
  | 'face' | 'earL' | 'earR' | 'cheek'
  | 'eyeWhiteL' | 'irisL' | 'highlightL' | 'upperLidL' | 'lowerLidL' | 'eyeWholeL'
  | 'eyeWhiteR' | 'irisR' | 'highlightR' | 'upperLidR' | 'lowerLidR' | 'eyeWholeR'
  | 'browL' | 'browR'
  | 'upperLip' | 'lowerLip' | 'mouthInside' | 'teeth' | 'tongue' | 'mouthWhole'
  | 'frontHair' | 'sideHairL' | 'sideHairR' | 'backHair'
  | 'neck' | 'torso' | 'armL' | 'armR'
  // 変形グループ（かんたんセットアップが作る）
  | 'bodyRoot' | 'armRootL' | 'armRootR' | 'neckRoot' | 'headRoot'
  | 'faceGroup' | 'eyeGroupL' | 'eyeGroupR' | 'mouthGroup';
```

### 取り込み・保存の契約（@app/contracts）

```ts
export interface FileSystem {          // パスは / 区切りの絶対パス
  readText(path: string): Promise<string>; writeText(path: string, data: string): Promise<void>;
  readBinary(path: string): Promise<Uint8Array>; writeBinary(path: string, data: Uint8Array): Promise<void>;
  exists(path: string): Promise<boolean>; mkdir(path: string): Promise<void>;
  list(dir: string): Promise<string[]>; remove(path: string): Promise<void>; rename(from: string, to: string): Promise<void>;
}
export interface ImportedAsset { asset: Asset; png: Uint8Array }   // png はトリミング済み
export interface ImportWarning { kind: 'canvasMismatch' | 'noTransparency' | 'resolution' | 'needsMerge'; assetIds: string[]; layerNames: string[]; message: string }
export interface Importer { importFiles(files: { name: string; data: Uint8Array }[]): Promise<{ assets: ImportedAsset[]; warnings: ImportWarning[] }> }
export interface ProjectIO {
  save(dir: string, project: Project, assetPngs: Record<string, Uint8Array>): Promise<void>;
  load(dir: string): Promise<{ project: Project; assetPngs: Record<string, Uint8Array> }>;
}
export interface AutoSaver { start(dir: string): void; stop(): void; findRecoverable(dir: string): Promise<string | null> }
```

### 素材の置き場の契約（@app/contracts）

```ts
export interface AssetRepository {
  put(assetId: string, png: Uint8Array): Promise<void>;   // 画像も作って保持する
  getPng(assetId: string): Uint8Array | undefined;
  getImage(assetId: string): ImageBitmap | undefined;
  getImageData(assetId: string): ImageData | undefined;   // メッシュ生成などに使う
  all(): Record<string, Uint8Array>;
  subscribe(listener: () => void): () => void;
}
export function createAssetRepository(): AssetRepository;   // 本物の実装
```

### ストアの契約（@app/contracts）

```ts
export interface Command { label: string; apply(project: Project): Project }   // 純粋関数
export interface ProjectStore {
  get(): Project;
  subscribe(listener: (project: Project) => void): () => void;
  dispatch(command: Command): void;                                          // 1回の Undo 単位
  transaction(label: string, run: (dispatch: (c: Command) => void) => void): void;   // まとめて1回の Undo
  undo(): void; redo(): void; canUndo(): boolean; canRedo(): boolean;
  load(project: Project): void;                                              // 履歴を消して置き換える
}
export interface EditorState {
  mode: ModeId;
  uiLevel: Record<ModeId, UiLevel>;
  selectedPartIds: string[];
  activeParameterIds: string[];        // 編集中のパラメータ（0〜2個）
  editorParamValues: ParamValues;      // モデリング中のプレビュー値（無いパラメータはデフォルト値）
}
export interface EditorStore { get(): EditorState; set(patch: Partial<EditorState>): void; subscribe(l: (s: EditorState) => void): () => void }
```

## 作るもの

- `matchLayers(oldAssets, newAssets)`: layerPath と layerName が同じものを対応させる。名前が重なるときは、元の順番で対応させる。
- 再読み込み（素材トレイの [PSD を読み込み直す]）: 対応した素材ごとに、同じサイズなら PNG だけを差し替え、違えばメッシュを作り直して変形を転写する。新しいレイヤーはトレイに足し、無くなったレイヤーは一覧で知らせる（パーツは消さない）。
- 結果の一覧（更新・追加・見つからない）を出し、全体を1つの transaction にする。

## 作らないもの

PNG の再読み込み。

## 完了条件

- [ ] 対応づけのテスト（重なる名前を含む）
- [ ] 同じサイズ・違うサイズ・追加・削除の扱い
- [ ] 1回の Undo で戻る


---

# 44. STEP1の結合と受け入れ

> このカードだけで実装できるように、必要な仕様・型・約束をすべて書いている。ほかのカードや設計書を読む必要はない。「前提」に書いたものは、このカードの時点で必ずある。名前と形を変えないこと。

| 項目 | 内容 |
| --- | --- |
| フェーズ / 段階 | STEP1 / S3 結合 |
| 並行作業 | 直列 |
| 担当の目安 | 結合 |
| 作業場所 | apps/desktop/src/services.ts、docs/ |

## 目的

STEP1の仮実装を本物に差し替え、STEP1の完成条件をすべて確かめる。

## 前提（このカードの時点ですでにあるもの）

次の本物の実装がある。

| 提供元 | 関数 |
| --- | --- |
| @app/audio | createAudioSource、createLipSyncProducer |
| @app/core | createAutoBlink、createBodyFollowProducer、createExpressionController |
| @app/tracking | createCalibrationService |
| apps/desktop | createHotkeyService（src/hotkeys）、createSpoutSink（src/output/spout） |

抜粋に名前だけ出てくる型も、すべて `@app/schema` か `@app/contracts` から import できる。

### サービスのまとめ（@app/contracts）

```ts
export interface Services {
  store: ProjectStore; editor: EditorStore; assets: AssetRepository; fs: FileSystem;
  evaluator: BindingEvaluator; pipeline: DeformPipeline; mixer: ParameterMixer; createRenderer(): Renderer;
  meshGenerator: MeshGenerator; keyGenerator: KeyGenerator; autoSetup: AutoSetup; keyEditor: KeyEditor;
  importer: Importer; io: ProjectIO; autoSaver: AutoSaver;
  tracking: TrackingSource; trackingLayer: TrackingLayerProducer;
}
```

### STEP1で増える契約（@app/contracts）

```ts
// TrackingFrame に足す任意の項目（無いときは undefined）
//   mouthForm?: number;  // -1..1（への字〜笑顔）
//   mouthWidth?: number; // -1..1（すぼめ〜横に開く）
//   browY?: number;      // -1..1（下げる〜上げる）

export interface AudioLevel { time: number; rmsDb: number }
export interface AudioSource {
  listDevices(): Promise<{ id: string; label: string }[]>;
  start(deviceId?: string): Promise<void>; stop(): void;
  onLevel(listener: (x: AudioLevel) => void): () => void;                                   // 10ms ごと
  onSamples(listener: (samples: Float32Array, sampleRate: number, time: number) => void): () => void;
}
export interface LipSyncProducer extends LayerProducer {   // id 'lipSync'
  configure(o: { mouthSource: 'max' | 'micOnly' | 'cameraOnly'; strength: 'low' | 'standard' | 'high'; silenceThresholdDb: number }): void;
  update(level: AudioLevel): void;
}
export interface AutoBlink { tick(now: number): { EyeOpenL: number; EyeOpenR: number } }
export interface BodyFollowProducer extends LayerProducer { setStrength(s: 'low' | 'standard' | 'high'): void }   // id 'bodyFollow'
export interface ExpressionController extends LayerProducer {   // id 'expression'
  apply(expressionId: string | null, now: number): void;        // null で解除。STEP1では1つだけ
  active(): string | null;
}
export type CalibrationStep = 'neutral' | 'eyesClosed' | 'mouthOpen';
export interface CalibrationService { capture(step: CalibrationStep, frames: TrackingFrame[]): void; result(): Environment['calibration']; reset(): void }
// TrackingLayerProducer に足すメソッド
//   setCalibration(c: Environment['calibration']): void
//   setPreset(p: 'stable' | 'standard' | 'large' | 'custom', custom?: { minCutoff: number; beta: number; gain: number; deadZone: number }): void
//   setEyeTracking(on: boolean): void   // off のときと外れたときは AutoBlink の値を使う
export interface HotkeyService { register(hotkey: Hotkey, handler: (phase: 'down' | 'up') => void): Promise<'ok' | 'conflict'>; unregisterAll(): Promise<void> }
export interface OutputSink {
  start(o: { width: number; height: number; fps: number }): Promise<void>;
  setTextures(pngs: Record<string, Uint8Array>): Promise<void>;
  submit(model: DeformedModel, view: ViewTransform, background: Background): void;
  stop(): Promise<void>;
}
// KeyGenerator に足すメソッド
//   rotate(binding: Binding, model: Model): Binding                    // 頂点・制御点をピボット中心の円弧で補間
//   surface(binding: Binding, model: Model): Binding                   // ワープの制御点を球面に沿って生成
//   ease(binding: Binding): Binding                                     // 中間キーの値をゆるやかに
//   regenerate(binding: Binding, model: Model, range?: [number, number]): Binding   // ロックされたキーを残して作り直す
// Services に足すもの: audio, lipSync, autoBlink, bodyFollow, expressions, calibration, hotkeys, spout（OutputSink）
```

## 作るもの

- `services.ts` の STEP1 の項目を本物に差し替える。
- 下の完成条件を、MVP と同じ評価条件で確かめ、`docs/acceptance-step1.md` に残す。

1. かんたん/詳細の切り替え（状態はモードごとに保持）と「カスタム」表示
2. かんたんメッシュ（変形の細かさ）と、キー作成後の変形の転写
3. ワープと組み合わせキーの編集UI（詳細モード）
4. かんたんセットアップの拡張（曲面の顔の向き、曲線のまばたき、目 笑顔・眉・口の形、体の追従、斜め方向の合成）
5. 生成方式の追加（回転・曲面・なめらか）
6. 中間キーの編集
7. キーのロック
8. 選択範囲の再補間
9. 2Dパラメータ
10. パラメータによる不透明度の変化
11. 合成モード（乗算・スクリーン・加算）、PSD の合成モードの引き継ぎ、クリッピングの自動統合
12. 反転マスクと複数のマスク元
13. 標準パラメータの追加（目 笑顔、眉、口の形と横幅、頬染め、体）
14. ユーザー定義パラメータ（トラッキング・ホットキーへの割り当てを含む）
15. キャリブレーション（正面・目の閉じ・口の開き）
16. トラッキング簡易設定
17. 音量によるリップシンク（カメラの口との切り替えを含む）
18. 自動まばたき
19. 表情（作成、プリセット、1つずつの切り替え）
20. シーン
21. 背景プリセット
22. グローバルホットキー
23. 透過出力（Windows: Spout2）
24. 素材の差し替え（サイズ違いへの変形の転写）と PSD の再読み込み

## 作らないもの

STEP2の機能。

## 完了条件

- [ ] 24項目すべての確認結果が docs/acceptance-step1.md にある
- [ ] MVP の受け入れの項目が引き続き通る


---

# 45. STEP2の契約の拡張

> このカードだけで実装できるように、必要な仕様・型・約束をすべて書いている。ほかのカードや設計書を読む必要はない。「前提」に書いたものは、このカードの時点で必ずある。名前と形を変えないこと。

| 項目 | 内容 |
| --- | --- |
| フェーズ / 段階 | STEP2 / T0 契約の拡張 |
| 並行作業 | 直列 |
| 担当の目安 | 基盤 |
| 作業場所 | packages/contracts/src/、apps/desktop/src/modes/studio/runtime.ts、apps/desktop/src/services.ts |

## 目的

STEP2の部品が互いを待たずに作れるよう、増えるインターフェースと仮実装を先に用意する。

## 前提（このカードの時点ですでにあるもの）

STEP1が完成している。スタジオの実行部は producer の produce が返す1つのレイヤーを合成している。

抜粋に名前だけ出てくる型も、すべて `@app/schema` か `@app/contracts` から import できる。

### 合成の契約（@app/contracts）

```ts
export type LayerId = 'tracking' | 'bodyFollow' | 'expression' | 'animation' | 'lipSync' | 'periodic' | 'physics';
export const LAYER_ORDER: LayerId[] = ['tracking', 'bodyFollow', 'expression', 'animation', 'lipSync', 'periodic', 'physics'];
export interface Layer {
  id: LayerId;
  weight: number;                     // 0..1
  values: ParamValues;                // このレイヤーが担当するパラメータの値だけ
  blend?: Record<string, BlendOp>;    // パラメータごとの合成方法。無ければ override
}
export interface ParameterMixer { mix(parameters: Parameter[], layers: Layer[]): ParamValues }

// スタジオの1フレームの文脈。producer は LAYER_ORDER の順に呼ばれる
export interface FrameContext {
  now: number; dt: number;            // ミリ秒
  project: Project;
  mixedSoFar: ParamValues;            // それまでのレイヤーを合成した値
  flags: { lipSyncWeight: number; physicsActive: boolean };   // 前のレイヤーが後のレイヤーへ伝える値（初期値 1・true）
}
export interface LayerProducer { id: LayerId; produce(ctx: FrameContext): Layer | null }
```

### STEP1で増える契約（@app/contracts）

```ts
// TrackingFrame に足す任意の項目（無いときは undefined）
//   mouthForm?: number;  // -1..1（への字〜笑顔）
//   mouthWidth?: number; // -1..1（すぼめ〜横に開く）
//   browY?: number;      // -1..1（下げる〜上げる）

export interface AudioLevel { time: number; rmsDb: number }
export interface AudioSource {
  listDevices(): Promise<{ id: string; label: string }[]>;
  start(deviceId?: string): Promise<void>; stop(): void;
  onLevel(listener: (x: AudioLevel) => void): () => void;                                   // 10ms ごと
  onSamples(listener: (samples: Float32Array, sampleRate: number, time: number) => void): () => void;
}
export interface LipSyncProducer extends LayerProducer {   // id 'lipSync'
  configure(o: { mouthSource: 'max' | 'micOnly' | 'cameraOnly'; strength: 'low' | 'standard' | 'high'; silenceThresholdDb: number }): void;
  update(level: AudioLevel): void;
}
export interface AutoBlink { tick(now: number): { EyeOpenL: number; EyeOpenR: number } }
export interface BodyFollowProducer extends LayerProducer { setStrength(s: 'low' | 'standard' | 'high'): void }   // id 'bodyFollow'
export interface ExpressionController extends LayerProducer {   // id 'expression'
  apply(expressionId: string | null, now: number): void;        // null で解除。STEP1では1つだけ
  active(): string | null;
}
export type CalibrationStep = 'neutral' | 'eyesClosed' | 'mouthOpen';
export interface CalibrationService { capture(step: CalibrationStep, frames: TrackingFrame[]): void; result(): Environment['calibration']; reset(): void }
// TrackingLayerProducer に足すメソッド
//   setCalibration(c: Environment['calibration']): void
//   setPreset(p: 'stable' | 'standard' | 'large' | 'custom', custom?: { minCutoff: number; beta: number; gain: number; deadZone: number }): void
//   setEyeTracking(on: boolean): void   // off のときと外れたときは AutoBlink の値を使う
export interface HotkeyService { register(hotkey: Hotkey, handler: (phase: 'down' | 'up') => void): Promise<'ok' | 'conflict'>; unregisterAll(): Promise<void> }
export interface OutputSink {
  start(o: { width: number; height: number; fps: number }): Promise<void>;
  setTextures(pngs: Record<string, Uint8Array>): Promise<void>;
  submit(model: DeformedModel, view: ViewTransform, background: Background): void;
  stop(): Promise<void>;
}
// KeyGenerator に足すメソッド
//   rotate(binding: Binding, model: Model): Binding                    // 頂点・制御点をピボット中心の円弧で補間
//   surface(binding: Binding, model: Model): Binding                   // ワープの制御点を球面に沿って生成
//   ease(binding: Binding): Binding                                     // 中間キーの値をゆるやかに
//   regenerate(binding: Binding, model: Model, range?: [number, number]): Binding   // ロックされたキーを残して作り直す
// Services に足すもの: audio, lipSync, autoBlink, bodyFollow, expressions, calibration, hotkeys, spout（OutputSink）
```

### スタジオの実行部の差し込み口（apps/desktop/src/modes/studio/runtime.ts）

```ts
export function registerLayerProducer(p: LayerProducer): () => void;   // LayerProducer・FrameContext は @app/contracts
export interface StudioFrame { model: DeformedModel; view: ViewTransform; background: Background; params: ParamValues; now: number }
export function registerFrameSink(sink: (frame: StudioFrame) => void): () => void;
export function useStudioRuntime(): { running: boolean; status: 'tracking' | 'lost' | 'stopped'; lastFrame(): StudioFrame | null };
```

1フレームの処理: LAYER_ORDER の順に producer を呼び、呼ぶたびに mixedSoFar を更新する → mixer.mix → evaluator → pipeline → プレビューの renderer と、登録された sink へ渡す。

### サービスのまとめ（@app/contracts）

```ts
export interface Services {
  store: ProjectStore; editor: EditorStore; assets: AssetRepository; fs: FileSystem;
  evaluator: BindingEvaluator; pipeline: DeformPipeline; mixer: ParameterMixer; createRenderer(): Renderer;
  meshGenerator: MeshGenerator; keyGenerator: KeyGenerator; autoSetup: AutoSetup; keyEditor: KeyEditor;
  importer: Importer; io: ProjectIO; autoSaver: AutoSaver;
  tracking: TrackingSource; trackingLayer: TrackingLayerProducer;
}
```

## 作るもの

- 下の「STEP2で増える契約」を `@app/contracts` に足す。
- `LayerProducer.produce` の戻り値を `Layer | Layer[] | null` に広げ、runtime.ts を配列も受け取れるように直す（同じ id のレイヤーは配列の順に合成）。既存の producer は直さなくてよい。
- 仮実装: FakeAnimationPlayer（何も出さない）、FakePeriodic（何も出さない）、FakePhysics（何も出さない）、FakeVowels（いつも closed）。ExpressionController の仮実装に toggle・actives を足す。
- Services に animations・periodic・physics・vowels を足し、`services.ts` で仮実装を入れる。

### STEP2で増える契約（@app/contracts）

```ts
// LayerProducer.produce は複数のレイヤーを返せるようになる（同じ id は配列の順に合成）
//   produce(ctx: FrameContext): Layer | Layer[] | null
export interface AnimationPlayer extends LayerProducer {   // id 'animation'。ctx.flags を設定する
  play(animationId: string, now: number): void;
  stop(animationId: string, now: number): void;
  stopAll(now: number): void;
  playing(): string[];
}
export interface PeriodicPlayer extends LayerProducer { setActive(animationIds: string[]): void }   // id 'periodic'
export interface PhysicsEngine extends LayerProducer { reset(): void }                             // id 'physics'
export interface VowelEstimator { estimate(samples: Float32Array, sampleRate: number): { closed: number; a: number; i: number; u: number; e: number; o: number } }   // 合計 1
// ExpressionController に足すメソッド（複数の同時適用）
//   toggle(expressionId: string, now: number): void
//   actives(): string[]           // 適用した順
// Services に足すもの: animations（AnimationPlayer）, periodic, physics, vowels
```

## 作らないもの

各部品の本物（T1のカード）。

## 完了条件

- [ ] 型検査が通り、これまでのテストがすべて通ったまま
- [ ] 配列を返す producer のテスト（runtime）


---

# 46. アニメーション画面（タイムライン・登録）

> このカードだけで実装できるように、必要な仕様・型・約束をすべて書いている。ほかのカードや設計書を読む必要はない。「前提」に書いたものは、このカードの時点で必ずある。名前と形を変えないこと。

| 項目 | 内容 |
| --- | --- |
| フェーズ / 段階 | STEP2 / T1 部品 |
| 並行作業 | 同じ段階の 46〜53 と並行して作れる（触るフォルダは重ならない） |
| 担当の目安 | 画面 |
| 作業場所 | apps/desktop/src/modes/animation/ |

## 目的

パラメータを時間で動かすアニメーションを作り、名前と再生方法を付けて登録できるようにする。

## 前提（このカードの時点ですでにあるもの）

アプリの枠に registerCenter('animation') と registerPanel がある。モデリングと同じ evaluator・pipeline・renderer でプレビューを描ける。

抜粋に名前だけ出てくる型も、すべて `@app/schema` か `@app/contracts` から import できる。

### Animation（@app/schema）

```ts
export interface Animation {
  id: Id; name: string;
  duration: number;                // 秒
  speed: number; loop: boolean;
  periodic: boolean;               // 周期アニメーションか
  tracks: { parameterId: Id; keyframes: { time: number; value: number; curve: 'linear' | 'smooth' | 'step' }[] }[];
  affectedGroups: ParameterGroupId[];      // 空なら自動（トラックのあるグループ）
  restart: 'restart' | 'ignore';
  transition: {
    preset: 'auto' | 'quick' | 'natural' | 'slow' | 'custom';
    blendIn: number; blendOut: number;     // 秒
    curve: 'linear' | 'smooth';
    blendMode: 'override' | 'addToTracking';
    keepLipSync: boolean; keepPhysics: boolean; returnToTracking: boolean;
  };
}
```

### Parameter と ParameterGroup（@app/schema）

```ts
export interface ParameterGroup { id: ParameterGroupId; name: string }
export interface Parameter {
  id: Id;                          // 標準は 'FaceAngleX' など。ユーザー定義は任意の文字列
  name: string;                    // 表示名
  groupId: ParameterGroupId;
  min: number; max: number; default: number;
  standard: boolean;
}
```

### アプリの枠の差し込み口（apps/desktop/src/shell/api.ts）

```ts
export interface PanelDef { id: string; mode: ModeId; area: 'left' | 'right' | 'bottom'; title: string; order?: number; level?: 'easy' | 'detail' | 'both'; component: React.FC }
export function registerPanel(def: PanelDef): void;
export interface SectionDef { id: string; panelId: string; order?: number; level?: 'easy' | 'detail' | 'both'; component: React.FC }
export function registerPanelSection(def: SectionDef): void;      // パネルの中の <PanelSections panelId=… /> に入る
export function PanelSections(props: { panelId: string }): JSX.Element;
export function registerCenter(mode: 'studio' | 'animation', component: React.FC): void;
export function registerSetupScreen(component: React.FC): void;   // 素材が1つも無いとき中央に出す
export function registerMenuItem(item: { id: string; label: string; shortcut?: string; run(): void }): void;

export interface CanvasPointerEvent { canvasPoint: Vec2; screenPoint: Vec2; button: number; shiftKey: boolean; altKey: boolean; ctrlKey: boolean }
export interface CanvasTool {
  id: string; label: string; cursor?: string;
  onPointerDown?(e: CanvasPointerEvent): void; onPointerMove?(e: CanvasPointerEvent): void; onPointerUp?(e: CanvasPointerEvent): void;
  onKeyDown?(e: KeyboardEvent): void;
  drawOverlay?(ctx: CanvasRenderingContext2D, view: ViewTransform): void;
}
export function registerCanvasTool(tool: CanvasTool): void;        // 最初に登録したものが既定のツール
export function registerCanvasOverlay(id: string, draw: (ctx: CanvasRenderingContext2D, view: ViewTransform) => void): void;
export function useCanvas(): { view: ViewTransform; activeToolId: string; setActiveTool(id: string): void; requestRedraw(): void; lastDeformed(): DeformedModel | null; screenToCanvas(p: Vec2): Vec2 };

export function useServices(): Services;
export function useProject(): Project;
export function useDispatch(): (c: Command) => void;
export function useEditor(): [EditorState, (patch: Partial<EditorState>) => void];
export function useEnvironment(): [Environment, (patch: Partial<Environment>) => void];
export function useDialogs(): { confirm(message: string): Promise<boolean>; notify(message: string): void; prompt(message: string, initial?: string): Promise<string | null> };
export function emitAppEvent(name: string, payload?: unknown): void;
export function onAppEvent(name: string, listener: (payload: unknown) => void): () => void;
```

### サービスのまとめ（@app/contracts）

```ts
export interface Services {
  store: ProjectStore; editor: EditorStore; assets: AssetRepository; fs: FileSystem;
  evaluator: BindingEvaluator; pipeline: DeformPipeline; mixer: ParameterMixer; createRenderer(): Renderer;
  meshGenerator: MeshGenerator; keyGenerator: KeyGenerator; autoSetup: AutoSetup; keyEditor: KeyEditor;
  importer: Importer; io: ProjectIO; autoSaver: AutoSaver;
  tracking: TrackingSource; trackingLayer: TrackingLayerProducer;
}
```

### ストアの契約（@app/contracts）

```ts
export interface Command { label: string; apply(project: Project): Project }   // 純粋関数
export interface ProjectStore {
  get(): Project;
  subscribe(listener: (project: Project) => void): () => void;
  dispatch(command: Command): void;                                          // 1回の Undo 単位
  transaction(label: string, run: (dispatch: (c: Command) => void) => void): void;   // まとめて1回の Undo
  undo(): void; redo(): void; canUndo(): boolean; canRedo(): boolean;
  load(project: Project): void;                                              // 履歴を消して置き換える
}
export interface EditorState {
  mode: ModeId;
  uiLevel: Record<ModeId, UiLevel>;
  selectedPartIds: string[];
  activeParameterIds: string[];        // 編集中のパラメータ（0〜2個）
  editorParamValues: ParamValues;      // モデリング中のプレビュー値（無いパラメータはデフォルト値）
}
export interface EditorStore { get(): EditorState; set(patch: Partial<EditorState>): void; subscribe(l: (s: EditorState) => void): () => void }
```

## 作るもの

- アニメーションの一覧（left）: 追加・名前の変更・複製・削除。
- 中央: 上にプレビュー、下にタイムライン。パラメータの行ごとにキーフレーム（◆）。再生・停止・ループ再生、時刻のつまみ。
- キーフレームの操作: 追加（その時刻の今の値で）・移動・削除・値の変更（プレビューの横のパラメータのスライダー）。補間は 線形 / なめらか / 一定 を選ぶ。
- プレビューの値: 時刻 t でトラックを補間した値（トラックの無いパラメータはデフォルト値）。smooth は前後のキーフレームの間を smoothstep、step は前の値のまま。
- 登録の設定（right）: 再生速度、ループ、影響範囲（かんたんは自動 = トラックのあるグループ。詳細はグループごとに選ぶ）、遷移（かんたん: 自動 / すばやく / 自然 / ゆっくり と [x] トラッキングに戻る。詳細: blendIn・blendOut・カーブ・合成方法（上書き / トラッキングに加算）・リップシンクを維持・物理演算を維持）、再開始（最初から / 無視）。
- 遷移のプリセット: auto と natural は blendIn 0.35・blendOut 0.40、quick は 0.15・0.20、slow は 0.7・0.8（秒）。

## 作らないもの

スタジオでの再生（別のカード）。

## 完了条件

- [ ] キーフレームの追加・移動・削除・補間の切り替えと Undo
- [ ] プレビューの補間値のテスト（3種類の補間）
- [ ] 登録の設定が保存される


---

# 47. アニメーションの再生と遷移

> このカードだけで実装できるように、必要な仕様・型・約束をすべて書いている。ほかのカードや設計書を読む必要はない。「前提」に書いたものは、このカードの時点で必ずある。名前と形を変えないこと。

| 項目 | 内容 |
| --- | --- |
| フェーズ / 段階 | STEP2 / T1 部品 |
| 並行作業 | 同じ段階の 46〜53 と並行して作れる（触るフォルダは重ならない） |
| 担当の目安 | コア |
| 作業場所 | packages/core/src/anim/player.ts、apps/desktop/src/modes/studio/animations/ |

## 目的

現在の状態から自然に始まり、終わるとトラッキングへ戻るアニメーションの再生を作る。

## 前提（このカードの時点ですでにあるもの）

スタジオの実行部は producer を LAYER_ORDER の順に呼び、ctx.mixedSoFar と ctx.flags を渡す。ホットキーは 'hotkey:animation' のアプリイベント（targetId と phase）を出す。

抜粋に名前だけ出てくる型も、すべて `@app/schema` か `@app/contracts` から import できる。

### Animation（@app/schema）

```ts
export interface Animation {
  id: Id; name: string;
  duration: number;                // 秒
  speed: number; loop: boolean;
  periodic: boolean;               // 周期アニメーションか
  tracks: { parameterId: Id; keyframes: { time: number; value: number; curve: 'linear' | 'smooth' | 'step' }[] }[];
  affectedGroups: ParameterGroupId[];      // 空なら自動（トラックのあるグループ）
  restart: 'restart' | 'ignore';
  transition: {
    preset: 'auto' | 'quick' | 'natural' | 'slow' | 'custom';
    blendIn: number; blendOut: number;     // 秒
    curve: 'linear' | 'smooth';
    blendMode: 'override' | 'addToTracking';
    keepLipSync: boolean; keepPhysics: boolean; returnToTracking: boolean;
  };
}
```

### Parameter と ParameterGroup（@app/schema）

```ts
export interface ParameterGroup { id: ParameterGroupId; name: string }
export interface Parameter {
  id: Id;                          // 標準は 'FaceAngleX' など。ユーザー定義は任意の文字列
  name: string;                    // 表示名
  groupId: ParameterGroupId;
  min: number; max: number; default: number;
  standard: boolean;
}
```

### 合成の契約（@app/contracts）

```ts
export type LayerId = 'tracking' | 'bodyFollow' | 'expression' | 'animation' | 'lipSync' | 'periodic' | 'physics';
export const LAYER_ORDER: LayerId[] = ['tracking', 'bodyFollow', 'expression', 'animation', 'lipSync', 'periodic', 'physics'];
export interface Layer {
  id: LayerId;
  weight: number;                     // 0..1
  values: ParamValues;                // このレイヤーが担当するパラメータの値だけ
  blend?: Record<string, BlendOp>;    // パラメータごとの合成方法。無ければ override
}
export interface ParameterMixer { mix(parameters: Parameter[], layers: Layer[]): ParamValues }

// スタジオの1フレームの文脈。producer は LAYER_ORDER の順に呼ばれる
export interface FrameContext {
  now: number; dt: number;            // ミリ秒
  project: Project;
  mixedSoFar: ParamValues;            // それまでのレイヤーを合成した値
  flags: { lipSyncWeight: number; physicsActive: boolean };   // 前のレイヤーが後のレイヤーへ伝える値（初期値 1・true）
}
export interface LayerProducer { id: LayerId; produce(ctx: FrameContext): Layer | null }
```

### STEP2で増える契約（@app/contracts）

```ts
// LayerProducer.produce は複数のレイヤーを返せるようになる（同じ id は配列の順に合成）
//   produce(ctx: FrameContext): Layer | Layer[] | null
export interface AnimationPlayer extends LayerProducer {   // id 'animation'。ctx.flags を設定する
  play(animationId: string, now: number): void;
  stop(animationId: string, now: number): void;
  stopAll(now: number): void;
  playing(): string[];
}
export interface PeriodicPlayer extends LayerProducer { setActive(animationIds: string[]): void }   // id 'periodic'
export interface PhysicsEngine extends LayerProducer { reset(): void }                             // id 'physics'
export interface VowelEstimator { estimate(samples: Float32Array, sampleRate: number): { closed: number; a: number; i: number; u: number; e: number; o: number } }   // 合計 1
// ExpressionController に足すメソッド（複数の同時適用）
//   toggle(expressionId: string, now: number): void
//   actives(): string[]           // 適用した順
// Services に足すもの: animations（AnimationPlayer）, periodic, physics, vowels
```

### スタジオの実行部の差し込み口（apps/desktop/src/modes/studio/runtime.ts）

```ts
export function registerLayerProducer(p: LayerProducer): () => void;   // LayerProducer・FrameContext は @app/contracts
export interface StudioFrame { model: DeformedModel; view: ViewTransform; background: Background; params: ParamValues; now: number }
export function registerFrameSink(sink: (frame: StudioFrame) => void): () => void;
export function useStudioRuntime(): { running: boolean; status: 'tracking' | 'lost' | 'stopped'; lastFrame(): StudioFrame | null };
```

1フレームの処理: LAYER_ORDER の順に producer を呼び、呼ぶたびに mixedSoFar を更新する → mixer.mix → evaluator → pipeline → プレビューの renderer と、登録された sink へ渡す。

### 標準の合成ルール

| パラメータ | 表情 | アニメーション | リップシンク | 周期 |
| --- | --- | --- | --- | --- |
| 顔・体の角度 | add | override（遷移の blendMode が addToTracking なら add） | – | add |
| 目 開閉 | multiply（例: 笑顔 0.6、ウィンク 0） | override | – | – |
| 目 笑顔・頬染め | override | override | – | – |
| 眉 | add | override | – | – |
| 口 開閉 | add | override | max | – |
| 口 形・横幅 | override | override | override（音量に応じた重み） | – |

トラッキングと体の追従は担当するパラメータを override、物理演算は揺れもののパラメータを override で合成する。

### アプリの枠の差し込み口（apps/desktop/src/shell/api.ts）

```ts
export interface PanelDef { id: string; mode: ModeId; area: 'left' | 'right' | 'bottom'; title: string; order?: number; level?: 'easy' | 'detail' | 'both'; component: React.FC }
export function registerPanel(def: PanelDef): void;
export interface SectionDef { id: string; panelId: string; order?: number; level?: 'easy' | 'detail' | 'both'; component: React.FC }
export function registerPanelSection(def: SectionDef): void;      // パネルの中の <PanelSections panelId=… /> に入る
export function PanelSections(props: { panelId: string }): JSX.Element;
export function registerCenter(mode: 'studio' | 'animation', component: React.FC): void;
export function registerSetupScreen(component: React.FC): void;   // 素材が1つも無いとき中央に出す
export function registerMenuItem(item: { id: string; label: string; shortcut?: string; run(): void }): void;

export interface CanvasPointerEvent { canvasPoint: Vec2; screenPoint: Vec2; button: number; shiftKey: boolean; altKey: boolean; ctrlKey: boolean }
export interface CanvasTool {
  id: string; label: string; cursor?: string;
  onPointerDown?(e: CanvasPointerEvent): void; onPointerMove?(e: CanvasPointerEvent): void; onPointerUp?(e: CanvasPointerEvent): void;
  onKeyDown?(e: KeyboardEvent): void;
  drawOverlay?(ctx: CanvasRenderingContext2D, view: ViewTransform): void;
}
export function registerCanvasTool(tool: CanvasTool): void;        // 最初に登録したものが既定のツール
export function registerCanvasOverlay(id: string, draw: (ctx: CanvasRenderingContext2D, view: ViewTransform) => void): void;
export function useCanvas(): { view: ViewTransform; activeToolId: string; setActiveTool(id: string): void; requestRedraw(): void; lastDeformed(): DeformedModel | null; screenToCanvas(p: Vec2): Vec2 };

export function useServices(): Services;
export function useProject(): Project;
export function useDispatch(): (c: Command) => void;
export function useEditor(): [EditorState, (patch: Partial<EditorState>) => void];
export function useEnvironment(): [Environment, (patch: Partial<Environment>) => void];
export function useDialogs(): { confirm(message: string): Promise<boolean>; notify(message: string): void; prompt(message: string, initial?: string): Promise<string | null> };
export function emitAppEvent(name: string, payload?: unknown): void;
export function onAppEvent(name: string, listener: (payload: unknown) => void): () => void;
```

## 作るもの

- `createAnimationPlayer(): AnimationPlayer`（id 'animation'）。
- 再生中のアニメーションごとに、重み w(t) を持つ。開始は blendIn 秒で 0 → 1、終了（ループでなければ終わりの時刻、または stop）は blendOut 秒で 1 → 0。カーブは linear か smooth（smoothstep）。
- 値: トラックを時刻で補間した値（線形・なめらか・一定）。影響範囲のグループのパラメータだけを出す（affectedGroups が空ならトラックのあるグループ）。
- 合成: blend は override（遷移の blendMode が addToTracking なら、顔・体の角度は add にし、値は「トラックの値 − そのパラメータのデフォルト値」）。レイヤーの weight = w(t)。override の重みで、その時点の合成結果（mixedSoFar）から混ざるので、開始は現在の状態から、終了は最新のトラッキングへ戻る。
- 割り込み: 再生中に別のアニメーションを始めたら、古いものは blendOut で下げ、新しいものは blendIn で上げる（同時に2つのレイヤーを返す）。遷移の途中で始めても、その時点の合成結果から混ざる。
- 再開始: 再生中のものをもう一度始めたとき、restart なら最初から、ignore なら何もしない。
- returnToTracking が false なら、終わりで重みを 1 のまま最後の値を保つ。別のアニメーションの開始か stop で解除する。
- flags: keepLipSync が false の再生中は ctx.flags.lipSyncWeight を (1 − w)。keepPhysics が false の再生中は physicsActive を false。
- スタジオ: producer を登録し、bottom のパネルにアニメーションのボタンを並べる（押すと play、もう一度で stop）。'hotkey:animation' を受けて play / stop する。

## 作らないもの

周期アニメーション（別のカード）。

## 完了条件

- [ ] 開始の遷移で、現在の値から始まる（例: +18 → 0 へなめらかに）
- [ ] 終了でトラッキングの最新の値へ戻る
- [ ] 割り込み・再開始・保持（returnToTracking false）
- [ ] 影響範囲の外のパラメータに作用しない
- [ ] flags の値


---

# 48. 周期アニメーション

> このカードだけで実装できるように、必要な仕様・型・約束をすべて書いている。ほかのカードや設計書を読む必要はない。「前提」に書いたものは、このカードの時点で必ずある。名前と形を変えないこと。

| 項目 | 内容 |
| --- | --- |
| フェーズ / 段階 | STEP2 / T1 部品 |
| 並行作業 | 同じ段階の 46〜53 と並行して作れる（触るフォルダは重ならない） |
| 担当の目安 | コア |
| 作業場所 | packages/core/src/anim/periodic.ts、apps/desktop/src/modes/studio/periodic/ |

## 目的

呼吸や体の揺れなどを、ほかの動きの上に重ねて繰り返し再生する。

## 前提（このカードの時点ですでにあるもの）

スタジオの実行部と registerLayerProducer がある。シーンの一覧のパネルに `<PanelSections panelId="scene" />` があり、シーンを切り替えると 'sceneChanged' のアプリイベントが出る。

抜粋に名前だけ出てくる型も、すべて `@app/schema` か `@app/contracts` から import できる。

### Animation（@app/schema）

```ts
export interface Animation {
  id: Id; name: string;
  duration: number;                // 秒
  speed: number; loop: boolean;
  periodic: boolean;               // 周期アニメーションか
  tracks: { parameterId: Id; keyframes: { time: number; value: number; curve: 'linear' | 'smooth' | 'step' }[] }[];
  affectedGroups: ParameterGroupId[];      // 空なら自動（トラックのあるグループ）
  restart: 'restart' | 'ignore';
  transition: {
    preset: 'auto' | 'quick' | 'natural' | 'slow' | 'custom';
    blendIn: number; blendOut: number;     // 秒
    curve: 'linear' | 'smooth';
    blendMode: 'override' | 'addToTracking';
    keepLipSync: boolean; keepPhysics: boolean; returnToTracking: boolean;
  };
}
```

### Scene と Hotkey（@app/schema）

```ts
export interface Scene {
  id: Id; name: string;
  background: { type: 'transparent' } | { type: 'color'; color: string } | { type: 'image'; path: string };   // path はプロジェクトからの相対パス
  modelTransform: { position: Vec2; scale: number };   // 出力画面での位置（px）と倍率
  expressionIds: Id[];             // シーンに切り替えたときに適用する表情
  periodicAnimationIds: Id[];      // STEP2で使う
}
export interface Hotkey {
  id: Id;
  keys: string;                    // 例: 'Ctrl+Shift+1'
  action: 'expression' | 'scene' | 'background' | 'animation' | 'parameter' | 'pauseTracking' | 'recalibrate';
  targetId: Id | null;
  mode: 'toggle' | 'hold';
}
```

### 合成の契約（@app/contracts）

```ts
export type LayerId = 'tracking' | 'bodyFollow' | 'expression' | 'animation' | 'lipSync' | 'periodic' | 'physics';
export const LAYER_ORDER: LayerId[] = ['tracking', 'bodyFollow', 'expression', 'animation', 'lipSync', 'periodic', 'physics'];
export interface Layer {
  id: LayerId;
  weight: number;                     // 0..1
  values: ParamValues;                // このレイヤーが担当するパラメータの値だけ
  blend?: Record<string, BlendOp>;    // パラメータごとの合成方法。無ければ override
}
export interface ParameterMixer { mix(parameters: Parameter[], layers: Layer[]): ParamValues }

// スタジオの1フレームの文脈。producer は LAYER_ORDER の順に呼ばれる
export interface FrameContext {
  now: number; dt: number;            // ミリ秒
  project: Project;
  mixedSoFar: ParamValues;            // それまでのレイヤーを合成した値
  flags: { lipSyncWeight: number; physicsActive: boolean };   // 前のレイヤーが後のレイヤーへ伝える値（初期値 1・true）
}
export interface LayerProducer { id: LayerId; produce(ctx: FrameContext): Layer | null }
```

### STEP2で増える契約（@app/contracts）

```ts
// LayerProducer.produce は複数のレイヤーを返せるようになる（同じ id は配列の順に合成）
//   produce(ctx: FrameContext): Layer | Layer[] | null
export interface AnimationPlayer extends LayerProducer {   // id 'animation'。ctx.flags を設定する
  play(animationId: string, now: number): void;
  stop(animationId: string, now: number): void;
  stopAll(now: number): void;
  playing(): string[];
}
export interface PeriodicPlayer extends LayerProducer { setActive(animationIds: string[]): void }   // id 'periodic'
export interface PhysicsEngine extends LayerProducer { reset(): void }                             // id 'physics'
export interface VowelEstimator { estimate(samples: Float32Array, sampleRate: number): { closed: number; a: number; i: number; u: number; e: number; o: number } }   // 合計 1
// ExpressionController に足すメソッド（複数の同時適用）
//   toggle(expressionId: string, now: number): void
//   actives(): string[]           // 適用した順
// Services に足すもの: animations（AnimationPlayer）, periodic, physics, vowels
```

### スタジオの実行部の差し込み口（apps/desktop/src/modes/studio/runtime.ts）

```ts
export function registerLayerProducer(p: LayerProducer): () => void;   // LayerProducer・FrameContext は @app/contracts
export interface StudioFrame { model: DeformedModel; view: ViewTransform; background: Background; params: ParamValues; now: number }
export function registerFrameSink(sink: (frame: StudioFrame) => void): () => void;
export function useStudioRuntime(): { running: boolean; status: 'tracking' | 'lost' | 'stopped'; lastFrame(): StudioFrame | null };
```

1フレームの処理: LAYER_ORDER の順に producer を呼び、呼ぶたびに mixedSoFar を更新する → mixer.mix → evaluator → pipeline → プレビューの renderer と、登録された sink へ渡す。

### アプリの枠の差し込み口（apps/desktop/src/shell/api.ts）

```ts
export interface PanelDef { id: string; mode: ModeId; area: 'left' | 'right' | 'bottom'; title: string; order?: number; level?: 'easy' | 'detail' | 'both'; component: React.FC }
export function registerPanel(def: PanelDef): void;
export interface SectionDef { id: string; panelId: string; order?: number; level?: 'easy' | 'detail' | 'both'; component: React.FC }
export function registerPanelSection(def: SectionDef): void;      // パネルの中の <PanelSections panelId=… /> に入る
export function PanelSections(props: { panelId: string }): JSX.Element;
export function registerCenter(mode: 'studio' | 'animation', component: React.FC): void;
export function registerSetupScreen(component: React.FC): void;   // 素材が1つも無いとき中央に出す
export function registerMenuItem(item: { id: string; label: string; shortcut?: string; run(): void }): void;

export interface CanvasPointerEvent { canvasPoint: Vec2; screenPoint: Vec2; button: number; shiftKey: boolean; altKey: boolean; ctrlKey: boolean }
export interface CanvasTool {
  id: string; label: string; cursor?: string;
  onPointerDown?(e: CanvasPointerEvent): void; onPointerMove?(e: CanvasPointerEvent): void; onPointerUp?(e: CanvasPointerEvent): void;
  onKeyDown?(e: KeyboardEvent): void;
  drawOverlay?(ctx: CanvasRenderingContext2D, view: ViewTransform): void;
}
export function registerCanvasTool(tool: CanvasTool): void;        // 最初に登録したものが既定のツール
export function registerCanvasOverlay(id: string, draw: (ctx: CanvasRenderingContext2D, view: ViewTransform) => void): void;
export function useCanvas(): { view: ViewTransform; activeToolId: string; setActiveTool(id: string): void; requestRedraw(): void; lastDeformed(): DeformedModel | null; screenToCanvas(p: Vec2): Vec2 };

export function useServices(): Services;
export function useProject(): Project;
export function useDispatch(): (c: Command) => void;
export function useEditor(): [EditorState, (patch: Partial<EditorState>) => void];
export function useEnvironment(): [Environment, (patch: Partial<Environment>) => void];
export function useDialogs(): { confirm(message: string): Promise<boolean>; notify(message: string): void; prompt(message: string, initial?: string): Promise<string | null> };
export function emitAppEvent(name: string, payload?: unknown): void;
export function onAppEvent(name: string, listener: (payload: unknown) => void): () => void;
```

## 作るもの

- `createPeriodicPlayer(): PeriodicPlayer`（id 'periodic'）: periodic が true のアニメーションのうち、setActive で選ばれたものをループ再生する。値はトラックの補間値からデフォルト値を引いた差分、blend は add、weight 1。開始と停止は 0.5秒でフェードする。
- 標準の「呼吸」: プロジェクトに無ければ作る（Breath を 0 → 1 → 0、4秒で1周、なめらか）。
- スタジオ: producer を登録する。シーンのセクションに「周期アニメーション」のチェック一覧を置き、scene.periodicAnimationIds に保存する。'sceneChanged' で setActive を呼ぶ。

## 作らないもの

呼吸パラメータのバインディング（別のカード）。

## 完了条件

- [ ] 加算で重なり、アニメーションの再生中も止まらない
- [ ] フェードの開始と停止
- [ ] シーンの切り替えで対象が変わる


---

# 49. 物理演算

> このカードだけで実装できるように、必要な仕様・型・約束をすべて書いている。ほかのカードや設計書を読む必要はない。「前提」に書いたものは、このカードの時点で必ずある。名前と形を変えないこと。

| 項目 | 内容 |
| --- | --- |
| フェーズ / 段階 | STEP2 / T1 部品 |
| 並行作業 | 同じ段階の 46〜53 と並行して作れる（触るフォルダは重ならない） |
| 担当の目安 | コア |
| 作業場所 | packages/core/src/physics/ |

## 目的

頭と体の動きから、髪などの揺れを計算して揺れパラメータに出す。

## 前提（このカードの時点ですでにあるもの）

スタジオの実行部は producer を LAYER_ORDER の最後に物理を呼び、ctx.mixedSoFar（それまでの合成結果）と ctx.flags.physicsActive を渡す。

抜粋に名前だけ出てくる型も、すべて `@app/schema` か `@app/contracts` から import できる。

### Physics（@app/schema）

```ts
export interface Physics {
  id: Id; partId: Id;              // 根元の位置はこのパーツの pivot
  preset: 'hair' | 'cloth' | 'ribbon' | 'accessory';
  strength: number;                // 0..1（かんたん設定の「揺れ方」）
  direction: 'horizontal' | 'vertical' | 'both';
  length: number;                  // px
  spring: number; damping: number; gravity: number; inertia: number; range: number;
  inputs: { parameterId: Id; weight: number }[];
  outputParameterId: Id;
}
```

### Parameter と ParameterGroup（@app/schema）

```ts
export interface ParameterGroup { id: ParameterGroupId; name: string }
export interface Parameter {
  id: Id;                          // 標準は 'FaceAngleX' など。ユーザー定義は任意の文字列
  name: string;                    // 表示名
  groupId: ParameterGroupId;
  min: number; max: number; default: number;
  standard: boolean;
}
```

### 合成の契約（@app/contracts）

```ts
export type LayerId = 'tracking' | 'bodyFollow' | 'expression' | 'animation' | 'lipSync' | 'periodic' | 'physics';
export const LAYER_ORDER: LayerId[] = ['tracking', 'bodyFollow', 'expression', 'animation', 'lipSync', 'periodic', 'physics'];
export interface Layer {
  id: LayerId;
  weight: number;                     // 0..1
  values: ParamValues;                // このレイヤーが担当するパラメータの値だけ
  blend?: Record<string, BlendOp>;    // パラメータごとの合成方法。無ければ override
}
export interface ParameterMixer { mix(parameters: Parameter[], layers: Layer[]): ParamValues }

// スタジオの1フレームの文脈。producer は LAYER_ORDER の順に呼ばれる
export interface FrameContext {
  now: number; dt: number;            // ミリ秒
  project: Project;
  mixedSoFar: ParamValues;            // それまでのレイヤーを合成した値
  flags: { lipSyncWeight: number; physicsActive: boolean };   // 前のレイヤーが後のレイヤーへ伝える値（初期値 1・true）
}
export interface LayerProducer { id: LayerId; produce(ctx: FrameContext): Layer | null }
```

### STEP2で増える契約（@app/contracts）

```ts
// LayerProducer.produce は複数のレイヤーを返せるようになる（同じ id は配列の順に合成）
//   produce(ctx: FrameContext): Layer | Layer[] | null
export interface AnimationPlayer extends LayerProducer {   // id 'animation'。ctx.flags を設定する
  play(animationId: string, now: number): void;
  stop(animationId: string, now: number): void;
  stopAll(now: number): void;
  playing(): string[];
}
export interface PeriodicPlayer extends LayerProducer { setActive(animationIds: string[]): void }   // id 'periodic'
export interface PhysicsEngine extends LayerProducer { reset(): void }                             // id 'physics'
export interface VowelEstimator { estimate(samples: Float32Array, sampleRate: number): { closed: number; a: number; i: number; u: number; e: number; o: number } }   // 合計 1
// ExpressionController に足すメソッド（複数の同時適用）
//   toggle(expressionId: string, now: number): void
//   actives(): string[]           // 適用した順
// Services に足すもの: animations（AnimationPlayer）, periodic, physics, vowels
```

## 作るもの

- `createPhysicsEngine(): PhysicsEngine`（id 'physics'）。
- project.physics の項目ごとに振り子を1つ持つ。入力 x = Σ(inputs の値 × weight)。入力の変化が根元の動きになる。
- 運動: 角度 θ と角速度 ω。加速度 = −spring·θ − damping·ω − inertia·(入力の加速度) + gravity·(重力の向きの成分)。固定の 1/120 秒で積分し（フレームの時間に合わせて回数を変える。1フレームの最大は8回）、θ を ±range に丸める。
- direction: horizontal は左右だけ、vertical は上下だけ、both は2つの振り子を持ち、出力は左右を使う。
- 出力: outputParameterId に θ / range（−1..1）を、blend override、weight 1 で出す。
- strength（0..1）は spring と damping を弱めて揺れを大きくする（strength 1 で spring × 0.6、damping × 0.6）。
- ctx.flags.physicsActive が false の間は値を出さず（null）、状態は保つ。reset() で全部を止める。
- 入力が無い項目の既定: FaceAngleX 0.7、BodyAngleX 0.3（horizontal）、FaceAngleY 0.7（vertical）。

## 作らないもの

物理の設定の画面（別のカード）。

## 完了条件

- [ ] 入力を急に動かすと揺れて、ゆっくり止まる
- [ ] range で頭打ちになる
- [ ] フレームの時間が変わっても結果がほぼ同じ
- [ ] physicsActive が false の間は出さない


---

# 50. 物理のかんたんUIと揺れの自動作成

> このカードだけで実装できるように、必要な仕様・型・約束をすべて書いている。ほかのカードや設計書を読む必要はない。「前提」に書いたものは、このカードの時点で必ずある。名前と形を変えないこと。

| 項目 | 内容 |
| --- | --- |
| フェーズ / 段階 | STEP2 / T1 部品 |
| 並行作業 | 同じ段階の 46〜53 と並行して作れる（触るフォルダは重ならない） |
| 担当の目安 | 画面 |
| 作業場所 | apps/desktop/src/modes/modeling/physics/ |

## 目的

パーツの種類と揺れ方を選ぶだけで、物理の設定と揺れのバインディングを自動で作る。

## 前提（このカードの時点ですでにあるもの）

`packages/core/src/generate/rotate.ts` の `generateRotateKeys(base, pivot, a, b, ts)` がある。パーツの設定パネルに `<PanelSections panelId="partSettings" />` がある。

抜粋に名前だけ出てくる型も、すべて `@app/schema` か `@app/contracts` から import できる。

### Physics（@app/schema）

```ts
export interface Physics {
  id: Id; partId: Id;              // 根元の位置はこのパーツの pivot
  preset: 'hair' | 'cloth' | 'ribbon' | 'accessory';
  strength: number;                // 0..1（かんたん設定の「揺れ方」）
  direction: 'horizontal' | 'vertical' | 'both';
  length: number;                  // px
  spring: number; damping: number; gravity: number; inertia: number; range: number;
  inputs: { parameterId: Id; weight: number }[];
  outputParameterId: Id;
}
```

### Part と StandardPartType（@app/schema）

```ts
export interface Part {
  id: Id;
  name: string;
  kind: 'image' | 'group';
  standardType: StandardPartType | null;   // 自由パーツは null
  assetId: Id | null;                      // image のみ
  meshId: Id | null;                       // image のみ
  parentId: Id | null;
  position: Vec2;                          // 初期値 {x: 0, y: 0}
  rotation: number;                        // 度。初期値 0
  scale: Vec2;                             // 初期値 {x: 1, y: 1}
  pivot: Vec2;                             // 回転・拡縮の中心（キャンバス座標）
  opacity: number;                         // 0..1
  blendMode: BlendMode;
  depth: number;                           // 奥行き。手前が正（-1..1 が目安）
  mask: { sourcePartIds: Id[]; inverted: boolean } | null;
  physicsId: Id | null;
  visible: boolean;
  locked: boolean;
}
export type StandardPartType =
  | 'face' | 'earL' | 'earR' | 'cheek'
  | 'eyeWhiteL' | 'irisL' | 'highlightL' | 'upperLidL' | 'lowerLidL' | 'eyeWholeL'
  | 'eyeWhiteR' | 'irisR' | 'highlightR' | 'upperLidR' | 'lowerLidR' | 'eyeWholeR'
  | 'browL' | 'browR'
  | 'upperLip' | 'lowerLip' | 'mouthInside' | 'teeth' | 'tongue' | 'mouthWhole'
  | 'frontHair' | 'sideHairL' | 'sideHairR' | 'backHair'
  | 'neck' | 'torso' | 'armL' | 'armR'
  // 変形グループ（かんたんセットアップが作る）
  | 'bodyRoot' | 'armRootL' | 'armRootR' | 'neckRoot' | 'headRoot'
  | 'faceGroup' | 'eyeGroupL' | 'eyeGroupR' | 'mouthGroup';
```

### Parameter と ParameterGroup（@app/schema）

```ts
export interface ParameterGroup { id: ParameterGroupId; name: string }
export interface Parameter {
  id: Id;                          // 標準は 'FaceAngleX' など。ユーザー定義は任意の文字列
  name: string;                    // 表示名
  groupId: ParameterGroupId;
  min: number; max: number; default: number;
  standard: boolean;
}
```

### Binding と ParameterKey（@app/schema）

```ts
export type Channel = 'transform' | 'vertices' | 'warpPoints';
export interface TransformDelta { position: Vec2; rotation: number; scale: Vec2; opacity: number }
// position・rotation は加算、scale・opacity は倍率（1 = 変化なし）
export interface Binding {
  id: Id;
  target: { type: 'part' | 'mesh' | 'warp'; id: Id };   // transform → part、vertices → mesh、warpPoints → warp
  channel: Channel;
  parameterIds: Id[];              // 1 または 2
  keyValues: number[][];           // パラメータごとのキー位置（昇順。デフォルト値を必ず含む）
  keys: ParameterKey[];
  generation: 'linear' | 'depth' | 'rotate' | 'surface' | 'ease';
  divisions: number | null;        // 中間キーの分割数（自動なら null）
}
export interface ParameterKey {
  coords: number[];                // parameterIds と同じ順の値
  delta: TransformDelta | Vec2[];  // transform は TransformDelta、それ以外は頂点・制御点ごとの差分
  source: 'manual' | 'auto' | 'generated' | 'combined';
  locked: boolean;
}
```

### アプリの枠の差し込み口（apps/desktop/src/shell/api.ts）

```ts
export interface PanelDef { id: string; mode: ModeId; area: 'left' | 'right' | 'bottom'; title: string; order?: number; level?: 'easy' | 'detail' | 'both'; component: React.FC }
export function registerPanel(def: PanelDef): void;
export interface SectionDef { id: string; panelId: string; order?: number; level?: 'easy' | 'detail' | 'both'; component: React.FC }
export function registerPanelSection(def: SectionDef): void;      // パネルの中の <PanelSections panelId=… /> に入る
export function PanelSections(props: { panelId: string }): JSX.Element;
export function registerCenter(mode: 'studio' | 'animation', component: React.FC): void;
export function registerSetupScreen(component: React.FC): void;   // 素材が1つも無いとき中央に出す
export function registerMenuItem(item: { id: string; label: string; shortcut?: string; run(): void }): void;

export interface CanvasPointerEvent { canvasPoint: Vec2; screenPoint: Vec2; button: number; shiftKey: boolean; altKey: boolean; ctrlKey: boolean }
export interface CanvasTool {
  id: string; label: string; cursor?: string;
  onPointerDown?(e: CanvasPointerEvent): void; onPointerMove?(e: CanvasPointerEvent): void; onPointerUp?(e: CanvasPointerEvent): void;
  onKeyDown?(e: KeyboardEvent): void;
  drawOverlay?(ctx: CanvasRenderingContext2D, view: ViewTransform): void;
}
export function registerCanvasTool(tool: CanvasTool): void;        // 最初に登録したものが既定のツール
export function registerCanvasOverlay(id: string, draw: (ctx: CanvasRenderingContext2D, view: ViewTransform) => void): void;
export function useCanvas(): { view: ViewTransform; activeToolId: string; setActiveTool(id: string): void; requestRedraw(): void; lastDeformed(): DeformedModel | null; screenToCanvas(p: Vec2): Vec2 };

export function useServices(): Services;
export function useProject(): Project;
export function useDispatch(): (c: Command) => void;
export function useEditor(): [EditorState, (patch: Partial<EditorState>) => void];
export function useEnvironment(): [Environment, (patch: Partial<Environment>) => void];
export function useDialogs(): { confirm(message: string): Promise<boolean>; notify(message: string): void; prompt(message: string, initial?: string): Promise<string | null> };
export function emitAppEvent(name: string, payload?: unknown): void;
export function onAppEvent(name: string, listener: (payload: unknown) => void): () => void;
```

### ストアの契約（@app/contracts）

```ts
export interface Command { label: string; apply(project: Project): Project }   // 純粋関数
export interface ProjectStore {
  get(): Project;
  subscribe(listener: (project: Project) => void): () => void;
  dispatch(command: Command): void;                                          // 1回の Undo 単位
  transaction(label: string, run: (dispatch: (c: Command) => void) => void): void;   // まとめて1回の Undo
  undo(): void; redo(): void; canUndo(): boolean; canRedo(): boolean;
  load(project: Project): void;                                              // 履歴を消して置き換える
}
export interface EditorState {
  mode: ModeId;
  uiLevel: Record<ModeId, UiLevel>;
  selectedPartIds: string[];
  activeParameterIds: string[];        // 編集中のパラメータ（0〜2個）
  editorParamValues: ParamValues;      // モデリング中のプレビュー値（無いパラメータはデフォルト値）
}
export interface EditorStore { get(): EditorState; set(patch: Partial<EditorState>): void; subscribe(l: (s: EditorState) => void): () => void }
```

## 作るもの

- 物理の設定（partSettings のセクション。画像パーツかグループのとき）: [揺らす] のオン・オフ、種類（髪・布・リボン・アクセサリ）、揺れ方（控えめ〜大きめ → strength 0..1）。根元はパーツのピボット（キャンバスでドラッグして直せることを案内する）。詳細モードでは spring・damping・gravity・inertia・range・方向・入力を数値で出す。
- オンにしたとき（1つの transaction）:
  - 揺れパラメータを作る（id `Sway_<partId>`、group 'sway'、−1..1、デフォルト 0）。標準の髪の部位（前髪・横髪・後ろ髪）なら HairFront・HairSide・HairBack を使う。
  - Physics の項目を作る（プリセットは下表。length = パーツの高さ）。
  - バインディングを作る: transform（値 ±1 で Δrotation = ±12。ピボット中心）と、画像パーツなら vertices（値 ±1 で、先端ほど大きく曲がるよう generateRotateKeys で中間の形を作る。根元からの距離の割合の2乗で曲げを強くする）。source 'auto'。
- オフにしたとき: Physics の項目と、自動で作ったバインディングを消す（揺れパラメータも、ほかで使っていなければ消す）。

| 種類 | spring | damping | gravity | inertia | range |
| --- | --- | --- | --- | --- | --- |
| 髪 | 30 | 4 | 0.5 | 1.0 | 1.0 |
| 布 | 20 | 3 | 0.8 | 0.8 | 0.8 |
| リボン | 15 | 2 | 0.6 | 1.2 | 1.2 |
| アクセサリ | 40 | 5 | 1.0 | 0.6 | 0.6 |

## 作らないもの

物理の計算（別のカード）。

## 完了条件

- [ ] オンで、揺れパラメータ・Physics・バインディングがそろう
- [ ] 先端ほど大きく曲がる
- [ ] オフで自動で作ったものが消える
- [ ] Undo できる


---

# 51. 母音のリップシンク

> このカードだけで実装できるように、必要な仕様・型・約束をすべて書いている。ほかのカードや設計書を読む必要はない。「前提」に書いたものは、このカードの時点で必ずある。名前と形を変えないこと。

| 項目 | 内容 |
| --- | --- |
| フェーズ / 段階 | STEP2 / T1 部品 |
| 並行作業 | 同じ段階の 46〜53 と並行して作れる（触るフォルダは重ならない） |
| 担当の目安 | 入出力 |
| 作業場所 | packages/audio/src/vowel.ts、packages/audio/src/lipsync.ts、apps/desktop/src/modes/modeling/vowels/ |

## 目的

あいうえおの口の形を、音声から推定して口の形と横幅に反映する。

## 前提（このカードの時点ですでにあるもの）

STEP1の音量のリップシンク（createLipSyncProducer。MouthOpen を出す）と AudioSource（onSamples）がある。model.lipSync.vowels がある（空）。

抜粋に名前だけ出てくる型も、すべて `@app/schema` か `@app/contracts` から import できる。

### LipSync（@app/schema）

```ts
export interface LipSync {
  mouthSource: 'max' | 'micOnly' | 'cameraOnly';
  strength: 'low' | 'standard' | 'high';
  vowels: { vowel: 'closed' | 'a' | 'i' | 'u' | 'e' | 'o'; values: Record<Id, number> }[];   // STEP2で使う
}
```

### STEP1で増える契約（@app/contracts）

```ts
// TrackingFrame に足す任意の項目（無いときは undefined）
//   mouthForm?: number;  // -1..1（への字〜笑顔）
//   mouthWidth?: number; // -1..1（すぼめ〜横に開く）
//   browY?: number;      // -1..1（下げる〜上げる）

export interface AudioLevel { time: number; rmsDb: number }
export interface AudioSource {
  listDevices(): Promise<{ id: string; label: string }[]>;
  start(deviceId?: string): Promise<void>; stop(): void;
  onLevel(listener: (x: AudioLevel) => void): () => void;                                   // 10ms ごと
  onSamples(listener: (samples: Float32Array, sampleRate: number, time: number) => void): () => void;
}
export interface LipSyncProducer extends LayerProducer {   // id 'lipSync'
  configure(o: { mouthSource: 'max' | 'micOnly' | 'cameraOnly'; strength: 'low' | 'standard' | 'high'; silenceThresholdDb: number }): void;
  update(level: AudioLevel): void;
}
export interface AutoBlink { tick(now: number): { EyeOpenL: number; EyeOpenR: number } }
export interface BodyFollowProducer extends LayerProducer { setStrength(s: 'low' | 'standard' | 'high'): void }   // id 'bodyFollow'
export interface ExpressionController extends LayerProducer {   // id 'expression'
  apply(expressionId: string | null, now: number): void;        // null で解除。STEP1では1つだけ
  active(): string | null;
}
export type CalibrationStep = 'neutral' | 'eyesClosed' | 'mouthOpen';
export interface CalibrationService { capture(step: CalibrationStep, frames: TrackingFrame[]): void; result(): Environment['calibration']; reset(): void }
// TrackingLayerProducer に足すメソッド
//   setCalibration(c: Environment['calibration']): void
//   setPreset(p: 'stable' | 'standard' | 'large' | 'custom', custom?: { minCutoff: number; beta: number; gain: number; deadZone: number }): void
//   setEyeTracking(on: boolean): void   // off のときと外れたときは AutoBlink の値を使う
export interface HotkeyService { register(hotkey: Hotkey, handler: (phase: 'down' | 'up') => void): Promise<'ok' | 'conflict'>; unregisterAll(): Promise<void> }
export interface OutputSink {
  start(o: { width: number; height: number; fps: number }): Promise<void>;
  setTextures(pngs: Record<string, Uint8Array>): Promise<void>;
  submit(model: DeformedModel, view: ViewTransform, background: Background): void;
  stop(): Promise<void>;
}
// KeyGenerator に足すメソッド
//   rotate(binding: Binding, model: Model): Binding                    // 頂点・制御点をピボット中心の円弧で補間
//   surface(binding: Binding, model: Model): Binding                   // ワープの制御点を球面に沿って生成
//   ease(binding: Binding): Binding                                     // 中間キーの値をゆるやかに
//   regenerate(binding: Binding, model: Model, range?: [number, number]): Binding   // ロックされたキーを残して作り直す
// Services に足すもの: audio, lipSync, autoBlink, bodyFollow, expressions, calibration, hotkeys, spout（OutputSink）
```

### STEP2で増える契約（@app/contracts）

```ts
// LayerProducer.produce は複数のレイヤーを返せるようになる（同じ id は配列の順に合成）
//   produce(ctx: FrameContext): Layer | Layer[] | null
export interface AnimationPlayer extends LayerProducer {   // id 'animation'。ctx.flags を設定する
  play(animationId: string, now: number): void;
  stop(animationId: string, now: number): void;
  stopAll(now: number): void;
  playing(): string[];
}
export interface PeriodicPlayer extends LayerProducer { setActive(animationIds: string[]): void }   // id 'periodic'
export interface PhysicsEngine extends LayerProducer { reset(): void }                             // id 'physics'
export interface VowelEstimator { estimate(samples: Float32Array, sampleRate: number): { closed: number; a: number; i: number; u: number; e: number; o: number } }   // 合計 1
// ExpressionController に足すメソッド（複数の同時適用）
//   toggle(expressionId: string, now: number): void
//   actives(): string[]           // 適用した順
// Services に足すもの: animations（AnimationPlayer）, periodic, physics, vowels
```

### 標準の合成ルール

| パラメータ | 表情 | アニメーション | リップシンク | 周期 |
| --- | --- | --- | --- | --- |
| 顔・体の角度 | add | override（遷移の blendMode が addToTracking なら add） | – | add |
| 目 開閉 | multiply（例: 笑顔 0.6、ウィンク 0） | override | – | – |
| 目 笑顔・頬染め | override | override | – | – |
| 眉 | add | override | – | – |
| 口 開閉 | add | override | max | – |
| 口 形・横幅 | override | override | override（音量に応じた重み） | – |

トラッキングと体の追従は担当するパラメータを override、物理演算は揺れもののパラメータを override で合成する。

### アプリの枠の差し込み口（apps/desktop/src/shell/api.ts）

```ts
export interface PanelDef { id: string; mode: ModeId; area: 'left' | 'right' | 'bottom'; title: string; order?: number; level?: 'easy' | 'detail' | 'both'; component: React.FC }
export function registerPanel(def: PanelDef): void;
export interface SectionDef { id: string; panelId: string; order?: number; level?: 'easy' | 'detail' | 'both'; component: React.FC }
export function registerPanelSection(def: SectionDef): void;      // パネルの中の <PanelSections panelId=… /> に入る
export function PanelSections(props: { panelId: string }): JSX.Element;
export function registerCenter(mode: 'studio' | 'animation', component: React.FC): void;
export function registerSetupScreen(component: React.FC): void;   // 素材が1つも無いとき中央に出す
export function registerMenuItem(item: { id: string; label: string; shortcut?: string; run(): void }): void;

export interface CanvasPointerEvent { canvasPoint: Vec2; screenPoint: Vec2; button: number; shiftKey: boolean; altKey: boolean; ctrlKey: boolean }
export interface CanvasTool {
  id: string; label: string; cursor?: string;
  onPointerDown?(e: CanvasPointerEvent): void; onPointerMove?(e: CanvasPointerEvent): void; onPointerUp?(e: CanvasPointerEvent): void;
  onKeyDown?(e: KeyboardEvent): void;
  drawOverlay?(ctx: CanvasRenderingContext2D, view: ViewTransform): void;
}
export function registerCanvasTool(tool: CanvasTool): void;        // 最初に登録したものが既定のツール
export function registerCanvasOverlay(id: string, draw: (ctx: CanvasRenderingContext2D, view: ViewTransform) => void): void;
export function useCanvas(): { view: ViewTransform; activeToolId: string; setActiveTool(id: string): void; requestRedraw(): void; lastDeformed(): DeformedModel | null; screenToCanvas(p: Vec2): Vec2 };

export function useServices(): Services;
export function useProject(): Project;
export function useDispatch(): (c: Command) => void;
export function useEditor(): [EditorState, (patch: Partial<EditorState>) => void];
export function useEnvironment(): [Environment, (patch: Partial<Environment>) => void];
export function useDialogs(): { confirm(message: string): Promise<boolean>; notify(message: string): void; prompt(message: string, initial?: string): Promise<string | null> };
export function emitAppEvent(name: string, payload?: unknown): void;
export function onAppEvent(name: string, listener: (payload: unknown) => void): () => void;
```

### ストアの契約（@app/contracts）

```ts
export interface Command { label: string; apply(project: Project): Project }   // 純粋関数
export interface ProjectStore {
  get(): Project;
  subscribe(listener: (project: Project) => void): () => void;
  dispatch(command: Command): void;                                          // 1回の Undo 単位
  transaction(label: string, run: (dispatch: (c: Command) => void) => void): void;   // まとめて1回の Undo
  undo(): void; redo(): void; canUndo(): boolean; canRedo(): boolean;
  load(project: Project): void;                                              // 履歴を消して置き換える
}
export interface EditorState {
  mode: ModeId;
  uiLevel: Record<ModeId, UiLevel>;
  selectedPartIds: string[];
  activeParameterIds: string[];        // 編集中のパラメータ（0〜2個）
  editorParamValues: ParamValues;      // モデリング中のプレビュー値（無いパラメータはデフォルト値）
}
export interface EditorStore { get(): EditorState; set(patch: Partial<EditorState>): void; subscribe(l: (s: EditorState) => void): () => void }
```

## 作るもの

- `createVowelEstimator(): VowelEstimator`: 20ms の窓ごとに LPC（次数 12 程度）で第1・第2フォルマントを求め、母音ごとの代表値との距離から確率に直す（合計 1）。無音（しきい値以下）は closed。代表値は成人の平均で始め、キャリブレーションは行わない。
- lipsync.ts を拡張する: onSamples を推定に回し、母音の確率で model.lipSync.vowels の values を重み付き平均した MouthForm・MouthWidth を出す（blend override、weight = 開きの値。音量が小さいほど表情の口の形が残る）。MouthOpen は母音の values の MouthOpen と音量の開きの小さい方。遅延は 100ms 以下。
- 母音の形の登録（モデリングの「母音」パネル）: 閉じる・あ・い・う・え・お を、口のパラメータ（MouthOpen・MouthForm・MouthWidth）を動かして登録する。[標準の形で作る] で下表の値を入れる。

| 母音 | MouthOpen | MouthWidth | MouthForm |
| --- | --- | --- | --- |
| 閉じる | 0 | 0 | 0 |
| あ | 1.0 | 0.3 | 0 |
| い | 0.3 | 1.0 | 0.2 |
| う | 0.3 | −1.0 | 0 |
| え | 0.6 | 0.7 | 0 |
| お | 0.6 | −0.7 | 0 |

## 作らないもの

話者ごとの母音のキャリブレーション。

## 完了条件

- [ ] 合成した母音の音（フォルマントを持つ信号）で、母音が正しく選ばれる
- [ ] 無音で closed
- [ ] 母音の形の登録と Undo
- [ ] 遅延 100ms 以下（計測の表示で確認）


---

# 52. 表情の同時適用

> このカードだけで実装できるように、必要な仕様・型・約束をすべて書いている。ほかのカードや設計書を読む必要はない。「前提」に書いたものは、このカードの時点で必ずある。名前と形を変えないこと。

| 項目 | 内容 |
| --- | --- |
| フェーズ / 段階 | STEP2 / T1 部品 |
| 並行作業 | 同じ段階の 46〜53 と並行して作れる（触るフォルダは重ならない） |
| 担当の目安 | コア |
| 作業場所 | packages/core/src/layers/expression.ts、apps/desktop/src/modes/studio/expressions/ |

## 目的

複数の表情を同時に適用できるようにする（例: 照れ＋笑顔）。

## 前提（このカードの時点ですでにあるもの）

STEP1の ExpressionController（1つずつ切り替え、フェードあり）と、スタジオの表情のカードがある。producer は複数のレイヤーを返せる（同じ id は配列の順に合成）。

抜粋に名前だけ出てくる型も、すべて `@app/schema` か `@app/contracts` から import できる。

### Expression（@app/schema）

```ts
export type BlendOp = 'override' | 'add' | 'multiply' | 'max';
export interface Expression {
  id: Id; name: string;
  entries: { parameterId: Id; value: number; blend: BlendOp }[];
  fadeIn: number; fadeOut: number;          // 秒
}
```

### 合成の契約（@app/contracts）

```ts
export type LayerId = 'tracking' | 'bodyFollow' | 'expression' | 'animation' | 'lipSync' | 'periodic' | 'physics';
export const LAYER_ORDER: LayerId[] = ['tracking', 'bodyFollow', 'expression', 'animation', 'lipSync', 'periodic', 'physics'];
export interface Layer {
  id: LayerId;
  weight: number;                     // 0..1
  values: ParamValues;                // このレイヤーが担当するパラメータの値だけ
  blend?: Record<string, BlendOp>;    // パラメータごとの合成方法。無ければ override
}
export interface ParameterMixer { mix(parameters: Parameter[], layers: Layer[]): ParamValues }

// スタジオの1フレームの文脈。producer は LAYER_ORDER の順に呼ばれる
export interface FrameContext {
  now: number; dt: number;            // ミリ秒
  project: Project;
  mixedSoFar: ParamValues;            // それまでのレイヤーを合成した値
  flags: { lipSyncWeight: number; physicsActive: boolean };   // 前のレイヤーが後のレイヤーへ伝える値（初期値 1・true）
}
export interface LayerProducer { id: LayerId; produce(ctx: FrameContext): Layer | null }
```

### STEP1で増える契約（@app/contracts）

```ts
// TrackingFrame に足す任意の項目（無いときは undefined）
//   mouthForm?: number;  // -1..1（への字〜笑顔）
//   mouthWidth?: number; // -1..1（すぼめ〜横に開く）
//   browY?: number;      // -1..1（下げる〜上げる）

export interface AudioLevel { time: number; rmsDb: number }
export interface AudioSource {
  listDevices(): Promise<{ id: string; label: string }[]>;
  start(deviceId?: string): Promise<void>; stop(): void;
  onLevel(listener: (x: AudioLevel) => void): () => void;                                   // 10ms ごと
  onSamples(listener: (samples: Float32Array, sampleRate: number, time: number) => void): () => void;
}
export interface LipSyncProducer extends LayerProducer {   // id 'lipSync'
  configure(o: { mouthSource: 'max' | 'micOnly' | 'cameraOnly'; strength: 'low' | 'standard' | 'high'; silenceThresholdDb: number }): void;
  update(level: AudioLevel): void;
}
export interface AutoBlink { tick(now: number): { EyeOpenL: number; EyeOpenR: number } }
export interface BodyFollowProducer extends LayerProducer { setStrength(s: 'low' | 'standard' | 'high'): void }   // id 'bodyFollow'
export interface ExpressionController extends LayerProducer {   // id 'expression'
  apply(expressionId: string | null, now: number): void;        // null で解除。STEP1では1つだけ
  active(): string | null;
}
export type CalibrationStep = 'neutral' | 'eyesClosed' | 'mouthOpen';
export interface CalibrationService { capture(step: CalibrationStep, frames: TrackingFrame[]): void; result(): Environment['calibration']; reset(): void }
// TrackingLayerProducer に足すメソッド
//   setCalibration(c: Environment['calibration']): void
//   setPreset(p: 'stable' | 'standard' | 'large' | 'custom', custom?: { minCutoff: number; beta: number; gain: number; deadZone: number }): void
//   setEyeTracking(on: boolean): void   // off のときと外れたときは AutoBlink の値を使う
export interface HotkeyService { register(hotkey: Hotkey, handler: (phase: 'down' | 'up') => void): Promise<'ok' | 'conflict'>; unregisterAll(): Promise<void> }
export interface OutputSink {
  start(o: { width: number; height: number; fps: number }): Promise<void>;
  setTextures(pngs: Record<string, Uint8Array>): Promise<void>;
  submit(model: DeformedModel, view: ViewTransform, background: Background): void;
  stop(): Promise<void>;
}
// KeyGenerator に足すメソッド
//   rotate(binding: Binding, model: Model): Binding                    // 頂点・制御点をピボット中心の円弧で補間
//   surface(binding: Binding, model: Model): Binding                   // ワープの制御点を球面に沿って生成
//   ease(binding: Binding): Binding                                     // 中間キーの値をゆるやかに
//   regenerate(binding: Binding, model: Model, range?: [number, number]): Binding   // ロックされたキーを残して作り直す
// Services に足すもの: audio, lipSync, autoBlink, bodyFollow, expressions, calibration, hotkeys, spout（OutputSink）
```

### STEP2で増える契約（@app/contracts）

```ts
// LayerProducer.produce は複数のレイヤーを返せるようになる（同じ id は配列の順に合成）
//   produce(ctx: FrameContext): Layer | Layer[] | null
export interface AnimationPlayer extends LayerProducer {   // id 'animation'。ctx.flags を設定する
  play(animationId: string, now: number): void;
  stop(animationId: string, now: number): void;
  stopAll(now: number): void;
  playing(): string[];
}
export interface PeriodicPlayer extends LayerProducer { setActive(animationIds: string[]): void }   // id 'periodic'
export interface PhysicsEngine extends LayerProducer { reset(): void }                             // id 'physics'
export interface VowelEstimator { estimate(samples: Float32Array, sampleRate: number): { closed: number; a: number; i: number; u: number; e: number; o: number } }   // 合計 1
// ExpressionController に足すメソッド（複数の同時適用）
//   toggle(expressionId: string, now: number): void
//   actives(): string[]           // 適用した順
// Services に足すもの: animations（AnimationPlayer）, periodic, physics, vowels
```

### 標準の合成ルール

| パラメータ | 表情 | アニメーション | リップシンク | 周期 |
| --- | --- | --- | --- | --- |
| 顔・体の角度 | add | override（遷移の blendMode が addToTracking なら add） | – | add |
| 目 開閉 | multiply（例: 笑顔 0.6、ウィンク 0） | override | – | – |
| 目 笑顔・頬染め | override | override | – | – |
| 眉 | add | override | – | – |
| 口 開閉 | add | override | max | – |
| 口 形・横幅 | override | override | override（音量に応じた重み） | – |

トラッキングと体の追従は担当するパラメータを override、物理演算は揺れもののパラメータを override で合成する。

## 作るもの

- toggle(id, now): 適用していなければ足し（fadeIn）、適用していれば外す（fadeOut）。actives() は適用した順。
- produce: 適用中の表情ごとに1つのレイヤー（id 'expression'、weight = フェードの重み、blend は各項目の blend）を、適用した順に返す。後から適用した表情ほど後ろになるので、override で取り合うパラメータは後のものが優先される。
- apply(id) は「ほかを全部外して id だけにする」として残す（STEP1 の動きと同じ）。
- 表情のカード: 通常はクリックで toggle にし、詳細モードの設定で「1つずつ切り替え」に戻せる。適用中のカードに順番の印を出す。

## 作らないもの

表情の作成の画面（STEP1で実装済み）。

## 完了条件

- [ ] 2つの表情を重ねたときの値（add は足し合わせ、override は後のもの）
- [ ] 片方だけ外したときのフェード
- [ ] apply が STEP1 と同じ動きのまま


---

# 53. 呼吸・腕の標準パラメータと自動セットアップ

> このカードだけで実装できるように、必要な仕様・型・約束をすべて書いている。ほかのカードや設計書を読む必要はない。「前提」に書いたものは、このカードの時点で必ずある。名前と形を変えないこと。

| 項目 | 内容 |
| --- | --- |
| フェーズ / 段階 | STEP2 / T1 部品 |
| 並行作業 | 同じ段階の 46〜53 と並行して作れる（触るフォルダは重ならない） |
| 担当の目安 | コア |
| 作業場所 | packages/core/src/setup/、apps/desktop/src/project/step2Params.ts |

## 目的

呼吸と腕の動きのたたき台を、かんたんセットアップで自動で作る。

## 前提（このカードの時点ですでにあるもの）

かんたんセットアップ（MVP と STEP1 の規則）がある。プロジェクトを開いたときと新規作成のときに 'projectLoaded' が出る。

抜粋に名前だけ出てくる型も、すべて `@app/schema` か `@app/contracts` から import できる。

### 座標と値の約束

- 座標はキャンバス（元のPSD・PNG）のピクセル。原点は左上、x は右、y は下が正。
- 回転は度。画面上の時計回りが正。
- L / R はキャラクター自身から見た左右。画面では L が右側に描かれる。
- FaceAngleX はキャラクターが画面の右を向くと正、FaceAngleY は上を向くと正、FaceAngleZ は時計回りが正。EyeBallX は画面の右を見ると正、EyeBallY は上を見ると正。
- 基準状態 = 素材を配置しただけの状態 = 全パラメータがデフォルト値の状態。素材は「目を開け、口を閉じた」状態で描かれている前提。
- キーは基準状態からの差分。位置・回転・頂点は加算、拡縮・不透明度は倍率（1 = 変化なし）。

### パーツの変形と計算の順序

- パーツの変形は、点 p を `p' = position + pivot + R(rotation)·(scale ⊙ (p − pivot))` に動かす。R は y が下向きの座標で `[cos −sin; sin cos]`（正の角度で時計回り）。
- 実際に使う値: `position = Part.position + Δposition`、`rotation = Part.rotation + Δrotation`、`scale = Part.scale ⊙ Δscale`、`opacity = Part.opacity × Δopacity`（Δ はキーの合成結果）。
- 取り込み直後は position (0,0)・rotation 0・scale (1,1)。メッシュの頂点と pivot はキャンバス座標。
- 画像パーツの最終頂点は内側から外側へ求める。(1) メッシュの基準頂点 + 頂点の差分 → (2) 自身のパーツの変形 → (3) 親グループのワープ（あれば）→ (4) 親グループのパーツの変形 → ルートまで (3)(4) を繰り返す。
- 不透明度は、自身から親までの値をすべて掛け合わせる。

### Part と StandardPartType（@app/schema）

```ts
export interface Part {
  id: Id;
  name: string;
  kind: 'image' | 'group';
  standardType: StandardPartType | null;   // 自由パーツは null
  assetId: Id | null;                      // image のみ
  meshId: Id | null;                       // image のみ
  parentId: Id | null;
  position: Vec2;                          // 初期値 {x: 0, y: 0}
  rotation: number;                        // 度。初期値 0
  scale: Vec2;                             // 初期値 {x: 1, y: 1}
  pivot: Vec2;                             // 回転・拡縮の中心（キャンバス座標）
  opacity: number;                         // 0..1
  blendMode: BlendMode;
  depth: number;                           // 奥行き。手前が正（-1..1 が目安）
  mask: { sourcePartIds: Id[]; inverted: boolean } | null;
  physicsId: Id | null;
  visible: boolean;
  locked: boolean;
}
export type StandardPartType =
  | 'face' | 'earL' | 'earR' | 'cheek'
  | 'eyeWhiteL' | 'irisL' | 'highlightL' | 'upperLidL' | 'lowerLidL' | 'eyeWholeL'
  | 'eyeWhiteR' | 'irisR' | 'highlightR' | 'upperLidR' | 'lowerLidR' | 'eyeWholeR'
  | 'browL' | 'browR'
  | 'upperLip' | 'lowerLip' | 'mouthInside' | 'teeth' | 'tongue' | 'mouthWhole'
  | 'frontHair' | 'sideHairL' | 'sideHairR' | 'backHair'
  | 'neck' | 'torso' | 'armL' | 'armR'
  // 変形グループ（かんたんセットアップが作る）
  | 'bodyRoot' | 'armRootL' | 'armRootR' | 'neckRoot' | 'headRoot'
  | 'faceGroup' | 'eyeGroupL' | 'eyeGroupR' | 'mouthGroup';
```

### Binding と ParameterKey（@app/schema）

```ts
export type Channel = 'transform' | 'vertices' | 'warpPoints';
export interface TransformDelta { position: Vec2; rotation: number; scale: Vec2; opacity: number }
// position・rotation は加算、scale・opacity は倍率（1 = 変化なし）
export interface Binding {
  id: Id;
  target: { type: 'part' | 'mesh' | 'warp'; id: Id };   // transform → part、vertices → mesh、warpPoints → warp
  channel: Channel;
  parameterIds: Id[];              // 1 または 2
  keyValues: number[][];           // パラメータごとのキー位置（昇順。デフォルト値を必ず含む）
  keys: ParameterKey[];
  generation: 'linear' | 'depth' | 'rotate' | 'surface' | 'ease';
  divisions: number | null;        // 中間キーの分割数（自動なら null）
}
export interface ParameterKey {
  coords: number[];                // parameterIds と同じ順の値
  delta: TransformDelta | Vec2[];  // transform は TransformDelta、それ以外は頂点・制御点ごとの差分
  source: 'manual' | 'auto' | 'generated' | 'combined';
  locked: boolean;
}
```

### Model と Project（@app/schema）

```ts
export interface Model {
  parts: Part[];
  meshes: Mesh[];
  warps: Warp[];
  drawOrder: Id[];                 // 画像パーツの id。背面 → 前面
  parameters: Parameter[];
  parameterGroups: ParameterGroup[];
  bindings: Binding[];
  lipSync: LipSync;
  setupHints: { closedLineL: Vec2[] | null; closedLineR: Vec2[] | null };   // かんたんセットアップ用（閉じた目の線。STEP1で使う）
}
export interface Project {
  schemaVersion: number;           // 現在は 1
  id: Id;
  name: string;
  assets: Asset[];
  model: Model;
  expressions: Expression[];
  animations: Animation[];
  physics: Physics[];
  trackingMappings: TrackingMapping[];   // 空なら既定のマッピング
  studio: { scenes: Scene[]; activeSceneId: Id | null; hotkeys: Hotkey[] };
}
```

### 標準パラメータ（STANDARD_PARAMETERS）

| id | 表示名 | group | min | max | default | フェーズ |
| --- | --- | --- | --- | --- | --- | --- |
| FaceAngleX | 顔 左右 | face | -30 | 30 | 0 | MVP |
| FaceAngleY | 顔 上下 | face | -30 | 30 | 0 | MVP |
| FaceAngleZ | 顔 傾き | face | -30 | 30 | 0 | MVP |
| EyeOpenL / EyeOpenR | 目 開閉 L / R | eye | 0 | 1 | 1 | MVP |
| EyeBallX / EyeBallY | 瞳 左右 / 上下 | eye | -1 | 1 | 0 | MVP |
| MouthOpen | 口 開閉 | mouth | 0 | 1 | 0 | MVP |
| EyeSmileL / EyeSmileR | 目 笑顔 L / R | eye | 0 | 1 | 0 | STEP1 |
| BrowYL / BrowYR | 眉 上下 L / R | brow | -1 | 1 | 0 | STEP1 |
| BrowFormL / BrowFormR | 眉 形 L / R（困り〜怒り） | brow | -1 | 1 | 0 | STEP1 |
| MouthForm | 口 形（への字〜笑顔） | mouth | -1 | 1 | 0 | STEP1 |
| MouthWidth | 口 横幅（すぼめ〜横に開く） | mouth | -1 | 1 | 0 | STEP1 |
| Cheek | 頬染め | cheek | 0 | 1 | 0 | STEP1 |
| BodyAngleX / BodyAngleY / BodyAngleZ | 体 左右 / 上下 / 傾き | body | -10 | 10 | 0 | STEP1 |
| Breath | 呼吸 | body | 0 | 1 | 0 | STEP2 |
| ArmL / ArmR | 腕 L / R | armL / armR | -1 | 1 | 0 | STEP2 |
| HairFront / HairSide / HairBack | 髪揺れ 前 / 横 / 後ろ | sway | -1 | 1 | 0 | STEP2 |

### スキーマの関数（@app/schema）

```ts
export const SCHEMA_VERSION = 1;
export function validateProject(json: unknown): Project;       // 失敗時は項目のパス付きのエラー
export function migrate(json: unknown): unknown;               // 古い版を現在の版へ変換
export function loadProjectJson(text: string): Project;        // 解析 → migrate → validate
export function createEmptyProject(name: string): Project;     // MVPの標準パラメータ入り
export function ensureStandardParameters(model: Model, phase: 'mvp' | 'step1' | 'step2'): Model;
```

### 生成・セットアップの契約（@app/contracts）

```ts
export interface KeyGenerator {
  linear(binding: Binding, divisions?: number): Binding;
  depthParallax(model: Model, parameterId: 'FaceAngleX' | 'FaceAngleY'): Binding[];   // 作り直した transform バインディング
}
export interface AutoSetup { plan(project: Project): { command: Command; warnings: string[] } }
```

### アプリの枠の差し込み口（apps/desktop/src/shell/api.ts）

```ts
export interface PanelDef { id: string; mode: ModeId; area: 'left' | 'right' | 'bottom'; title: string; order?: number; level?: 'easy' | 'detail' | 'both'; component: React.FC }
export function registerPanel(def: PanelDef): void;
export interface SectionDef { id: string; panelId: string; order?: number; level?: 'easy' | 'detail' | 'both'; component: React.FC }
export function registerPanelSection(def: SectionDef): void;      // パネルの中の <PanelSections panelId=… /> に入る
export function PanelSections(props: { panelId: string }): JSX.Element;
export function registerCenter(mode: 'studio' | 'animation', component: React.FC): void;
export function registerSetupScreen(component: React.FC): void;   // 素材が1つも無いとき中央に出す
export function registerMenuItem(item: { id: string; label: string; shortcut?: string; run(): void }): void;

export interface CanvasPointerEvent { canvasPoint: Vec2; screenPoint: Vec2; button: number; shiftKey: boolean; altKey: boolean; ctrlKey: boolean }
export interface CanvasTool {
  id: string; label: string; cursor?: string;
  onPointerDown?(e: CanvasPointerEvent): void; onPointerMove?(e: CanvasPointerEvent): void; onPointerUp?(e: CanvasPointerEvent): void;
  onKeyDown?(e: KeyboardEvent): void;
  drawOverlay?(ctx: CanvasRenderingContext2D, view: ViewTransform): void;
}
export function registerCanvasTool(tool: CanvasTool): void;        // 最初に登録したものが既定のツール
export function registerCanvasOverlay(id: string, draw: (ctx: CanvasRenderingContext2D, view: ViewTransform) => void): void;
export function useCanvas(): { view: ViewTransform; activeToolId: string; setActiveTool(id: string): void; requestRedraw(): void; lastDeformed(): DeformedModel | null; screenToCanvas(p: Vec2): Vec2 };

export function useServices(): Services;
export function useProject(): Project;
export function useDispatch(): (c: Command) => void;
export function useEditor(): [EditorState, (patch: Partial<EditorState>) => void];
export function useEnvironment(): [Environment, (patch: Partial<Environment>) => void];
export function useDialogs(): { confirm(message: string): Promise<boolean>; notify(message: string): void; prompt(message: string, initial?: string): Promise<string | null> };
export function emitAppEvent(name: string, payload?: unknown): void;
export function onAppEvent(name: string, listener: (payload: unknown) => void): () => void;
```

## 作るもの

- `step2Params.ts`: 'projectLoaded' で ensureStandardParameters(model, 'step2') を実行する（足りないものがあるときだけ）。
- plan に規則を足す（source 'auto'。manual と locked のキーは残す）。

| パラメータ | 対象 | 値 1 のときの差分 |
| --- | --- | --- |
| Breath | torso | Δscale.y = 1.015（ピボットは胴体の下端中央） |
| Breath | neckRoot | Δposition.y = −胴体の高さ × 0.006 |
| ArmL / ArmR | armRootL / armRootR | Δrotation = −30 / +30（腕を上げる向き。値 −1 で逆） |

- 揺れものの標準パラメータ（HairFront など）は、物理の設定で使われるまでバインディングを作らない。

## 作らないもの

物理の設定（別のカード）。

## 完了条件

- [ ] fixtures でキーの向きと値が表のとおり
- [ ] 開いたプロジェクトに STEP2 の標準パラメータが足される
- [ ] 再実行で manual と locked のキーが残る


---

# 54. STEP2の結合と受け入れ

> このカードだけで実装できるように、必要な仕様・型・約束をすべて書いている。ほかのカードや設計書を読む必要はない。「前提」に書いたものは、このカードの時点で必ずある。名前と形を変えないこと。

| 項目 | 内容 |
| --- | --- |
| フェーズ / 段階 | STEP2 / T2 結合 |
| 並行作業 | 直列 |
| 担当の目安 | 結合 |
| 作業場所 | apps/desktop/src/services.ts、docs/ |

## 目的

STEP2の仮実装を本物に差し替え、STEP2の完成条件をすべて確かめる。

## 前提（このカードの時点ですでにあるもの）

次の本物の実装がある。

| 提供元 | 関数 |
| --- | --- |
| @app/core | createAnimationPlayer、createPeriodicPlayer、createPhysicsEngine、ExpressionController（同時適用つき） |
| @app/audio | createVowelEstimator（lipsync に組み込み済み） |

抜粋に名前だけ出てくる型も、すべて `@app/schema` か `@app/contracts` から import できる。

### サービスのまとめ（@app/contracts）

```ts
export interface Services {
  store: ProjectStore; editor: EditorStore; assets: AssetRepository; fs: FileSystem;
  evaluator: BindingEvaluator; pipeline: DeformPipeline; mixer: ParameterMixer; createRenderer(): Renderer;
  meshGenerator: MeshGenerator; keyGenerator: KeyGenerator; autoSetup: AutoSetup; keyEditor: KeyEditor;
  importer: Importer; io: ProjectIO; autoSaver: AutoSaver;
  tracking: TrackingSource; trackingLayer: TrackingLayerProducer;
}
```

### STEP2で増える契約（@app/contracts）

```ts
// LayerProducer.produce は複数のレイヤーを返せるようになる（同じ id は配列の順に合成）
//   produce(ctx: FrameContext): Layer | Layer[] | null
export interface AnimationPlayer extends LayerProducer {   // id 'animation'。ctx.flags を設定する
  play(animationId: string, now: number): void;
  stop(animationId: string, now: number): void;
  stopAll(now: number): void;
  playing(): string[];
}
export interface PeriodicPlayer extends LayerProducer { setActive(animationIds: string[]): void }   // id 'periodic'
export interface PhysicsEngine extends LayerProducer { reset(): void }                             // id 'physics'
export interface VowelEstimator { estimate(samples: Float32Array, sampleRate: number): { closed: number; a: number; i: number; u: number; e: number; o: number } }   // 合計 1
// ExpressionController に足すメソッド（複数の同時適用）
//   toggle(expressionId: string, now: number): void
//   actives(): string[]           // 適用した順
// Services に足すもの: animations（AnimationPlayer）, periodic, physics, vowels
```

### スタジオの実行部の差し込み口（apps/desktop/src/modes/studio/runtime.ts）

```ts
export function registerLayerProducer(p: LayerProducer): () => void;   // LayerProducer・FrameContext は @app/contracts
export interface StudioFrame { model: DeformedModel; view: ViewTransform; background: Background; params: ParamValues; now: number }
export function registerFrameSink(sink: (frame: StudioFrame) => void): () => void;
export function useStudioRuntime(): { running: boolean; status: 'tracking' | 'lost' | 'stopped'; lastFrame(): StudioFrame | null };
```

1フレームの処理: LAYER_ORDER の順に producer を呼び、呼ぶたびに mixedSoFar を更新する → mixer.mix → evaluator → pipeline → プレビューの renderer と、登録された sink へ渡す。

## 作るもの

- `services.ts` の STEP2 の項目を本物に差し替え、producer をスタジオに登録する。
- 下の完成条件を、MVP と同じ評価条件で確かめ、`docs/acceptance-step2.md` に残す。

1. タイムライン
2. アニメーションの作成
3. アニメーションの登録
4. ループ
5. 周期アニメーション（呼吸の自動生成を含む）
6. 現在の状態からの開始ブレンド
7. 終了時のトラッキング復帰ブレンド
8. アニメーション間のクロスフェードと割り込み
9. 影響範囲（パラメータグループ単位）
10. トラッキング・表情・リップシンク・アニメーションの同時合成（標準の合成ルール）
11. 複数の表情の同時適用
12. 母音（あいうえお）によるリップシンク
13. 物理演算（揺れパラメータとバインディングの自動作成）
14. 髪・布・リボン・アクセサリの簡易物理プリセット
15. 標準パラメータの追加（呼吸、腕、揺れもの）

## 作らないもの

STEP3相当の機能（設計の対象外）。

## 完了条件

- [ ] 15項目すべての確認結果が docs/acceptance-step2.md にある
- [ ] MVP と STEP1 の受け入れの項目が引き続き通る
