# 契約の変更記録

設計書（files/implementation-steps-all.md）の契約（カード02・03・05、26、45）から形を変えたときに、ここに記録する。設計書の原本は書き換えない。

- 各ステップの最初に、そのカードの節とあわせてここを読む。ここに書いたことは設計書より優先する。
- 変更は CO と相談してから決める。

## 書き方

```md
### CC-001 <変更の要約>

- 決めた日 / ステップ:
- 対象の契約: （例: @app/contracts の Renderer）
- 変更前:（設計書のシグネチャ）
- 変更後:（正確なシグネチャ）
- 理由:
- 影響するカード: （その型を「前提」に載せているカード番号）
- 移行: （すでにあるコードの直し方と、直したファイル）
```

## 記録

### CC-013 流れ揺れの保存と共通フレーム評価（カード100、2026-10-08 CO）

- ユーザーの流れ揺れの実装指示による先行実装。契約は本カードで直列に行う。
- `CurveGuide.dynamics?: { enabled; preset: 'soft' | 'normal' | 'firm'; strength: 0..1; damping: 0..1 }`。省略はOFF。schemaVersion 5、4→5は設定と既存の軸揺れ・キーをそのまま保ち、省略をOFFと解釈する。
- ユーザーの追加指定に従い、`CurveGuide.collision?: { enabled; colliderIds: Id[]; thickness: 0.5..2 }`と`Model.shoulderColliders?: { id; name; partId; meshId; meshSignature; points: Vec2[2..8]; radius>0; enabled }[]`を追加。省略は衝突OFF、肩なし。衝突と慣性は独立。取付先が無い肩・指定は読込時に修復し、対応失効は描き直しのため保持する。
- `HairContact/HairContacts`はフレームの取付済み肩と半幅。`HairDynamicsSession.advance`に省略できるcontactsを追加、連続判定の上限を`collisionUnresolved`で返す。`accept`で検査済みの線を履歴へ戻し、却下した線の速度は破棄する。`CurveGuideResult.collision`は`disabled / ok / limited / unresolved`、理由と肩ごとの診断を別に返す。
- `HairFrameEvaluator.evaluate(project, params, context?, session?)`は通常の変形と軸出力だけ0にした参照を準備し、重力→軸の対応→流れ揺れ→最終メッシュを評価する。`DeformPipeline.deform(model,deltas)`は履歴なしの既存互換として残す。新しい履歴は再生ごとの`HairDynamicsSession`に持ち、同一frameIdで二重更新しない。
- `CurveGuideResult.dynamics?`は慣性の状態と停止理由を返す。毎刻みの線/速度はProjectStore・Undo・保存へ入れない。
- 出力ウィンドウの`FrameMessage.positions?`へ完成した頂点（partId→number[]）を配送する。遅れた出力で物理を再計算せず、スタジオの同じ完成フレームを描く。省略時は従来の静止評価。
- 影響: カード99の排他を解除し、軸/流れを独立した設定にする。CC-012のパレットを利用し、列は増やさない。カード98の胸・他のSTEP4契約は変更しない。

### CC-012 オブジェクトパレット・見出しの説明・ツールの対象を選ぶ段（2026-10-08 CL、I-065）

- 決めた日 / ステップ: 2026-10-08 / ユーザーの要望によるモデリングのツールとパレットの整理（[設計](modeling-palette-design.md)の D1〜D5 をユーザーが承認。CO は設計書を読む）
- 対象の契約: アプリの枠の差し込み口（apps/desktop/src/shell/api.ts）の PanelDef と CanvasTool（カード05。CanvasTool は CC-001 の後）
- 変更前: `PanelDef { id; mode; area; title; order?; level?; component }`、`CanvasTool { id; label; cursor?; level?; onPointerDown?; onPointerMove?; onPointerUp?; onKeyDown?; drawOverlay? }`
- 変更後（どれも省略できる項目の追加）:
  - `PanelDef.object?: { kind: 'tool' | 'part'; when(context: PanelContext): boolean }`（`PanelContext = { project; editor; activeToolId }`）。指定したパネルはオブジェクトパレットになり、when が true の間だけ列のいちばん上（ツール → パーツの順）に、色付きの見出しと札で出る。省略は今までどおりの共通パレット
  - `PanelDef.info?: { purpose: string; steps: string[] }`。見出しの ⓘ で目的と流れを出す
  - `CanvasTool.toolbar?: boolean`。false ならツールバーにボタンを出さない（パレットのボタンから切り替えるツール）
  - `CanvasTool.target?: { prompt; has(project, editor); pick(project, deformed, point) }`。対象が無い間は枠が案内の帯・選べるものの点線の囲み・クリックでの選択を受け持ち、ツールへは押す操作も重ね描きも渡さない
  - `CanvasTool.onContextClick?(e)`。右クリック（動かさずに離したとき）。省略するとパーツの選択を外す
