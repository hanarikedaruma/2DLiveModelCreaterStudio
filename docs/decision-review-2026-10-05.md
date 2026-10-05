# 判断待ち12件の調査・推奨方針

調査日: 2026-10-05

追記（2026-10-05）: I-039の暫定推奨は課題管理表へ転記せず、根本解決に向けた[別の調査方針](C:/Users/hanar/.claude/workspace/2DLiveModelCreaterStudio/docs/i-039-root-cause-investigation.md)へ切り替える。本書のI-039の推奨および実装順は初回調査時点の提案であり、今後の方針は別文書を優先する。他の11件は推奨方針として課題管理表に追記した。

対象は [課題一覧](C:/Users/hanar/.claude/workspace/2DLiveModelCreaterStudio/docs/issues.md) の「判断待ち」12件。課題本文だけでなく、設計カード、現行の実装、関連テスト、既存の実機計測記録を照合した。

**この文書は意思決定のための提案であり、承認済みの仕様ではない。今回の調査では実装・課題の状態を変更していない。新たな実カメラ・OBS計測や実モデルの目視比較も行っていない。** 以下の「確認観点」は、採用時の受け入れ確認項目であり、すでに合格したという意味ではない。

## 判断の早見表

優先度は今回の調査からの提案。「高」は制作・配信の支障や既定の完成条件に関わるもの。「中」は操作・保存・品質の整備。

| ID    | 決めること                                       | 推奨                                                                 | 見送る・別案にする場合の問題                                           |
| ----- | ------------------------------------------------ | -------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| I-001 | カメラの解像度を選べるようにするか               | 720pを既定のまま、手動選択と実測fps表示を追加。自動切替は後回し      | 特定カメラで約13fpsのまま。自動切替は配信中の一時停止や誤判定が増える  |
| I-012 | PSDの不透明度を引き継ぐか                        | 新規割り当て時に引き継ぐ。既存パーツは自動変更しない                 | 半透明の影・頬などがPSDより濃くなり、手修正が必要                      |
| I-014 | 選択肢・スライダー上でUndoを有効にするか         | Undo/Redoだけ通す。文字入力と他のキー操作は保護                      | フォーカス次第でUndoが効かず、操作の一貫性が崩れる                     |
| I-015 | 「間を生成」で生成方式を変えるか                 | 方式を保持し、明示的な方式選択だけで変更                             | 見た目が同じでもdepth由来という情報が意図せず失われる                  |
| I-019 | 1軸のロックを斜め補正にも適用するか              | 1軸キーと2軸の補正キーを分離。補正はグリッドで明示操作               | 一括適用を維持すると、見えていない補正も解除・固定される               |
| I-026 | 不透明度0から復元できる範囲                      | キー倍率0の復元とI-038を先行。基準0は明示的な基準値変更              | 現状は完全な0から復元不可。全面的な絶対値方式は合成・移行の大改修      |
| I-028 | 複数パラメータの組み合わせ表示を許すか           | キー編集と複数値のプレビューを分離。プレビュー中はモデル編集を止める | 現状維持は不便。値だけ残す修正は誤った基準状態の編集を招く             |
| I-030 | 顔を見失った後もまばたきするか                   | まばたきは継続し、顔の正面復帰とは独立させる                         | 約1.5秒後にまばたきが消え、目が開いたままになる                        |
| I-033 | 設定の保存先を統一するか                         | Environmentへ統一し、既存localStorageから一度だけ移行                | 設定のバックアップ・復元・初期化で食い違いが残る                       |
| I-039 | 顔と髪の移動差をどう抑えるか                     | まず顔の曲面量を控えめに調整し、実モデルで比較。共通ワープ化は後段   | 放置は顔のずれ。髪にも一律ワープすると二重変形や毛先の崩れが起こり得る |
| I-042 | ユーザー定義パラメータの追跡割り当て画面を作るか | スタジオ詳細設定に追加。既定マッピングを保持して編集                 | STEP1完成条件14の一部が未達のまま。単純追加では標準の追跡を失う        |
| I-043 | 表情ホットキーを重ね合わせに対応させるか         | カードと同じモードに統一。holdはその操作が加えた表情だけ外す         | 重ねた表情がキー操作で消え、hold後に元の組み合わせに戻らない           |

