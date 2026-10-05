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