- 理由: 使っていないツールの設定のパネルが常に出て列が窮屈になり、目専用のツールが共通のツールバーにあって何にでも使えるように見えた。ワープ・流れ線はツールを選んでもキャンバスで対象を選べず、メッシュは誤って押したパーツから戻りにくかった（I-065）
- 影響するカード: PanelDef・CanvasTool を前提に載せるカード。省略できる項目の追加なので、今の登録はそのまま動く。カード99 の後続（[髪の慣性・肩との接触](step4/hair-dynamics-design.md)）は、この差し込み口を使う
- 移行: 枠（Layout.tsx・CanvasHost.tsx・shell.css・canvas/banner.ts）。登録を変えたもの: メッシュ（ツールのパレット）、流れ線（ツールのパレット、カード99 の登録だけ）、ワープ（パーツの設定の節から、ツールのときだけ出る「ワープ」のパレットへ）、閉じた目の線（目のパーツのパレット、ツールバーから外す）。テスト: objectPalette.test.tsx・toolTarget.test.tsx ほか（docs/status.md）

### CC-011 流れ線と重力追従の保存・変形結果（カード99、2026-10-08 CO）

- ユーザーの実装指示による先行実装。ほかの契約カードと同時には進めない。
- `Model.curveGuides`（省略は空）に対象・基準の3点・編集の3点・メッシュの対応の印・影響幅・根元の区間・重力/有効の設定を保存する。schemaVersionを4にし、3→4で既存のモデルに空の一覧を足す。
- `DeformedModel.curveGuides`に表示上の線と制御点、対応の失効/変形の制限を返す。通常のキー・親の変形後に同じ評価器で補正し、モデリングとスタジオ/出力で形を一致させる。
- 古いプロジェクトは見た目を変えずに移行する。対応の印がメッシュと違う線は適用しない。手動でキーへ記録するときは線の実行時適用を解除し、二重に変形しない。

### CC-010 層の出どころを分ける（auto・hotkey の層）と、自動まばたき・出力の GPU の設定

- 決めた日 / ステップ: 2026-10-07 / STEP3 のカード65（I-055・I-007・I-032 の契約の部分）。
- 対象の契約: `@app/contracts` の `LayerId`・`LAYER_ORDER`・`FrameContext`（カード03・26・45）、`@app/schema` の `Environment`（カード02）。
- 変更前: 層の順は tracking → bodyFollow → expression → animation → lipSync → periodic → physics。自動まばたきはトラッキングの層の中（CC-002）と、カメラ停止中の実行部の経路で作っていた。ホットキーのパラメータの上書きは表情と同じ id の層で、順番は登録の順。Environment.output は `{ method; width; height; fps }`。
- 変更後:
  - `LayerId` に `auto`（プログラムが作る値。自動まばたき）と `hotkey`（ホットキーのパラメータの上書き）を足した。順は tracking → auto → bodyFollow → expression → hotkey → animation → lipSync → periodic → physics。auto は体の追従の前（自動の動きで頭が動いたら体も追う）、hotkey は表情の後・アニメーションの前（今までの登録の順と同じ効き方）。
  - `FrameContext.layersSoFar?: readonly Layer[]`: それまでの層そのもの（合成する前の値と重み）。auto の層は、目の値がトラッキングの層から来たかをこれで判定する。実行部は必ず渡す。テストで省いたら空として扱う（既存のテストを変えないため任意にした）。
  - `Environment.autoBlink: boolean`（既定 true）、`Environment.output.adapterId: string | null`（null は自動＝既定のアダプター）。読み込み時に無ければ既定値で補う（parseEnvironment の重ね方のまま）。
  - 仮実装の `FakeMixer` も LAYER_ORDER の順に合成する。合成の方法（add・multiply・max・override）・パラメータ別の重み・範囲への丸めも本物と同じ規則にした（2026-10-07 の追記。contracts は core に頼れないので写しを持ち、同じ値になることを core の mixer.c65.test.ts で確かめる）。