## I-001 カメラ解像度

**優先度: 高 / 変更規模: 中 / 実機確認が必要**

- **確認できた現状:** 要求は1280×720・30fpsの「優先」で、保証ではない。2026-10-03の記録ではeMeet C980 Proが720pで13fps、480p・1080pで25fps、内蔵カメラが720pで29.5fps。解像度を上げれば必ず遅くなる、下げれば必ず速くなる、という関係でもない。照明・露出の影響は記録上の推測であり、確定原因ではない。
- **決めること:** 手動選択か自動判定か、PC・機器ごとの保存、未対応解像度を選んだときの扱い。カメラ入力の解像度とOBS向け出力1080p60は別設定とする。
- **推奨:** 現行720pを既定として480p・720p・1080pを手動選択可能にする。I-002の「実際に届くfps・解像度」を同時に表示し、低fps時は別設定を案内する。切替は明示操作で行い、失敗時は以前の動作設定へ戻す。保存先はI-033と合わせてEnvironmentへ。
- **代替案と問題:** 現状維持は該当機器の滑らかさを改善できない。全機器を480p固定にすると小さい顔・目の精度に影響する可能性があり、実測が必要。自動切替は暗さ・負荷・顔の未検出との混同、切替中の追跡断、往復切替への対策が必要なため第2段階を推奨。
- **確認観点:** 2機種以上で各解像度の実測fps、顔・目・口の追跡、ミラー、機器変更、再起動、未対応設定からの復帰。基準PCではOBS 1080p60録画中に再計測する。既存の遅延指標は推定開始から描画までで、カメラ内部・OBS録画までの総遅延は含まない。25fpsを得ても「30fps以上」の達成とは扱わない。
- **影響:** カード15の仕様追記、カメラ設定の受け渡し、Environment。TrackingSourceの公開APIを変える場合は契約変更の承認が必要。
- **根拠:** [カメラ要求](C:/Users/hanar/.claude/workspace/2DLiveModelCreaterStudio/packages/tracking/src/source/camera.ts)、[TrackingSource](C:/Users/hanar/.claude/workspace/2DLiveModelCreaterStudio/packages/contracts/src/index.ts)、[既存実機計測](C:/Users/hanar/.claude/workspace/2DLiveModelCreaterStudio/docs/studio-check.md)。

## I-012 PSDの不透明度

**優先度: 高 / 変更規模: 小。ただしI-026と連携**

- **確認できた現状:** 取り込み時にはsourceOpacityを保存しているが、割り当て時は合成モードだけを引き継ぐ。sourceOpacityには親PSDグループの不透明度と塗りの不透明度も含まれる。クリッピング素材は合成済みの画素とクリップ先の不透明度を持つため、二重適用を避ける必要がある。
- **決めること:** 新規パーツの初期表示をPSDに近づけるか、常に不透明100%で始めるか。既存プロジェクト・再読み込みの扱いも区別する。
- **推奨:** **新規割り当て時の画像パーツだけ**にsourceOpacityを引き継ぐ。新設の組み立て用グループは1のままにする。既存パーツやPSD再読み込みでユーザーが調整した不透明度は自動で上書きしない。0%の素材はそのまま取り込み、復元操作はI-026の方針に合わせる。
- **代替案と問題:** 現状維持は影・頬・ハイライトが濃くなり、素材の数だけ手直しが増える。既存モデルにも一律適用すると、現在の見た目と不透明度キーの結果が変わる。なお、これだけでPSDのグループ合成・クリッピングを完全再現できるわけではなく、I-013等は別。
- **確認観点:** 0/50/100%、親グループ50%×子50%、半透明画素、乗算・スクリーン、合成済みクリッピング、単一割り当て・複数素材のグループ化・付け替え。Undo/Redo、保存・再起動、既存モデル非変更、再読み込み非上書き。
- **影響:** 既存のAsset/Part型で対応可能。自動の既存データ移行はしない。
- **根拠:** [PSDの不透明度収集](C:/Users/hanar/.claude/workspace/2DLiveModelCreaterStudio/packages/io/src/import/psd.ts)、[sourceOpacity保存](C:/Users/hanar/.claude/workspace/2DLiveModelCreaterStudio/packages/io/src/import/importer.ts)、[割り当て](C:/Users/hanar/.claude/workspace/2DLiveModelCreaterStudio/apps/desktop/src/modes/modeling/assets/commands.ts)。

## I-014 フォーカスとUndo

**優先度: 中 / 変更規模: 小**

- **確認できた現状:** shellのisTypingTargetがすべてのinputとselectを除外する。さらに、この関数はキャンバスのSpace操作にも使われており、判定を一括で緩めるとUndo以外まで変わる。
- **決めること:** 文書のUndoと入力欄内のUndoの優先順位。数値を入力中・IME変換中にどうするか。
- **推奨:** Undo/Redo専用の判定を用意し、select・range・checkbox等ではプロジェクトのUndo/Redoを通す。text・number・textarea・contenteditableとIME変換中は入力を優先する。Space・矢印・文字のショートカットは従来の保護を維持する。
- **代替案と問題:** 現状維持はツールバーに戻らないと取り消せない。一律にinput/selectを「入力中でない」とすると、スペースで選択・切替したい操作をキャンバスが奪う恐れがある。数値入力でもプロジェクトUndoに統一すると、入力途中の修正と履歴の取り消しが衝突する。
- **確認観点:** 各入力型でCtrl+Z/Ctrl+Y/Ctrl+Shift+Z、ドラッグ中・確定後、入力途中、IME、ダイアログ表示中、contenteditableの子要素。1操作が1回で戻り、スライダーの後続イベントがUndoを取り消さないこと。
- **影響:** 保存形式の変更なし。共通キーボード処理なので、Undo以外の回帰確認が必要。
- **根拠:** [入力判定](C:/Users/hanar/.claude/workspace/2DLiveModelCreaterStudio/apps/desktop/src/shell/keys.ts)、[Undo/Redo処理](C:/Users/hanar/.claude/workspace/2DLiveModelCreaterStudio/apps/desktop/src/shell/Shell.tsx)、[Space操作](C:/Users/hanar/.claude/workspace/2DLiveModelCreaterStudio/apps/desktop/src/shell/canvas/CanvasHost.tsx)。

## I-015 「間を生成」と生成方式

**優先度: 中 / 変更規模: 小**

- **確認できた現状:** generateLinearKeysはgenerationをlinearへ変更する。「間を生成」のdepthもここを通る。一方、regenerateは元の方式を保持し、depthの中間は線形補間できる。現在のUIではdepthも「線形」と表示するため変化が見えにくい。
- **決めること:** 「中間キーを増やす」と「生成方式を切り替える」を同じ操作とみなすか。
- **推奨:** 「間を生成」は既存方式を保持する。生成方式メニューで線形を明示選択した場合だけlinearへ変更する。共用のlinear関数を無条件に変更するのではなく、呼び出し側で操作の意味を分ける。
- **代替案と問題:** 現状維持はdepth由来の情報を意図せず失う。ただし現在のdepthとlinearは中間補間が同じなので、直ちに表示が壊れる問題ではない。「奥行きで作り直す」も引き続き利用可能。逆に全呼び出しで方式を保持すると、明示的な方式変更が効かなくなる。
- **確認観点:** depth→間生成でdepth維持、depth→線形選択でlinear、回転・曲面・なめらかの維持、手動キー・ロックキーの保持、繰り返しても同じ結果、1回のUndo/Redo。
- **影響:** 保存形式は同じ。既にlinearになった既存データを推測でdepthへ戻さない。
- **根拠:** [線形生成](C:/Users/hanar/.claude/workspace/2DLiveModelCreaterStudio/packages/core/src/generate/linear.ts)、[方式を保つ再補間](C:/Users/hanar/.claude/workspace/2DLiveModelCreaterStudio/packages/core/src/generate/regenerate.ts)、[UIからの呼び分け](C:/Users/hanar/.claude/workspace/2DLiveModelCreaterStudio/apps/desktop/src/modes/modeling/parameters/generate.ts)。

## I-019 ロックの対象範囲

**優先度: 中 / 変更規模: 中**