- 理由: カメラから来た値とプログラムが作る値を分け（I-055 の自動まばたきの穴、同じ処理が2か所）、層ごとの値を計測の表示に出す（I-007）。ホットキーの効く順を登録の順に頼らない。GPU が2つある PC で Spout2 の GPU を選ぶ（I-032）。
- 影響するカード: ミキサー09、実行部22、STEP3 のカード66（auto の層と層ごとの値）・67（計測の表示）・68（ホットキーの層）・69（GPU の選択）。
- 移行: contracts（型・FakeMixer）、schema（Environment の型・既定値・検証）、core（ミキサーは LAYER_ORDER をそのまま使う）。テストの期待値（層の順・既定値）と、出力の設定を組み立てている `apps/desktop/src/output/spout/controller.test.ts`（adapterId を足しただけ。カード69 の着手の前）を直した。保存形式の版は変えない（Environment はプロジェクトに入らない）。

### CC-009 開いたときに分かったことを返す（欠けた素材・保存の途中の .tmp・切れた参照）

- 決めた日 / ステップ: 2026-10-07 / STEP3 のカード58（I-056・I-057・I-027）。
- 対象の契約: `@app/contracts` の `ProjectIO`（カード03・14）。
- 変更前: `save(dir, project, assetPngs): Promise<void>`、`load(dir): Promise<{ project; assetPngs }>`。素材の PNG が1つでも無いと load は MissingAssetFilesError で止まった。
- 変更後:
  - `load(dir): Promise<LoadedProject>`。`LoadedProject = { project; assetPngs; report: LoadReport }`。
  - `LoadReport = { missingAssetIds: string[]; changedAssetIds: string[]; repairs: string[]; openedFromTmp: boolean }`。欠けた素材は同じ大きさの透明な PNG の代わりで返す。記録のハッシュと違う素材は changedAssetIds（読み込みは続ける）。開くときに直したこと（出力先の無い物理を外した、.tmp から読んだ）は repairs。project.json が無く project.json.tmp があれば、そこから開いて openedFromTmp を true にする。
  - `save(dir, project, assetPngs, options?: SaveOptions)`。`SaveOptions = { skipAssetIds?: string[] }` の素材は書かない（欠けたまま）。
  - `emptyLoadReport()` を足した。MissingAssetFilesError はやめた。
- 理由: 素材が1つ欠けるとプロジェクト全体が開けなかった（I-056）。保存の置き換えの途中で止まった跡から開けるようにする（I-057）。前の版で残った、出力先の無い物理を開くときに直す（I-027）。
- 影響するカード: 保存・読み込み14、モデリングの結合23、STEP3 のカード58。
- 移行: contracts（型・`FakeProjectIO`）、io（projectIO.ts・repair.ts）、desktop（project/actions.ts・MissingAssetsSection.tsx）。保存形式の版は変えない。

### CC-008 3つ以上のパラメータの組み合わせのキーと、プレビュー中の編集の止め方