- **確認できた現状:** 軸の値だけで検索するため、FaceAngleX=30の印は(30,-30)・(30,30)等の2軸補正も対象にする。印も全バインディングをまとめ、1つでもロック済みならロック表示になる。既存テストもこの挙動を仕様として固定している。
- **決めること:** 印を「その軸を使う全キーの一括操作」と解釈するか、「1軸キーだけの操作」と解釈するか。
- **推奨:** 1軸スライダーの操作は1パラメータのキーに限定し、2パラメータ補正は方向グリッドのセルまたは明示的な範囲操作でロックする。処理だけでなく、印・ロック状態の表示も同じ対象範囲へそろえる。既存のロック状態は移行時に変えない。
- **代替案と問題:** 現状の一括方式は操作数が少ないが、他のY値で直した補正を見ずに解除する危険がある。一括方式を選ぶなら、操作名と対象件数・補正を含むことを明示する必要がある。1軸だけへ狭めてグリッド側の操作を用意しないと、補正キーのロックを変更できなくなる。
- **確認観点:** 同じXの異なるY、parameterIdsの逆順、ロック状態が混在する位置、範囲端、対象外のキー非変更、グリッド単独操作、Undo/Redo、ロック後の再生成。
- **影響:** データ形式変更なし。関連UIと現状を固定するテストの変更が必要。
- **根拠:** [setKeysLocked/isLockedAt](C:/Users/hanar/.claude/workspace/2DLiveModelCreaterStudio/apps/desktop/src/modes/modeling/parameters/generate.ts)、[印の集約](C:/Users/hanar/.claude/workspace/2DLiveModelCreaterStudio/apps/desktop/src/modes/modeling/parameters/marks.ts)、[現行ロックのテスト](C:/Users/hanar/.claude/workspace/2DLiveModelCreaterStudio/apps/desktop/src/modes/modeling/parameters/generate.test.ts)。

## I-026 不透明度0からの復元

**優先度: 高 / 変更規模: 中。全面的な方式変更なら大**

- **確認できた現状:** 編集は「現在のキー倍率×変更倍率」、描画は「親の不透明度×Part.opacity×キーの合成倍率」。キー倍率が0でも基準Part.opacityが0でも掛け算では戻せない。UIは0.001で回避するが、本当の透明0ではない。さらにデフォルト座標では常に基準値を編集するため、頬のデフォルト位置の0.001キーを編集できないI-038が残る。
- **決めること:** (A) キー倍率0の復元、(B) 基準Part.opacity=0のままキーで表示、(C) 親が0でも子だけ表示、を分ける。A/Bは別問題であり、Cは階層の不透明度を無視する別仕様。
- **推奨:** **段階対応**。まずキー倍率を直接指定できる編集APIを追加してAとI-038を直し、0.001回避を新規編集から外す。既存の0.001は勝手に0へ丸めない。Bは基準不透明度を明示操作で上げてからキーを編集する仕様を当面維持し、他のキーへの影響を確認させる。基準値とデフォルト座標のキーを区別して編集できるようにする。Cは変更しない。
- **残る制約:** この推奨は「基準0のままキーだけで表示」を可能にするものではない。その要件が必須なら、独立した絶対不透明度チャンネル等を別途設計し、複数パラメータ・親子合成・既存モデルの互換性を決めてから実装する。
- **代替案と問題:** 現状維持では真の0から戻せず薄く残る可能性がある。TransformChangeに絶対値引数を足すだけではBは解決しない。Part.opacityを自動で1にすると全キーの見た目に影響する。保存データのopacityをいきなり絶対値へ読み替えると既存モデルが壊れる。
- **確認観点:** キー1→0→1、既存の厳密な0、基準0、親0、基準50%、複数バインディング、Cheekのデフォルト位置、複数選択、補間、保存・再起動、Undo/Redo。表示値が「当該キーの値」か「親を含む最終表示」かも区別する。
- **影響:** KeyEditorの契約変更が必要。全面的な絶対値方式を選ぶ場合はSchema・Evaluator・Pipeline・補間・移行まで拡大。I-012・I-038と一緒に受け入れ確認する。
- **根拠:** [不透明度UIの計算](C:/Users/hanar/.claude/workspace/2DLiveModelCreaterStudio/apps/desktop/src/modes/modeling/opacity/opacityKey.ts)、[キーの乗算編集](C:/Users/hanar/.claude/workspace/2DLiveModelCreaterStudio/apps/desktop/src/services/keyEditor/transform.ts)、[デフォルト座標の扱い](C:/Users/hanar/.claude/workspace/2DLiveModelCreaterStudio/apps/desktop/src/services/keyEditor/common.ts)、[階層の不透明度](C:/Users/hanar/.claude/workspace/2DLiveModelCreaterStudio/packages/core/src/deform/pipeline.ts)。