- 決めた日 / ステップ: 2026-10-05 / 承認済み方針（I-028「キー編集と複数パラメータのプレビューを分離する。3軸以上の専用キーに対応し、2軸断面を指定して編集する」）。実装・自動確認は2026-10-06（別のセッション）。
- 対象の契約: `@app/schema` の `Binding.parameterIds`（カード02）、評価（カード06）、`EditorState.activeParameterIds` の使い方と KeyEditor（カード03・19）、方向グリッド・組み合わせの補正（カード30）。
- 変更前: バインディングのパラメータは1つか2つ。2つのときの欠けた格子の点は (x, y0) + (x0, y)。KeyEditor は編集中のパラメータを最大2つまで使う。編集中でない行のスライダーを動かすとその行だけを編集中にし、ほかの値を消していた。基準状態の編集を止めるのは「編集中のパラメータがすべてデフォルト値で、ほかの値がデフォルト値でない」ときだけ。
- 変更後:
  - `Binding.parameterIds` は 1〜`MAX_BINDING_PARAMETERS`（4）個（schema の rules に定数）。評価は多重線形補間。2つ以上で欠けた格子の点は、デフォルト値から外れた軸の一部をデフォルト値に戻した点の値の包除で代用する（2つなら (x, y0) + (x0, y) − (x0, y0)。デフォルト値の点が変化なしなら以前と同じ。3つなら 面の和 − 辺の和 + 頂点。位置・回転・頂点は加算、拡縮は乗算、不透明度は絶対値の加算）。
  - KeyEditor は編集中のパラメータを最大4つまで使う（その組のバインディングに記録）。`DeltaOps.inverse` を足し、格子の代用・補助のキーを評価と同じ包除で求める。キーを足すときの補助のキーは2つ以上のバインディングで作る。
  - プレビュー: `editorParamValues` のうち編集中でないパラメータの値は、見え方を確かめるだけの値。デフォルト値でないものが1つでもあれば（`previewParameters`）、編集中のパラメータがあっても基準状態・キーの編集を止める（`isPreviewOffBase`）。パラメータパネルは、編集中でない行のスライダーで値だけを変え、［値をすべて戻す］でまとめて戻す。行の押し方: 押すと替える、Ctrl+クリックで加える、編集中の行をもう一度押すとやめる。
  - 2軸断面: 方向グリッド・組み合わせの補正の格子は、組のほかに編集中のパラメータ（デフォルト値でないもの）があれば、その値での断面（`ParameterPair.fixed`）になり、組と断面のパラメータの組のバインディングのマスを出す。
- 理由: I-028・I-047。複数のパラメータの組み合わせを確かめながら、見えている形と違うものを編集しないようにし、3つ以上の組み合わせの補正を作れるようにする。
- 影響するカード: 評価06、KeyEditor19、パラメータパネル19・31、方向グリッド30、不透明度34（N 次元の不透明度のバインディングも同じ規則）。
- 移行: schema（上限の定数・検証）、core（prepare の N 次元と包除、evaluator の角、opacity）、desktop（KeyEditor の common・transform・points、パラメータパネル・行・表示、格子の断面）。保存形式の版は変えない（2つまでのバインディングは同じ結果）。

### CC-007 トラッキングの割り当ての使い方と、同じパラメータへの割り当ての合わせ方

- 決めた日 / ステップ: 2026-10-05 / 承認済み方針（I-042「スタジオ詳細設定にトラッキングの割り当て・合成設定を追加する」）。実装・自動確認は2026-10-06（別のセッション）。
- 対象の契約: `@app/schema` の `Project`・`TrackingMapping`・schemaVersion（カード02・16）、`@app/tracking` の `createTrackingLayerProducer`（カード16・26）。
- 変更前: `Project.trackingMappings` が空なら既定のマッピング、1件でもあればその一覧だけを使う。同じパラメータへの割り当ては後の行の値で上書き。空の一覧と「全部無効」を区別できない。割り当てを編集する画面は無い。
- 変更後:
  - `Project.trackingSetup: { mode: 'standard' | 'custom' | 'off'; combine: { parameterId; method: 'add' | 'average' | 'priority' }[] }` を追加。standard = 既定のマッピング、custom = `trackingMappings` の一覧（空なら何も動かさない）、off = トラッキングでパラメータを動かさない。一覧はどの使い方でも残す。
  - `TrackingMapping.weight: number`（0 以上）を追加。合わせ方: add = 重み × 値の和（一覧に無いパラメータの既定）、average = 重み付き平均（重みの和が 0 ならふつうの平均）、priority = 一覧で上の割り当て（そのフレームに入力が無ければ次）。合わせたあとパラメータの範囲で丸める。
  - `createTrackingLayerProducer(parameters, mappings?, { autoBlink?, combine? })`: mappings が無ければ既定、空の配列なら何も動かさない（以前は空でも既定）。
  - schemaVersion を 3 にし、2 → 3 の変換を足した（`MIGRATIONS[2]`）。一覧が空なら standard、あれば custom。各割り当てに weight 1。同じパラメータへの割り当てが複数あれば priority にし、それまで効いていた後の行が上に来るよう並びを逆にする。
- 理由: I-042。ユーザー定義パラメータへの割り当てを画面で作れるようにし（STEP1 完成条件14）、標準へ戻すことと全部無効にすることを区別し、複数の入力の合わせ方を明示する。
- 影響するカード: 保存16、トラッキング16・26・35、スタジオの設定22、ユーザー定義パラメータ34（削除で合わせ方の設定も消す）。
- 移行: schema（型・既定値・検証・migrate）、tracking（producer・既定のマッピングに weight）、desktop（services/trackingLayer の `mappingsOf`、スタジオの設定（詳細）の「トラッキングの割り当て」（modes/studio/trackingMap）、userParams の削除）。core のテストは fixtures のプロジェクトを `loadProjectJson`（変換してから検証）で読むようにした。

### CC-006 不透明度のキーを、その姿勢でのパーツ自身の不透明度（絶対値）にする

- 決めた日 / ステップ: 2026-10-05 / 承認済み方針（I-026「姿勢ごとの絶対値キー」）。実装・自動確認は2026-10-06（別のセッション。CO と同時に着手しないよう実装記録に書いて進めた）。
- 対象の契約: `@app/schema` の `Binding`・`TransformDelta`・`Part.opacity`・schemaVersion（カード02）、`@app/contracts` の `TargetDeltas`・`TransformChange`（カード03・06・07・19・26）。
- 変更前: キーの `TransformDelta.opacity` は倍率（1 = 変化なし）。パーツの不透明度 = 親 × `Part.opacity` × 全バインディングの倍率の積。`TransformChange.opacityFactor?: number`（いまの値に掛ける）。倍率 0 からは上げられず、0 の代わりに 0.001 を記録していた（カード34・42）。
- 変更後:
  - `Binding.controlsOpacity?: boolean`（transform だけ。省略は false）。true のバインディングのキーの `opacity` は、その姿勢でのパーツ自身の不透明度（0..1 の絶対値。親は掛けない）。false のバインディングのキーの `opacity` は使わない（1 のまま）。
  - `Part.opacity` は基準の不透明度（不透明度のキーが無いとき・デフォルト値での値）。不透明度のバインディングのデフォルト値のキーは `Part.opacity` と同じ値にする（`patchPart` と KeyEditor の基準状態の編集が一緒に変える）。
  - 合成: パーツ自身の不透明度 = `Part.opacity` + Σ（不透明度のバインディングのいまの値 − そのバインディングのデフォルト値での値）を 0..1 に収めたもの。不透明度のバインディングが1つなら、いまの値がそのまま不透明度になる。2パラメータの格子の欠けた点は (x, y0) + (x0, y) − (x0, y0)。親の不透明度は最後に掛ける。
  - `TargetDeltas.opacities?: Record<string, number>`（partId → パーツ自身の不透明度。不透明度のバインディングがあるパーツだけ）。`transforms[].opacity` は使わない（1）。変形（pipeline）は `opacities` があればそれ、無ければ `Part.opacity` を親に掛ける。
  - `TransformChange.opacity?: number`（いまの値で、パーツ自身の不透明度をこの値にする）に置き換え、`opacityFactor` は削除。基準状態では `Part.opacity`（とデフォルト値のキー）、パラメータの編集中はその組のバインディングを不透明度のバインディングにして（既存のキーの opacity は基準の不透明度にそろえる）、ほかの不透明度のバインディングの分を除いた値を記録する。
  - schemaVersion を 2 にし、1 → 2 の変換を足した（`MIGRATIONS[1]`）。倍率が 1 でないキーを持つ transform のバインディングを不透明度のバインディングにし、キーの値 = `Part.opacity` × そのキーの倍率 × ほかのバインディングのデフォルト値での倍率、新しい `Part.opacity` = `Part.opacity` × 各バインディングのデフォルト値での倍率の積。0.001 以下の倍率は 0。バインディングが1つなら見た目は変わらない。複数が同時にデフォルト値から外れたときだけ、積から和に変わる。変換前のファイルはこれまでどおり backups/project.v1.<日時>.json に残る。