## I-028 複数パラメータのプレビュー

**優先度: 中 / 変更規模: 中から大**

- **確認できた現状:** 未選択行のスライダーを動かすとactiveParameterIdsをその1つにし、editorParamValuesをその値だけに置き換える。これは誤って基準状態を編集しないための既存設計。キー編集は最大2軸だが、プレビュー値はそれ以上の組み合わせを持てる。
- **決めること:** 同じスライダーに「キー編集の対象選択」と「見た目だけの確認」を兼用させるか。
- **推奨:** キー編集と複数パラメータのプレビューを明確に分ける。キー編集は現行の対象を絞る動作を維持し、プレビューでは複数値を保持して一括リセット可能にする。プレビュー中はパーツ移動・頂点・ワープ等のモデル編集を無効化し、編集対象を決めて戻る操作を用意する。I-029の対策を同時に行う。
- **代替案と問題:** 現状維持は安全寄りで、当面は表情専用スライダーで回避できるが、組み合わせ検証の往復が増える。単に他の値を残す修正は、見えている状態と書き込まれる基準・キーがずれる。任意の数のパラメータを同時にキー編集させる案は現在の最大2軸の契約を超える。
- **確認観点:** 顔X＋顔Y＋笑顔の組み合わせ、1軸/2軸編集への復帰、既定値へのリセット、非既定値で基準状態を誤編集しないこと、表情作成・方向グリッドとの往復、Undo/Redo、プレビューだけでモデルが変更済みにならないこと。
- **影響:** EditorState/UIの状態設計と編集ツールのガード。保存モデルの多次元化は今回の推奨に含めない。
- **根拠:** [スライダーと編集対象](C:/Users/hanar/.claude/workspace/2DLiveModelCreaterStudio/apps/desktop/src/modes/modeling/parameters/ParameterPanel.tsx)、[最大2軸と基準状態判定](C:/Users/hanar/.claude/workspace/2DLiveModelCreaterStudio/apps/desktop/src/services/keyEditor/common.ts)、[I-029](C:/Users/hanar/.claude/workspace/2DLiveModelCreaterStudio/docs/issues.md)。

## I-030 見失ったときのまばたき

**優先度: 高 / 変更規模: 中 / 実機確認が必要**

- **確認できた現状:** lost時に自動まばたきの値は生成するが、顔の角度と同じtrackingレイヤーのweightで薄められる。正面復帰では最終検出から0.5秒待機＋1秒でweightが0になるため、最終表示の目が既定値へ戻る。既存テストの多くはレイヤー内のvaluesを確認しており、値が出ているだけでは最終描画のまばたきを保証しない。
- **決めること:** 見失う・目追跡OFF・一度も検出していない・追跡を停止した、の各状態で自動まばたきを続けるか。
- **推奨:** 顔の追跡が使えないときも自然なまばたきを継続する。顔の正面復帰と目のフォールバックを独立させ、表情・アニメーションより前のtracking段で目だけを補う。既存の同じIDの複数レイヤー合成が利用できるため、まず新しいLayerIdを増やさずに組み立てられるか検討する。共通tick()契約を変更する場合は別途承認する。
- **代替案と問題:** 現状維持は顔を外した途端に生気のない表示になる。「最後の姿勢を保持」を選ぶ回避策は顔が正面へ戻らない。tracking全体のweightを1に固定するだけでは、顔の正面復帰を壊す。目の補正を表情の後に置くとウィンクや閉じ目を上書きしてしまう。
- **確認観点:** 検出→見失い3秒以上→再検出、目追跡OFF、最初から顔なし、停止/再開、カメラ遮蔽、returnToFront/hold両方。Mixerを通した最終EyeOpen値と実表示を確認し、表情の閉じ目・アニメーションの目を壊さないこと。
- **影響:** トラッキングとスタジオの責務分担。モデルの保存形式変更は不要。
- **根拠:** [まばたきと共通weight](C:/Users/hanar/.claude/workspace/2DLiveModelCreaterStudio/packages/tracking/src/mapping/producer.ts)、[見失い時の時間](C:/Users/hanar/.claude/workspace/2DLiveModelCreaterStudio/packages/tracking/src/mapping/lostWeight.ts)、[合成順序](C:/Users/hanar/.claude/workspace/2DLiveModelCreaterStudio/packages/core/src/mix/mixer.ts)、[現在のテスト](C:/Users/hanar/.claude/workspace/2DLiveModelCreaterStudio/packages/tracking/src/mapping/producer.step1.test.ts)。