- 理由: I-026。完全な 0 から戻せるようにし、基準の不透明度が 0 のパーツもキーで見せられるようにする。0.001 の回避と、I-038 のデフォルト値のキーの専用の口（`defaultKeyTransformEdit`）をやめる。
- 影響するカード: 評価06、変形07、KeyEditor19、不透明度34、かんたんセットアップ42（頬染めは基準の不透明度 0・値 1 のキーにもとの不透明度）、保存16（版 2）。
- 移行: schema（型・検証・migrate）、contracts（型・FakeKeyEditor）、core（evaluator・prepare・pipeline・opacity.ts の `partOpacity`/`rawPartOpacity`/`bindingOpacity`/`withPartOpacity`、`patchPart`、かんたんセットアップの頬染めと `rebuildTransformBinding`）、desktop（KeyEditor の transform と common の `KeySpec.opsFor`、不透明度のセクション、方向グリッドの「差分 0」の判定、キャンバスの変更の判定）。fixtures のプロジェクトは版 1 のまま（開くときに変換される）。

### CC-004 カメラの設定と実動作の計測を公開する

- 決めた日 / ステップ: 2026-10-05 / あるべき姿をユーザーが承認。実装・自動確認は2026-10-06。
- 対象の契約: `@app/schema` の `Environment`、`@app/contracts` の `TrackingSource`（カード05・15・25・26）。
- 変更後: Environmentへ `cameraCapture: { mode: 'auto' | 'manual'; width: number; height: number; fps: number }` を追加。既定はauto/640/480/60。幅16..7680、高さ16..4320、fps1..120の整数。未設定・不正な値は項目単位で補完し、手動の値はautoへ切り替えても保持する。
- TrackingSourceへ必須の `configureCapture(settings: Environment['cameraCapture']): void`、`captureStats(): CameraCaptureStats | null`、`onCaptureStats(listener: () => void): () => void` を追加。CameraCaptureStatsはmode、state（selecting/ready/error）、width/height、requestedFps、nominalFps/maxFps/cameraFps/trackingFps（numberまたはnull）、warning（stringまたはnull）を持つ。停止中はnull、測定前のfpsはnull、停止した映像は0fps。
- 計測: cameraFpsはvideo.getVideoPlaybackQuality().totalVideoFramesの差分を実時間で割った動画フレーム数。推定コールバック数とは独立させ、推定で省いたフレームも数える。trackingFpsは実際の推定呼び出し数。nominalFpsはtrack.getSettings、maxFpsはgetCapabilitiesの機器全体の報告で、照明・解像度別の達成保証ではない。
- 自動選択: 640×480・要求60fpsを初期値とし、320×240、1280×720を各1秒安定待ち+1秒計測。初期設定で受信/推定とも54fps以上なら終了。その他は両fpsの小さい方が高い候補を優先し、差10%以内なら受信fps、同程度なら初期設定を保持する。不適合候補は飛ばす。手動の解像度はexact、fpsはidealで、達成しない場合は実測と注意を表示する。
- 理由: I-001/I-002。カメラと推定の遅さを区別し、PCと機器の負荷に応じた設定・画質優先の手動指定を可能にする。適用は直列化し、最後の指定と停止を優先する。
- 移行: schema、trackingのcamera/sourceとCaptureSession、FakeTrackingSource、desktopのEnvironment/UI/計測、テストの差し替え実装を変更。旧TrackingSource向けの互換分岐は追加しない。Project形式は変更しない。実カメラ+OBSでの性能受け入れは未確認。

### CC-005 表情の一時適用を所有者ごとに管理する

- 決めた日 / ステップ: 同上。実装・自動確認は2026-10-06。
- 対象の契約: `@app/contracts` の `ExpressionController`（カード38・40・45・52）。
- 変更後: 必須の `hold(ownerId: string, expressionId: string | null, mode: 'stack' | 'single', now: number): void`、`release(ownerId: string, now: number): void` を追加。通常のapply/toggleと一時所有を分離し、共通の純粋な選択処理 `createExpressionSelection` をcontractsから公開する。
- 規則: stackのholdは元の表情・順序を変更せず、所有者が全て解除された追加分だけを外す。singleのholdは押した時点のモードで一時的に置き換え、残る所有者と現在の通常選択から復元する。nullのholdは所有者が残る間だけ全解除する。途中のtoggleは保持し、hold中の表情をカードで外したらそのholdを再表示しない。明示的なapplyは全holdを無効化し、古いキー解放がその選択を戻さない。
- ホットキー: 所有者IDは `hotkey:${hotkey.id}`。Environment.expressionModeをキー押下時に読み、カードと同じstack/singleのtoggleを行う。割り当て削除・再登録・コンテキスト解除は自身のholdを解放する。ブラウザのblurによる解放は既存のbackendを使用する。
- 理由: I-043。同時hold・全解除・シーン変更・途中のカード操作で、最後の1件や古いスナップショットへ戻る不具合を解消する。フェード後の出力レイヤーも選択一覧の順序を保つ。
- 移行: 本物のcoreとFakeExpressions、desktopのhotkeys/actions・binding、各テストのコンテキストを変更。任意メソッドへの互換分岐は追加しない。表情・Projectの保存形式は変更しない。