## I-033 設定の保存先

**優先度: 高 / 変更規模: 中**

- **確認できた現状:** 体の強さ、目追跡ON/OFF、カスタム調整値が個別localStorageにある。STEP2の表情カードのstack/singleも同じ方式。プリセット名だけEnvironmentに保存しているため、environment.jsonだけを移すとcustomの中身が欠ける。
- **決めること:** PC設定を単一のEnvironmentとして管理するか、分散保存を仕様として維持するか。プロジェクト固有の追跡マッピングとは分ける。
- **推奨:** Environmentへ集約する。既存Environmentに項目があればそれを優先し、無ければ有効な旧localStorage値を一度だけ取り込み、どちらも無ければ既定値にする。新しい保存の成功が確認できる前に旧値を削除しない。移行済みの印・旧キーの後処理により、設定初期化後に古い値が復活しないようにする。表情モードとI-001の解像度も同じルールへそろえる。
- **代替案と問題:** 分散保存を続けるなら、バックアップ・初期化がすべての保存先を扱う必要がある。プロジェクトへ保存すると別PCにカメラや利用者の調整値まで持ち込む。一括読込で1項目が壊れただけで全設定を既定値へ戻す現在のパース方針にも注意し、新項目単位で検証・既定値補完する。
- **確認観点:** 旧版データのみ/新旧両方/破損値/項目欠落、保存失敗、2回目の起動、初期化、バックアップ復元、遅い読み込み中の操作。I-025の「起動直後の変更を上書きしない」保証を維持する。実Tauriのenvironment.jsonとブラウザ開発用保存を両方確認する。
- **影響:** Environment型・バリデータ・既定値・読込/保存の契約変更。既存プロジェクト形式は変更しない。契約変更記録が必要。
- **根拠:** [Environment](C:/Users/hanar/.claude/workspace/2DLiveModelCreaterStudio/packages/schema/src/types.ts)、[読込・保存](C:/Users/hanar/.claude/workspace/2DLiveModelCreaterStudio/apps/desktop/src/shell/environment.ts)、[目とカスタム値](C:/Users/hanar/.claude/workspace/2DLiveModelCreaterStudio/apps/desktop/src/modes/studio/calibration/options.ts)、[体の強さ](C:/Users/hanar/.claude/workspace/2DLiveModelCreaterStudio/apps/desktop/src/modes/studio/producers/bodyFollow.ts)、[表情モード](C:/Users/hanar/.claude/workspace/2DLiveModelCreaterStudio/apps/desktop/src/modes/studio/expressions/binding.ts)。

## I-039 顔と髪の動きのずれ

**優先度: 高 / 変更規模: 調整なら中、共通ワープ化なら大 / 目視判断が必要**

- **確認できた現状:** 顔の曲面はワープの大きさ×0.6を半径に最大20度で動き、髪は顔幅・奥行きによる視差で動く。基準の寸法と移動式が異なる。課題記録ではsample-modelの顔中央約117pxに対し前髪36.8px。今回その数値の再計測はしていない。
- **決めること:** 当面の自動セットアップを破綻しにくい控えめな動きへ寄せるか、頭部全体を共通の変形構造に組み直すか。
- **推奨:** まず顔の曲面量を抑える比較案を作り、sample-model・reference-model・実利用モデルで左右/上下/斜めを見て決める。**20度から何度へ変えるかはまだ決めない。** 推奨する変更対象は新規生成または明示的な再生成とし、既存の手動キー・ロックキーを自動で作り直さない。軸方向と斜め補正の定数・計算はそろえる。
- **代替案と問題:** 放置は顔と髪のずれを残す。単純に髪にも同じ球面を重ねると、既存の奥行き・親子変形・物理揺れと二重になり得る。共通の頭ワープは長期案として有力だが、部品構造・後ろ髪・耳・マスク・物理の検証が増える。曲面量を抑える案にも、立体感が弱くなるという代償がある。
- **確認観点:** X/Yそれぞれ-30/0/30と斜め4方向、変化途中、前髪・横髪・後ろ髪・耳、まばたき、口、物理ON/OFF、マスク。顔幅や絵柄の異なるモデルで、接合部の隙間と見た目の自然さを比較する。数値の移動量だけを一致させても自然さの証明にはならない。
- **影響:** カード31/42の定数・自動生成方針。共通ワープ案を採るなら、既存構造の変換と戻せる操作を追加設計する。
- **根拠:** [球面の定数・1軸生成](C:/Users/hanar/.claude/workspace/2DLiveModelCreaterStudio/packages/core/src/generate/surface.ts)、[顔グループと斜め補正](C:/Users/hanar/.claude/workspace/2DLiveModelCreaterStudio/packages/core/src/setup/faceTurn.ts)、[髪などの奥行き生成](C:/Users/hanar/.claude/workspace/2DLiveModelCreaterStudio/packages/core/src/generate/depth.ts)、[既存の移動量の記録](C:/Users/hanar/.claude/workspace/2DLiveModelCreaterStudio/docs/issues.md)。

## I-042 ユーザーパラメータへの追跡割り当て

**優先度: 高 / 変更規模: 中**

- **確認できた現状:** 保存型と実行処理はあるがUIがない。**trackingMappingsが空なら既定一覧、1件でもあればその一覧だけを使う**ため、ユーザー割り当て1件だけを保存すると既定の顔・目・口が外れる。同じ出力パラメータが複数行にあると、現在は後の行の値が上書きする。
- **決めること:** STEP1完成条件14を満たす追加カードを作るか、完成条件から明示的に延期するか。入力・出力の組み合わせと重複ルールも決める。
- **推奨:** スタジオの詳細設定にマッピング編集画面を追加する。初回編集時は既定一覧を実体化して保持し、そこへユーザー定義パラメータの割り当てを追加する。同じ入力を複数出力へ使うのは許し、同じ出力への複数割り当ては初版では禁止する。入力、出力パラメータ、入出力範囲、反転、スムージングを編集でき、curve/deadZoneは詳細項目として既存値を保持する。
- **代替案と問題:** UIを作らない場合はJSON編集に依存し、現行の完成条件を満たさない。常に既定一覧へ暗黙追加するランタイムに変える案は、既存のカスタム一覧の「意図的に標準追跡を外す」意味を変える。空配列で全追跡を無効にするUIも、現状では既定に戻るため作れない。初版では空を「標準に戻す」とし、全無効化は既存の追跡停止で扱う。
- **確認観点:** 1件追加しても既定追跡が維持される、保存/読込、Undo/Redo、パラメータ削除時の解除、重複出力、ゼロ幅/不正な範囲、反転とミラーの組み合わせ、対象のmin/maxでの丸め、既定復元。アニメーション・表情・物理に上書きされる場合も入力不良と混同しないよう確認する。
- **影響:** 既存Project.trackingMappingsを使用でき、初版の方針なら保存型変更は不要。設計カードと受け入れ項目の追加が必要。PC設定ではなくプロジェクトへ保存する。
- **根拠:** [TrackingMapping](C:/Users/hanar/.claude/workspace/2DLiveModelCreaterStudio/packages/schema/src/types.ts)、[既定一覧](C:/Users/hanar/.claude/workspace/2DLiveModelCreaterStudio/packages/tracking/src/mapping/defaults.ts)、[空配列・上書きの実行規則](C:/Users/hanar/.claude/workspace/2DLiveModelCreaterStudio/packages/tracking/src/mapping/producer.ts)、[設定変更の反映](C:/Users/hanar/.claude/workspace/2DLiveModelCreaterStudio/apps/desktop/src/services/trackingLayer.ts)、[完成条件14](C:/Users/hanar/.claude/workspace/2DLiveModelCreaterStudio/docs/acceptance-step1.md)。