### CC-002 顔の復帰とまばたきの重みを分離する

- 決めた日 / ステップ: 2026-10-05 / 判断待ち課題のあるべき姿をユーザーが承認。実装確認は2026-10-06。
- 対象の契約: `@app/contracts` の `Layer`（カード09・26・45）。
- 変更前: `interface Layer { id: LayerId; weight: number; values: ParamValues; blend?: Record<string, BlendOp> }`
- 変更後: 上に `parameterWeights?: Record<string, number>` を追加。指定パラメータには共通のweightの代わりに0..1の重みを適用する。NaNは0、範囲外は丸める。未指定のパラメータはweightを使う。
- 理由: I-030。顔の正面復帰がweightを0にしても、目のフォールバックは重み1で継続する。後段の表情・アニメーションによる上書きは維持する。
- 影響するカード: 合成09、追跡15・26・35、実行部24・45。
- 移行: contracts型とFakeMixer、coreのMixer、trackingのproducer、desktopのStudioRuntimeを変更。Project保存型は変更しない。

### CC-003 PC設定をEnvironmentへ集約する

- 決めた日 / ステップ: 2026-10-05 / 同上。実装確認は2026-10-06。
- 対象の契約: `@app/schema` の `Environment`（カード05・26）。
- 変更前: `cameraDeviceId; mirror; calibration; microphoneDeviceId; silenceThreshold; trackingPreset; output; uiLevel; lastProjectDir`。
- 変更後: `eyeTracking: boolean`、`trackingCustom: { minCutoff: number; beta: number; gain: number; deadZone: number }`、`bodyFollowStrength: 'low' | 'standard' | 'high'`、`expressionMode: 'stack' | 'single'` を追加。既定はtrue、標準調整値、standard、stack。minCutoffは正、他の調整値は0以上の有限数。
- 理由: I-033。PC設定の保存・復元・初期化を一元管理し、旧個別localStorageは保存元にしない。
- 影響するカード: 枠05、保存16、契約26、動き35・36、表情38・52、ホットキー40。
- 移行: schemaの型・既定値・検証、desktopのEnvironmentStore・Appの設定反映・各設定UIを変更。旧個別localStorageの互換移行は行わない。未設定項目は既定値、不正な項目は項目単位で補完する。Project形式は変更しない。カメラ設定はI-001で別途追加する。

### CC-001 キャンバスのツールに、かんたん/詳細の出し分け（level）を足す

- 決めた日 / ステップ: 2026-10-05 / STEP2 の後の課題の修正（docs/issues.md の I-008）
- 対象の契約: アプリの枠の差し込み口（apps/desktop/src/shell/api.ts）の CanvasTool（カード05）
- 変更前: `interface CanvasTool { id; label; cursor?; onPointerDown?; onPointerMove?; onPointerUp?; onKeyDown?; drawOverlay? }`
- 変更後: 上に `level?: 'easy' | 'detail' | 'both'` を足す（省略は both。PanelDef・SectionDef の level と同じ意味）
- 理由: 詳細モードにだけ出すワープのセクションに対して、ツールのボタン「ワープ編集」がかんたんモードでも出て、押しても何もしなかった（I-008）
- 影響するカード: CanvasTool を前提に載せるカード（18・21・29・42 など）。省略できる項目を足しただけなので、既存のツールはそのまま動く
- 移行: shell/canvas/CanvasHost.tsx がツールのボタンを今のかんたん/詳細で出し分け、使っているツールが出ないほうになったら既定のツールに戻す。ワープのツール（modes/modeling/warp/warpTool.ts）を `level: 'detail'` にした。テスト: shell/canvas/toolLevel.test.tsx