## I-043 表情のホットキー

**優先度: 高 / 変更規模: 中。複数holdの状態管理まで含める**

- **確認できた現状:** カードはstack/singleを選べるが、ホットキーは常に単一適用のapplyを呼ぶ。active()は最後の1件なので、holdが覚えるのも最後の1件だけ。重ねた一覧を維持・復元する情報が足りない。
- **決めること:** カードと同じモードを使うか、ホットキー専用モードを設けるか。toggle、hold、対象nullの全解除を別々に定義する。
- **推奨:** カードと同じ表情操作モードへ統一する。stackのtoggleは対象だけ追加/解除。stackのholdは押下中だけ対象を追加し、離したら**そのholdが追加した分だけ**外す。元から有効な表情や、途中のカード操作で有効にした表情は消さない。同じ対象の複数holdは所有者・参照数を管理する。
- **singleと全解除:** singleは単独切替を維持する。singleのholdや対象nullの一時全解除は、直前の表情一覧と順序を保持し、押下後に別操作で状態が変わった場合は古い一覧を復元しない。シーン切替・プロジェクト変更・割り当て削除・キー解放を取りこぼした場合も一時状態を片付ける。
- **代替案と問題:** 常にstackなら実装が単純になる一方、singleを選んだカードと挙動が違う。ホットキーごとにモードを増やすと柔軟だが設定と保存型の変更が増える。現状維持は配信中に複数表情が意図せず消える。配列を丸ごと復元するだけの修正は、hold中の別操作を巻き戻してしまう。
- **確認観点:** A+B適用後のA/B/Cのtoggle、Cのhold解放でA+B維持、元から有効なAのhold、同じ/異なる対象の同時hold、押下・解放順序、キーリピート、hold中のカード操作・モード変更・シーン変更、全解除、フェード途中。実OSホットキーで別アプリ前面・フォーカス喪失も確認する。
- **影響:** 表情Controllerにはtoggle/activesが既にある。共有操作処理と一時状態管理の追加が中心。保存するモードはI-033と統一し、旧版の単独切替を好む利用者がsingleを選べるようにする。
- **根拠:** [単一表情のホットキー](C:/Users/hanar/.claude/workspace/2DLiveModelCreaterStudio/apps/desktop/src/hotkeys/actions.ts)、[カードのモード](C:/Users/hanar/.claude/workspace/2DLiveModelCreaterStudio/apps/desktop/src/modes/studio/expressions/binding.ts)、[複数表情Controller](C:/Users/hanar/.claude/workspace/2DLiveModelCreaterStudio/packages/core/src/layers/expression.ts)、[現行ホットキーテスト](C:/Users/hanar/.claude/workspace/2DLiveModelCreaterStudio/apps/desktop/src/hotkeys/actions.test.ts)。

## 推奨する決定・実装順

1. **範囲を限定して先に決める:** I-014、I-015、I-012。既存データの自動書き換えを避けて、操作と初期表示を改善する。
2. **保存・機器設定をまとめる:** I-033 → I-001。表情モードも同じ移行ルールへ入れる。
3. **制作・配信の支障を解消する:** I-026＋I-038、I-030、I-043。I-026の「基準0は別操作」という残存制約は明示して承認する。
4. **完成条件と操作範囲を整備する:** I-042、I-019、I-028＋I-029。I-029の誤編集防止は、I-028を延期しても先行してよい。
5. **目視比較を経て確定する:** I-039。比較案の作成は他項目と並行できるが、既存モデルへの一括適用はしない。

「12件すべて修正する」と一括で決めるより、**上表の推奨範囲を採用するか**を決めるのが安全。特にI-026の全面的な絶対値方式、I-039の共通ワープ化、I-001の自動解像度切替は別の拡張案であり、上表の採用だけでは実装対象に含めない。

公開契約を変えるものは [契約変更記録](C:/Users/hanar/.claude/workspace/2DLiveModelCreaterStudio/docs/contract-changes.md) の手順に従い、承認後に型・影響範囲・移行方法を記録する。既存の実機計測は参考資料であり、新しい仕様の合格判定には再確認が必要。
