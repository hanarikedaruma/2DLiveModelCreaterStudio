# 立ち絵から取り込み用パーツを生成するプロンプト集

**まずキャラクターの立ち絵を1枚作成し、デザインと配置を確定してから、その立ち絵を参照して素材を生成する。** パーツごとに別のキャラクターを新しく描かせない。

通常の割り当て枠に対応する 32 種類と、胸揺れ用の追加素材 1 種類について、画像生成AIで **1パーツ = 1枚の別々の画像** として作るためのプロンプトを用意している。目・口の「まとめて」版は分割版の代わりに使うので、33枚すべてを同じモデルに使うわけではない。
パーツの種類・左右・描画順・動き方は、このツールの実装（`packages/schema/src/rules.ts`、`packages/core/src/setup/motions.ts`、`apps/desktop/src/modes/modeling/assets/slots.ts`、`packages/io/src/import/importer.ts`）に合わせてある。

**使い方:** 2章の「キャラクター情報の入力欄」を埋め、立ち絵を作成・確定する。その後は2章の「素材を生成する順番」に沿って4章のプロンプトを使い、5章の確認、7章の取り込み・動作確認・保存まで進める。AIに順番の案内も任せる場合は、このファイルと入力済みの情報を「進行用プロンプト」と一緒に渡す。

## 1. 前提（このツールの取り込みの仕様）

- **1パーツ = 1枚の PNG（背景は透明）。** PNG は1ファイルが1素材になる。透明な余白はツールが自動で切り落とし、元の位置は保たれる。
- **全部の画像を同じキャンバスサイズにし、キャラクターを同じ位置に置く。** 大きさが最初のファイルと違う PNG は左上 (0, 0) に置かれ、「大きさが違う」警告が出る。
- キャンバスの長辺は 1000〜8000px（範囲外は警告）。下のプロンプトは 1024×1536（縦長 2:3）を例にしている。
- 背景が塗られていると「透明な部分がほとんど無い」警告が出る。背景は必ず抜く。
- **L はキャラクター自身の左 = 画面の右。** R は画面の左。割り当て画面の「左目」もキャラ自身の左目（画面の右）。
- パーツどうしは別々に動くので、**ほかのパーツに隠れている部分も描き足す**（額・耳の付け根・首の上端・後ろ髪の内側・腕の付け根など）。描き足しが無いと、動かしたときに穴や隙間が見える。
- 割り当ては手動（割り当て画面の各枠に入れる）。パーツ名はファイル名になるので、ファイル名を下の表の `ファイル名` にしておくと迷わない。
- 「まとめて」版（目・口を1枚で作るもの）は簡易版。細かいパーツと**同時には割り当てない**。細かいパーツで作る場合は不要。
- 「体の変形」「頭の変形」「目の変形」などの変形グループは、画像素材ではないので生成しない。リボン・髪飾りなどを別に動かしたい場合は、追加の透明 PNG を作り、「その他」の自由パーツとして取り込む。

## 2. 進め方

1. **キャラクター情報を入力する。** この章の入力欄を埋める。目・口の分け方、胸揺れの有無、生成を省略する素材もここで決める。指定がなければ目・口は分割版、胸揺れはなしで進める。
2. **最初に立ち絵を1枚生成する**（3章）。正面で左右対称の姿勢を取り、目を開けて口を閉じた絵を作る。左右で違う装飾など、デザイン上の非対称は保持する。このプロンプト集では、頭から太もも付近までを描き、両手と髪の先まで入れる。
3. **立ち絵を確定し、`reference.png` として保存する。** デザイン、ポーズ、表情、キャンバスサイズ、キャラクターの配置を確認し、必要な修正をここで終える。この立ち絵が全素材の基準画像になる。**立ち絵が完成するまでは、パーツの生成を始めない。**
4. **確定した立ち絵から、パーツを1枚ずつ生成する。** この章の「素材を生成する順番」に従い、4章の該当するプロンプトを使う。生成AIの「画像を添付して編集する」機能で、**毎回同じ `reference.png` を添付**して、1回の生成で1パーツだけを出す。
   - 4章のプロンプトは、前半の共通ルールと後半のパーツ別の指示をまとめて1つにしてある。コードブロックをそのまま貼る。
   - 同じ会話で続ける場合も、立ち絵を添付する。生成済みのパーツ画像を、次の素材の基準画像にしない。
   - 出力は表のファイル名で保存する。一覧画像やスプライトシートにはまとめない。
   - 目・口は分割版か「まとめて」版のどちらかを選ぶ。胸揺れを使う場合だけ `chest.png` も生成する。
5. **ずれと塗り足しを確かめる。** 画像編集ソフト（Krita・GIMP・Photoshop など）で立ち絵の上に重ね、位置・大きさ・色が合っているか、キャンバスサイズが同じか、隠れた部分も描けているかを確かめる。生成AIへの指示だけで位置や透過がそろうとは限らないので、合わない画像は調整する。
6. **取り込み・動作確認・保存まで行う**（7章）。パーツの PNG を読み込んで割り当て、「かんたんセットアップ」で動きを付け、確認してプロジェクトを保存する。`reference.png` は確認用として別に保管する。

### キャラクター情報の入力欄

以下をコピーして埋める。日本語でよい。角括弧の説明を自分の情報に置き換え、不要な項目は「なし」とする。幅・高さは例のままでも使える。

```text
キャラクター名：[名前]
外見：[年齢感、性別表現、体格、顔立ち]
髪：[髪色、前髪の形、横髪の形、後ろ髪の長さと形]
目：[目の形、瞳の色、ハイライトの形]
肌：[肌色]
衣装：[服の形、色、襟ぐり、袖、模様]
装飾・非対称の特徴：[髪飾り、左右で違う色など。なければ「なし」]
絵柄：[例：アニメ調、明瞭な線画、フラットな色、1〜2段階の影]
キャンバス幅：1024
キャンバス高さ：1536
目の分け方：分割
口の分け方：分割
胸揺れ：なし
省略する標準素材：[例：cheek.png、横髪のないデザインなら sideHairL.png と sideHairR.png。なければ「なし」]
追加する素材：[別に動かす髪飾りなどの名前・ファイル名・位置。なければ「なし」]
```

手動で3章の立ち絵用プロンプトを使う場合は、次のように差し替える。

- `[CHARACTER]`: 入力した名前・外見・髪・目・肌・衣装・装飾を、ひとまとまりの説明として貼る。
- `[STYLE]`: 入力した絵柄を貼る。
- `[CANVAS_WIDTH]` / `[CANVAS_HEIGHT]`: 入力した幅・高さの数値を貼る。
- 目・口の分け方、胸揺れ、省略・追加の指定は、下の生成順と生成対象に反映する。

立ち絵の構図は頭から太もも付近まで。前髪が目を完全に隠すなど、入力したデザインとパーツ分けの条件が両立しない場合は、立ち絵を作る前に調整方針を決める。キャラクターの髪型・衣装・絵柄を、例のデザインへ勝手に置き換えない。

髪飾りなどの装飾を指定した場合は、「追加する素材」にも名前・ファイル名・位置を書く。例: `髪飾り、hairAccessory.png、キャラクター自身の左のこめかみ（画面の右）`。

### AIに順番を案内させる進行用プロンプト

このファイルをAIに添付するか、内容を貼り付けてから、次のコードブロックを送る。末尾に入力済みのキャラクター情報を貼る。途中から再開するときは、確定した立ち絵と生成済みファイルの一覧も渡す。

```text
添付した「立ち絵から取り込み用パーツを生成するプロンプト集」に従い、以下のキャラクター情報を使って、立ち絵の作成から素材生成、ツールへの取り込み、動作確認、保存まで順番に案内してください。

進め方：
1. キャラクター情報から、立ち絵プロンプトの [CHARACTER]、[STYLE]、[CANVAS_WIDTH]、[CANVAS_HEIGHT] を埋めてください。髪型・衣装・色・装飾・絵柄を保持し、例のキャラクターに置き換えないでください。作成に必要な情報が欠けている場合や、デザインと分離条件が両立しない場合だけ確認してください。
2. 目・口の分け方、胸揺れの有無、省略・追加の指定を反映し、2章の「素材を生成する順番」から、今回生成するファイルの一覧を先に示してください。同じ部位に分割版と「まとめて」版を重複させないでください。目と口はそれぞれ方式を選べます。指定がなければ目・口は分割版、胸揺れはなしです。
3. 最初にキャラクター全体の立ち絵を1枚だけ作ってください。立ち絵が確定するまではパーツを生成しないでください。修正希望を反映し、私が「この立ち絵で確定」と伝えた画像を reference.png として以後の基準にしてください。
4. 確定後は、一覧の順番で4章の該当プロンプトを使い、1回につき1素材だけを生成してください。毎回同じ確定済みの立ち絵を参照し、キャンバス、配置、大きさ、色、絵柄を固定してください。存在しない髪や装飾を新しく追加しないでください。追加素材は4章末尾のテンプレートを使ってください。
5. 各出力について保存するファイル名を明記し、完了済み・修正待ち・省略したファイルと理由・次に生成するファイルを更新してください。画像を表示しただけで保存済みとは扱わず、保存を案内してください。修正が必要な素材は同じファイル名の素材として直してください。
6. 画像生成が使えない場合は、今の工程で使う、情報を埋めた完成済みプロンプトを1件ずつ提示してください。参照画像が必要な工程では、その画像を受け取ってから続けてください。
7. 全対象の出力がそろったら5章の取り込み前の確認を案内し、7章に従って取り込み、割り当て、かんたんセットアップ、動作確認、保存まで進めてください。実際に確認できていない透過、画像サイズ、ファイル保存、アプリ操作を「確認済み」とは扱わず、残る確認方法を示してください。

今回のキャラクター情報：
[ここに入力済みの「キャラクター情報の入力欄」を貼る]
```

### 素材を生成する順番

**立ち絵の確定後に、下の順で進める。** 4章の素材番号は割り当て画面の並びであり、生成順ではない。生成時はこの表のファイル名で該当するプロンプトを探す。省略する素材を除き、1つずつ保存して次へ進む。

| 順番 | 工程                     | 生成するファイル（左から順に）                                                                                        | 次へ進む条件                                                     |
| ---- | ------------------------ | --------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| 1    | 顔の土台                 | `face.png` → `earL.png` → `earR.png` → `cheek.png`                                                                    | 顔に目・眉・口・髪を焼き込まず、耳の付け根を描き足した           |
| 2    | 体                       | `neck.png` → `torso.png` → `armL.png` → `armR.png`                                                                    | 首・肩・腕の重なりを描き足した。胸を分ける場合も胴体の下地がある |
| 3    | 髪                       | `backHair.png` → `frontHair.png` → `sideHairL.png` → `sideHairR.png`                                                  | デザインにある髪だけを生成し、顔の後ろと髪の付け根が埋まっている |
| 4    | 眉                       | `browL.png` → `browR.png`                                                                                             | 左右と位置が立ち絵に合っている                                   |
| 5    | 左目                     | 分割: `eyeWhiteL.png` → `irisL.png` → `highlightL.png` → `upperLidL.png` → `lowerLidL.png`／まとめて: `eyeWholeL.png` | 分割とまとめてのどちらかだけがそろった                           |
| 6    | 右目                     | 分割: `eyeWhiteR.png` → `irisR.png` → `highlightR.png` → `upperLidR.png` → `lowerLidR.png`／まとめて: `eyeWholeR.png` | 左目と同じ方式で、左右を間違えていない                           |
| 7    | 口                       | 分割: `mouthInside.png` → `teeth.png` → `tongue.png` → `upperLip.png` → `lowerLip.png`／まとめて: `mouthWhole.png`    | 分割では口の中の幅・位置がそろい、閉じた状態で唇が口の中を隠す   |
| 8    | 胸（使う場合だけ）       | `chest.png`                                                                                                           | 衣装を保持し、胴体に重ねると元の立ち絵に合う                     |
| 9    | 追加素材（ある場合だけ） | 入力欄で指定したファイル名                                                                                            | 1ファイルに1素材で、立ち絵と同じ配置になっている                 |

省略なしの場合、目・口とも分割版なら通常29枚、どちらもまとめて版なら通常17枚。胸揺れを使う場合は1枚、追加素材は指定した枚数を加える。立ち絵で口を閉じていても、分割版の `mouthInside.png` は生成する。歯・舌などの任意素材を省略したら、その理由も記録する。

素材の生成が終わったら5章へ進み、問題があるものは6章を使って修正する。その後7章で取り込み・動作確認・保存を行う。

### 透明背景を出せない生成AIの場合

共通ルールの2行目（`Draw ONLY the part ...`）を次に差し替え、生成後に画像編集ソフトの「色を透明に」で背景色を抜く。キャラに緑を使っている場合は `#00FF00` を `#FF00FF`（マゼンタ）に変える。

```text
- Draw ONLY the part described below, on a flat solid #00FF00 green background (one uniform color, no gradient, no shadow, no texture). No checkerboard pattern, no frame, no text or labels.
```

## 3. 最初に作る立ち絵（基準画像）

### キャラクター設定 `[CHARACTER]` の例

2章の入力欄からキャラクターの説明を作る。以下は記入例であり、髪型・衣装をこの例にそろえる必要はない。目や口を隠さず、髪・耳・首・衣装の境界が見えるデザインは分けやすい。

```text
An anime girl around 17 years old. Medium-long chestnut-brown hair with straight-cut bangs and one long side lock in front of each ear. Large blue eyes. Light skin. Wearing a simple light-blue short-sleeved dress with a round neckline.
```

### 立ち絵を生成するプロンプト

`[CHARACTER]`、`[STYLE]`、`[CANVAS_WIDTH]`、`[CANVAS_HEIGHT]` を2章の入力内容に置き換えて使う。角括弧が残っていないことを確認して送る。ここではキャラクター全体の立ち絵を1枚作り、パーツ分けは次の工程で行う。

```text
First create ONE standing character reference illustration for a layered 2D animation model (Live2D-style rig). This standing illustration must be finalized BEFORE generating any separate part images. It will be used as the same reference for every part, so the design must be clean and easy to separate. Do not generate separate parts, multiple views, a character sheet or a sprite sheet at this stage.

Character: [CHARACTER]

Pose and expression:
- Perfectly front-facing with a symmetrical neutral pose, head upright with no tilt, looking straight at the viewer. Preserve any asymmetric design details specified in Character.
- Standing upright in a relaxed neutral pose, with the shoulders and hips level.
- Neutral calm expression, both eyes fully open, mouth closed (a simple short line), eyebrows relaxed.
- Arms relaxed and hanging straight down, slightly away from the body so there is a small gap between the arms and the torso. Both hands visible and open.
- Keep both ears visible when consistent with the specified design.

Framing:
- Exact canvas size: [CANVAS_WIDTH]x[CANVAS_HEIGHT] pixels. From the top of the head down to the upper thighs, far enough to include both hands completely.
- Character centered horizontally, with about 5-10% clear space above the hair. Keep all hair tips, both arms, both hands and all fingertips inside the canvas; the body continues to the bottom edge.

Design constraints (for easy part separation):
- Preserve the specified hairstyle, hair length, clothes, accessories, colors and asymmetric details. Do not substitute the example character or invent side locks, long back hair or accessories that were not specified.
- Keep the boundaries between hair, face, ears, neck and clothes clear. Keep the eyes and mouth unobstructed, using the separation adjustments agreed before generation if needed.
- No hands touching the face; nothing held in the hands unless explicitly included in Character and planned as an additional separate part.

Style: [STYLE]. Use clean boundaries and consistent lighting so parts can be separated. No motion blur, no depth of field, no text, no watermark.
Background: transparent (or flat plain white).
Output: ONE PNG image of the standing character, to be saved as reference.png.
```

## 4. パーツ別のプロンプト

**3章の立ち絵を先に作成・確定してから使う。** 各コードブロックは、立ち絵を添付してそのまま送れる1素材分のプロンプトになっている。

★ はツールの割り当て画面で推奨になっているパーツ。1〜32の並びは割り当て画面と同じ。33は胸揺れ用の追加素材。

| #   | ファイル名        | パーツ          | 画面上の位置 | 備考               |
| --- | ----------------- | --------------- | ------------ | ------------------ |
| 1   | `face.png`        | 顔              | 中央         |                    |
| 2   | `earL.png`        | 耳 L            | 画面の右     |                    |
| 3   | `earR.png`        | 耳 R            | 画面の左     |                    |
| 4   | `cheek.png`       | 頬染め          | 中央         |                    |
| 5   | `eyeWhiteL.png`   | 白目 L          | 画面の右     | ★                  |
| 6   | `irisL.png`       | 瞳 L            | 画面の右     | ★                  |
| 7   | `highlightL.png`  | ハイライト L    | 画面の右     |                    |
| 8   | `upperLidL.png`   | 上まぶた L      | 画面の右     | ★                  |
| 9   | `lowerLidL.png`   | 下まぶた L      | 画面の右     |                    |
| 10  | `eyeWholeL.png`   | 目（まとめて）L | 画面の右     | まとめて版（任意） |
| 11  | `eyeWhiteR.png`   | 白目 R          | 画面の左     | ★                  |
| 12  | `irisR.png`       | 瞳 R            | 画面の左     | ★                  |
| 13  | `highlightR.png`  | ハイライト R    | 画面の左     |                    |
| 14  | `upperLidR.png`   | 上まぶた R      | 画面の左     | ★                  |
| 15  | `lowerLidR.png`   | 下まぶた R      | 画面の左     |                    |
| 16  | `eyeWholeR.png`   | 目（まとめて）R | 画面の左     | まとめて版（任意） |
| 17  | `browL.png`       | 眉 L            | 画面の右     |                    |
| 18  | `browR.png`       | 眉 R            | 画面の左     |                    |
| 19  | `upperLip.png`    | 上唇            | 中央         | ★                  |
| 20  | `lowerLip.png`    | 下唇            | 中央         | ★                  |
| 21  | `mouthInside.png` | 口の中          | 中央         | ★                  |
| 22  | `teeth.png`       | 歯              | 中央         |                    |
| 23  | `tongue.png`      | 舌              | 中央         |                    |
| 24  | `mouthWhole.png`  | 口（まとめて）  | 中央         | まとめて版（任意） |
| 25  | `frontHair.png`   | 前髪            | 中央         |                    |
| 26  | `sideHairL.png`   | 横髪 L          | 画面の右     |                    |
| 27  | `sideHairR.png`   | 横髪 R          | 画面の左     |                    |
| 28  | `backHair.png`    | 後ろ髪          | 中央         |                    |
| 29  | `neck.png`        | 首              | 中央         |                    |
| 30  | `torso.png`       | 胴体            | 中央         |                    |
| 31  | `armL.png`        | 腕 L            | 画面の右     |                    |
| 32  | `armR.png`        | 腕 R            | 画面の左     |                    |
| 33  | `chest.png`       | 胸              | 中央         | 胸揺れ用（任意）   |

### 生成する素材の選び方

- **分割版を使う場合:** 目は白目・瞳・ハイライト・上まぶた・下まぶたを左右それぞれ、口は上唇・下唇・口の中・歯・舌を生成する。「目（まとめて）」2枚と「口（まとめて）」1枚を除くと、通常素材は29枚。立ち絵にない下まつげや歯などは、必要に応じて省略してよい。
- **まとめて版を使う場合:** 片目ごとに `eyeWholeL.png` / `eyeWholeR.png`、口は `mouthWhole.png` を生成する。それぞれ対応する分割素材を同時に割り当てない。
- **胸揺れを使う場合:** `chest.png` を追加し、`torso.png` にも胸の下の衣装を塗り足す。胸揺れを使わない場合は、胸の描画を胴体に含める。

### 顔

#### 1. 顔 — `face.png`

- 頭の土台になる肌。輪郭と鼻は顔に含める。目・眉・口・頬染め・耳・髪は描かず、目や口の所は素肌のままにする。
- 前髪・横髪に隠れている額やこめかみも肌で描き足す（頭を回したとき、髪の下から肌が見える）。髪の影は顔に描かない。

```text
Task: create ONE separate layer image for a layered 2D animation model (Live2D-style rig).
The attached image is the finalized standing character illustration, created BEFORE generating any part images. Use this same standing reference for every part; match its position, size, shape, colors, clothes and style.

Output rules:
- Exactly the same canvas size and aspect ratio as the reference image. Keep the part at the exact same position, scale and angle as in the reference.
- Draw ONLY the part described below. Everything else must be fully transparent (real alpha channel). No background color, no checkerboard pattern, no frame, no text or labels.
- Output exactly ONE PNG image for this part, not a contact sheet, sprite sheet or set of variations.
- Do not zoom in, crop, re-center or enlarge the part. Most of the canvas stays empty.
- Do not draw any other part, even partially, and no shadows cast by other parts.
- Where other parts cover this part in the reference, paint the hidden area so this part is complete on its own (it will move during animation).
- Same art style, line weight, colors and shading as the reference. Clean edges, no stray pixels; do not switch to a different style.

Part: FACE (the bare skin of the face; the base layer of the head).
Draw: the face skin from the chin up to the hairline, with the face outline (jaw line) and the nose, in the same skin color and shading as the reference.
Do not draw: eyes, eyelashes, eyebrows, mouth, lips, blush, ears, hair, hair shadows, neck.
Leave plain skin where the eyes, eyebrows and mouth are (they are separate layers placed on top).
Complete hidden areas: continue the forehead and temple skin under the bangs and side hair up to the top of the forehead, following the rounded shape of the head, so no hole appears when the hair moves.
```

#### 2. 耳 L — `earL.png`

- キャラ自身の左（画面の右）の耳1つだけ。髪や顔の輪郭に隠れた所と付け根も描き足す（頭を回すと顔の後ろからのぞく）。

```text
Task: create ONE separate layer image for a layered 2D animation model (Live2D-style rig).
The attached image is the finalized standing character illustration, created BEFORE generating any part images. Use this same standing reference for every part; match its position, size, shape, colors, clothes and style.

Output rules:
- Exactly the same canvas size and aspect ratio as the reference image. Keep the part at the exact same position, scale and angle as in the reference.
- Draw ONLY the part described below. Everything else must be fully transparent (real alpha channel). No background color, no checkerboard pattern, no frame, no text or labels.
- Output exactly ONE PNG image for this part, not a contact sheet, sprite sheet or set of variations.
- Do not zoom in, crop, re-center or enlarge the part. Most of the canvas stays empty.
- Do not draw any other part, even partially, and no shadows cast by other parts.
- Where other parts cover this part in the reference, paint the hidden area so this part is complete on its own (it will move during animation).
- Same art style, line weight, colors and shading as the reference. Clean edges, no stray pixels; do not switch to a different style.

Part: EAR — the character's own left ear (it appears on the RIGHT side of the image).
Draw: only this one ear with its inner details, in the same skin color and line art as the reference.
Do not draw: the other ear, face, hair, or anything else.
Complete hidden areas: draw the whole ear even where hair covers it, and extend the base of the ear a little inward (toward the face center) under the face edge, so the ear stays attached when the head turns.
```

#### 3. 耳 R — `earR.png`

- キャラ自身の右（画面の左）の耳1つだけ。髪や顔の輪郭に隠れた所と付け根も描き足す（頭を回すと顔の後ろからのぞく）。

```text
Task: create ONE separate layer image for a layered 2D animation model (Live2D-style rig).
The attached image is the finalized standing character illustration, created BEFORE generating any part images. Use this same standing reference for every part; match its position, size, shape, colors, clothes and style.

Output rules:
- Exactly the same canvas size and aspect ratio as the reference image. Keep the part at the exact same position, scale and angle as in the reference.
- Draw ONLY the part described below. Everything else must be fully transparent (real alpha channel). No background color, no checkerboard pattern, no frame, no text or labels.
- Output exactly ONE PNG image for this part, not a contact sheet, sprite sheet or set of variations.
- Do not zoom in, crop, re-center or enlarge the part. Most of the canvas stays empty.
- Do not draw any other part, even partially, and no shadows cast by other parts.
- Where other parts cover this part in the reference, paint the hidden area so this part is complete on its own (it will move during animation).
- Same art style, line weight, colors and shading as the reference. Clean edges, no stray pixels; do not switch to a different style.

Part: EAR — the character's own right ear (it appears on the LEFT side of the image).
Draw: only this one ear with its inner details, in the same skin color and line art as the reference.
Do not draw: the other ear, face, hair, or anything else.
Complete hidden areas: draw the whole ear even where hair covers it, and extend the base of the ear a little inward (toward the face center) under the face edge, so the ear stays attached when the head turns.
```

#### 4. 頬染め — `cheek.png`

- 両頬の頬染めを1枚にまとめる（このパーツは左右で1つ）。
- 強さはツールが不透明度で調整するので、いちばん赤い状態で描く。ぼかしの縁（半透明）はあってよい。

```text
Task: create ONE separate layer image for a layered 2D animation model (Live2D-style rig).
The attached image is the finalized standing character illustration, created BEFORE generating any part images. Use this same standing reference for every part; match its position, size, shape, colors, clothes and style.

Output rules:
- Exactly the same canvas size and aspect ratio as the reference image. Keep the part at the exact same position, scale and angle as in the reference.
- Draw ONLY the part described below. Everything else must be fully transparent (real alpha channel). No background color, no checkerboard pattern, no frame, no text or labels.
- Output exactly ONE PNG image for this part, not a contact sheet, sprite sheet or set of variations.
- Do not zoom in, crop, re-center or enlarge the part. Most of the canvas stays empty.
- Do not draw any other part, even partially, and no shadows cast by other parts.
- Where other parts cover this part in the reference, paint the hidden area so this part is complete on its own (it will move during animation).
- Same art style, line weight, colors and shading as the reference. Clean edges, no stray pixels; do not switch to a different style.

Part: CHEEK BLUSH — both cheeks in this single image.
Draw: only the blush marks: a soft pink/red flush on each cheek (left and right), placed on the cheeks below the eyes, optionally with a few short diagonal hatch lines. Draw it at full strength (the animation fades it in and out). Soft edges with partial transparency are fine.
Do not draw: face skin, eyes, nose, mouth, or anything else.
```

### 左目（キャラ自身の左目 = 画面の右）

#### 5. 白目 L ★ — `eyeWhiteL.png`

- キャラ自身の左目（画面の右）。開いた目の白目だけを、欠けのないアーモンド形で描く。
- 瞳とハイライトはこの形で切り抜かれる。まばたきでは縦に縮む。

```text
Task: create ONE separate layer image for a layered 2D animation model (Live2D-style rig).
The attached image is the finalized standing character illustration, created BEFORE generating any part images. Use this same standing reference for every part; match its position, size, shape, colors, clothes and style.

Output rules:
- Exactly the same canvas size and aspect ratio as the reference image. Keep the part at the exact same position, scale and angle as in the reference.
- Draw ONLY the part described below. Everything else must be fully transparent (real alpha channel). No background color, no checkerboard pattern, no frame, no text or labels.
- Output exactly ONE PNG image for this part, not a contact sheet, sprite sheet or set of variations.
- Do not zoom in, crop, re-center or enlarge the part. Most of the canvas stays empty.
- Do not draw any other part, even partially, and no shadows cast by other parts.
- Where other parts cover this part in the reference, paint the hidden area so this part is complete on its own (it will move during animation).
- Same art style, line weight, colors and shading as the reference. Clean edges, no stray pixels; do not switch to a different style.

Part: EYE WHITE of the character's own left eye (it appears on the RIGHT side of the image).
Draw: only the white of the open eye (the sclera) as one solid almond-shaped area filling the whole eye opening between the upper and lower eyelid lines. Near-white color; a soft gray-blue shadow along its top edge is fine.
Do not draw: iris, pupil, highlights, eyelashes, eyelid lines, eyebrow, the other eye, or skin.
Complete hidden areas: fill the white also where the iris and the eyelid lines cover it, so the almond shape is complete.
```

#### 6. 瞳 L ★ — `irisL.png`

- キャラ自身の左目（画面の右）。瞳（黒目）だけ。まぶたに隠れている上側も含め、欠けのない円（楕円）で描く。
- 白目の形で切り抜かれ、視線で上下左右に動くので、欠けていると動かしたときに穴が見える。ハイライトは別の画像。

```text
Task: create ONE separate layer image for a layered 2D animation model (Live2D-style rig).
The attached image is the finalized standing character illustration, created BEFORE generating any part images. Use this same standing reference for every part; match its position, size, shape, colors, clothes and style.

Output rules:
- Exactly the same canvas size and aspect ratio as the reference image. Keep the part at the exact same position, scale and angle as in the reference.
- Draw ONLY the part described below. Everything else must be fully transparent (real alpha channel). No background color, no checkerboard pattern, no frame, no text or labels.
- Output exactly ONE PNG image for this part, not a contact sheet, sprite sheet or set of variations.
- Do not zoom in, crop, re-center or enlarge the part. Most of the canvas stays empty.
- Do not draw any other part, even partially, and no shadows cast by other parts.
- Where other parts cover this part in the reference, paint the hidden area so this part is complete on its own (it will move during animation).
- Same art style, line weight, colors and shading as the reference. Clean edges, no stray pixels; do not switch to a different style.

Part: IRIS of the character's own left eye (it appears on the RIGHT side of the image).
Draw: only the iris with the pupil and its color gradient, as a complete round/oval shape, with the same color and size as in the reference.
Do not draw: highlights (they are a separate layer), eye white, eyelashes, eyelid lines, the other eye, or skin.
Complete hidden areas: the iris must be a full, uncut circle/oval — also paint the parts covered by the upper eyelid or lying outside the eye white (it is clipped by the eye white later and moves when the character looks around).
```

#### 7. ハイライト L — `highlightL.png`

- キャラ自身の左目（画面の右）。瞳の上の白い光だけ。白目の形で切り抜かれる。

```text
Task: create ONE separate layer image for a layered 2D animation model (Live2D-style rig).
The attached image is the finalized standing character illustration, created BEFORE generating any part images. Use this same standing reference for every part; match its position, size, shape, colors, clothes and style.

Output rules:
- Exactly the same canvas size and aspect ratio as the reference image. Keep the part at the exact same position, scale and angle as in the reference.
- Draw ONLY the part described below. Everything else must be fully transparent (real alpha channel). No background color, no checkerboard pattern, no frame, no text or labels.
- Output exactly ONE PNG image for this part, not a contact sheet, sprite sheet or set of variations.
- Do not zoom in, crop, re-center or enlarge the part. Most of the canvas stays empty.
- Do not draw any other part, even partially, and no shadows cast by other parts.
- Where other parts cover this part in the reference, paint the hidden area so this part is complete on its own (it will move during animation).
- Same art style, line weight, colors and shading as the reference. Clean edges, no stray pixels; do not switch to a different style.

Part: EYE HIGHLIGHTS of the character's own left eye (it appears on the RIGHT side of the image).
Draw: only the white light reflections (catchlights) that sit on the iris, at the same positions and sizes as in the reference. Pure white or a very light color.
Do not draw: iris, pupil, eye white, eyelashes, eyelid lines, the other eye, or anything else.
```

#### 8. 上まぶた L ★ — `upperLidL.png`

- キャラ自身の左目（画面の右）。上まぶたの線とまつげだけ。二重の線は描かない。
- まばたきではこの1枚が白目の下端まで下がり、閉じた目の線になる。

```text
Task: create ONE separate layer image for a layered 2D animation model (Live2D-style rig).
The attached image is the finalized standing character illustration, created BEFORE generating any part images. Use this same standing reference for every part; match its position, size, shape, colors, clothes and style.

Output rules:
- Exactly the same canvas size and aspect ratio as the reference image. Keep the part at the exact same position, scale and angle as in the reference.
- Draw ONLY the part described below. Everything else must be fully transparent (real alpha channel). No background color, no checkerboard pattern, no frame, no text or labels.
- Output exactly ONE PNG image for this part, not a contact sheet, sprite sheet or set of variations.
- Do not zoom in, crop, re-center or enlarge the part. Most of the canvas stays empty.
- Do not draw any other part, even partially, and no shadows cast by other parts.
- Where other parts cover this part in the reference, paint the hidden area so this part is complete on its own (it will move during animation).
- Same art style, line weight, colors and shading as the reference. Clean edges, no stray pixels; do not switch to a different style.

Part: UPPER EYELID of the character's own left eye (it appears on the RIGHT side of the image).
Draw: only the upper eyelid line with its eyelashes (the thick dark line along the top edge of the eye, including the lashes at the outer corner).
Do not draw: eye white, iris, highlights, lower eyelid, double-eyelid crease, eyebrow, the other eye, or skin.
Note: this layer slides down to close the eye, so draw it as one clean, self-contained shape.
```

#### 9. 下まぶた L — `lowerLidL.png`

- キャラ自身の左目（画面の右）。下まぶたの線（下まつげ）だけ。目を閉じるときに少し上がる。

```text
Task: create ONE separate layer image for a layered 2D animation model (Live2D-style rig).
The attached image is the finalized standing character illustration, created BEFORE generating any part images. Use this same standing reference for every part; match its position, size, shape, colors, clothes and style.

Output rules:
- Exactly the same canvas size and aspect ratio as the reference image. Keep the part at the exact same position, scale and angle as in the reference.
- Draw ONLY the part described below. Everything else must be fully transparent (real alpha channel). No background color, no checkerboard pattern, no frame, no text or labels.
- Output exactly ONE PNG image for this part, not a contact sheet, sprite sheet or set of variations.
- Do not zoom in, crop, re-center or enlarge the part. Most of the canvas stays empty.
- Do not draw any other part, even partially, and no shadows cast by other parts.
- Where other parts cover this part in the reference, paint the hidden area so this part is complete on its own (it will move during animation).
- Same art style, line weight, colors and shading as the reference. Clean edges, no stray pixels; do not switch to a different style.

Part: LOWER EYELID of the character's own left eye (it appears on the RIGHT side of the image).
Draw: only the lower eyelid line / lower lashes along the bottom edge of the eye, with the same thickness and color as in the reference.
Do not draw: eye white, iris, highlights, upper eyelid, eyebrow, the other eye, or skin.
```

#### 10. 目（まとめて）L — `eyeWholeL.png`

- キャラ自身の左目（画面の右）。【まとめて版】目を1枚で済ませるときだけ使う。白目・瞳・ハイライト・上下のまぶたを1枚に合成した開いた目。眉は含めない。
- 上の5枚と同時には割り当てない。この方式ではまばたきは目全体を縦に縮めるだけになり、視線も動かない。

```text
Task: create ONE separate layer image for a layered 2D animation model (Live2D-style rig).
The attached image is the finalized standing character illustration, created BEFORE generating any part images. Use this same standing reference for every part; match its position, size, shape, colors, clothes and style.

Output rules:
- Exactly the same canvas size and aspect ratio as the reference image. Keep the part at the exact same position, scale and angle as in the reference.
- Draw ONLY the part described below. Everything else must be fully transparent (real alpha channel). No background color, no checkerboard pattern, no frame, no text or labels.
- Output exactly ONE PNG image for this part, not a contact sheet, sprite sheet or set of variations.
- Do not zoom in, crop, re-center or enlarge the part. Most of the canvas stays empty.
- Do not draw any other part, even partially, and no shadows cast by other parts.
- Where other parts cover this part in the reference, paint the hidden area so this part is complete on its own (it will move during animation).
- Same art style, line weight, colors and shading as the reference. Clean edges, no stray pixels; do not switch to a different style.

Part: WHOLE EYE (single-layer version) of the character's own left eye (it appears on the RIGHT side of the image).
Draw: the complete open eye exactly as in the reference — eye white, iris, pupil, highlights, upper eyelid with lashes and lower eyelid — merged into one layer.
Do not draw: eyebrow, the other eye, the skin around the eye, or anything else.
```

### 右目（キャラ自身の右目 = 画面の左）

#### 11. 白目 R ★ — `eyeWhiteR.png`

- キャラ自身の右目（画面の左）。開いた目の白目だけを、欠けのないアーモンド形で描く。
- 瞳とハイライトはこの形で切り抜かれる。まばたきでは縦に縮む。

```text
Task: create ONE separate layer image for a layered 2D animation model (Live2D-style rig).
The attached image is the finalized standing character illustration, created BEFORE generating any part images. Use this same standing reference for every part; match its position, size, shape, colors, clothes and style.

Output rules:
- Exactly the same canvas size and aspect ratio as the reference image. Keep the part at the exact same position, scale and angle as in the reference.
- Draw ONLY the part described below. Everything else must be fully transparent (real alpha channel). No background color, no checkerboard pattern, no frame, no text or labels.
- Output exactly ONE PNG image for this part, not a contact sheet, sprite sheet or set of variations.
- Do not zoom in, crop, re-center or enlarge the part. Most of the canvas stays empty.
- Do not draw any other part, even partially, and no shadows cast by other parts.
- Where other parts cover this part in the reference, paint the hidden area so this part is complete on its own (it will move during animation).
- Same art style, line weight, colors and shading as the reference. Clean edges, no stray pixels; do not switch to a different style.

Part: EYE WHITE of the character's own right eye (it appears on the LEFT side of the image).
Draw: only the white of the open eye (the sclera) as one solid almond-shaped area filling the whole eye opening between the upper and lower eyelid lines. Near-white color; a soft gray-blue shadow along its top edge is fine.
Do not draw: iris, pupil, highlights, eyelashes, eyelid lines, eyebrow, the other eye, or skin.
Complete hidden areas: fill the white also where the iris and the eyelid lines cover it, so the almond shape is complete.
```

#### 12. 瞳 R ★ — `irisR.png`

- キャラ自身の右目（画面の左）。瞳（黒目）だけ。まぶたに隠れている上側も含め、欠けのない円（楕円）で描く。
- 白目の形で切り抜かれ、視線で上下左右に動くので、欠けていると動かしたときに穴が見える。ハイライトは別の画像。

```text
Task: create ONE separate layer image for a layered 2D animation model (Live2D-style rig).
The attached image is the finalized standing character illustration, created BEFORE generating any part images. Use this same standing reference for every part; match its position, size, shape, colors, clothes and style.

Output rules:
- Exactly the same canvas size and aspect ratio as the reference image. Keep the part at the exact same position, scale and angle as in the reference.
- Draw ONLY the part described below. Everything else must be fully transparent (real alpha channel). No background color, no checkerboard pattern, no frame, no text or labels.
- Output exactly ONE PNG image for this part, not a contact sheet, sprite sheet or set of variations.
- Do not zoom in, crop, re-center or enlarge the part. Most of the canvas stays empty.
- Do not draw any other part, even partially, and no shadows cast by other parts.
- Where other parts cover this part in the reference, paint the hidden area so this part is complete on its own (it will move during animation).
- Same art style, line weight, colors and shading as the reference. Clean edges, no stray pixels; do not switch to a different style.

Part: IRIS of the character's own right eye (it appears on the LEFT side of the image).
Draw: only the iris with the pupil and its color gradient, as a complete round/oval shape, with the same color and size as in the reference.
Do not draw: highlights (they are a separate layer), eye white, eyelashes, eyelid lines, the other eye, or skin.
Complete hidden areas: the iris must be a full, uncut circle/oval — also paint the parts covered by the upper eyelid or lying outside the eye white (it is clipped by the eye white later and moves when the character looks around).
```

#### 13. ハイライト R — `highlightR.png`

- キャラ自身の右目（画面の左）。瞳の上の白い光だけ。白目の形で切り抜かれる。

```text
Task: create ONE separate layer image for a layered 2D animation model (Live2D-style rig).
The attached image is the finalized standing character illustration, created BEFORE generating any part images. Use this same standing reference for every part; match its position, size, shape, colors, clothes and style.

Output rules:
- Exactly the same canvas size and aspect ratio as the reference image. Keep the part at the exact same position, scale and angle as in the reference.
- Draw ONLY the part described below. Everything else must be fully transparent (real alpha channel). No background color, no checkerboard pattern, no frame, no text or labels.
- Output exactly ONE PNG image for this part, not a contact sheet, sprite sheet or set of variations.
- Do not zoom in, crop, re-center or enlarge the part. Most of the canvas stays empty.
- Do not draw any other part, even partially, and no shadows cast by other parts.
- Where other parts cover this part in the reference, paint the hidden area so this part is complete on its own (it will move during animation).
- Same art style, line weight, colors and shading as the reference. Clean edges, no stray pixels; do not switch to a different style.

Part: EYE HIGHLIGHTS of the character's own right eye (it appears on the LEFT side of the image).
Draw: only the white light reflections (catchlights) that sit on the iris, at the same positions and sizes as in the reference. Pure white or a very light color.
Do not draw: iris, pupil, eye white, eyelashes, eyelid lines, the other eye, or anything else.
```

#### 14. 上まぶた R ★ — `upperLidR.png`

- キャラ自身の右目（画面の左）。上まぶたの線とまつげだけ。二重の線は描かない。
- まばたきではこの1枚が白目の下端まで下がり、閉じた目の線になる。

```text
Task: create ONE separate layer image for a layered 2D animation model (Live2D-style rig).
The attached image is the finalized standing character illustration, created BEFORE generating any part images. Use this same standing reference for every part; match its position, size, shape, colors, clothes and style.

Output rules:
- Exactly the same canvas size and aspect ratio as the reference image. Keep the part at the exact same position, scale and angle as in the reference.
- Draw ONLY the part described below. Everything else must be fully transparent (real alpha channel). No background color, no checkerboard pattern, no frame, no text or labels.
- Output exactly ONE PNG image for this part, not a contact sheet, sprite sheet or set of variations.
- Do not zoom in, crop, re-center or enlarge the part. Most of the canvas stays empty.
- Do not draw any other part, even partially, and no shadows cast by other parts.
- Where other parts cover this part in the reference, paint the hidden area so this part is complete on its own (it will move during animation).
- Same art style, line weight, colors and shading as the reference. Clean edges, no stray pixels; do not switch to a different style.

Part: UPPER EYELID of the character's own right eye (it appears on the LEFT side of the image).
Draw: only the upper eyelid line with its eyelashes (the thick dark line along the top edge of the eye, including the lashes at the outer corner).
Do not draw: eye white, iris, highlights, lower eyelid, double-eyelid crease, eyebrow, the other eye, or skin.
Note: this layer slides down to close the eye, so draw it as one clean, self-contained shape.
```

#### 15. 下まぶた R — `lowerLidR.png`

- キャラ自身の右目（画面の左）。下まぶたの線（下まつげ）だけ。目を閉じるときに少し上がる。

```text
Task: create ONE separate layer image for a layered 2D animation model (Live2D-style rig).
The attached image is the finalized standing character illustration, created BEFORE generating any part images. Use this same standing reference for every part; match its position, size, shape, colors, clothes and style.

Output rules:
- Exactly the same canvas size and aspect ratio as the reference image. Keep the part at the exact same position, scale and angle as in the reference.
- Draw ONLY the part described below. Everything else must be fully transparent (real alpha channel). No background color, no checkerboard pattern, no frame, no text or labels.
- Output exactly ONE PNG image for this part, not a contact sheet, sprite sheet or set of variations.
- Do not zoom in, crop, re-center or enlarge the part. Most of the canvas stays empty.
- Do not draw any other part, even partially, and no shadows cast by other parts.
- Where other parts cover this part in the reference, paint the hidden area so this part is complete on its own (it will move during animation).
- Same art style, line weight, colors and shading as the reference. Clean edges, no stray pixels; do not switch to a different style.

Part: LOWER EYELID of the character's own right eye (it appears on the LEFT side of the image).
Draw: only the lower eyelid line / lower lashes along the bottom edge of the eye, with the same thickness and color as in the reference.
Do not draw: eye white, iris, highlights, upper eyelid, eyebrow, the other eye, or skin.
```

#### 16. 目（まとめて）R — `eyeWholeR.png`

- キャラ自身の右目（画面の左）。【まとめて版】目を1枚で済ませるときだけ使う。白目・瞳・ハイライト・上下のまぶたを1枚に合成した開いた目。眉は含めない。
- 上の5枚と同時には割り当てない。この方式ではまばたきは目全体を縦に縮めるだけになり、視線も動かない。

```text
Task: create ONE separate layer image for a layered 2D animation model (Live2D-style rig).
The attached image is the finalized standing character illustration, created BEFORE generating any part images. Use this same standing reference for every part; match its position, size, shape, colors, clothes and style.

Output rules:
- Exactly the same canvas size and aspect ratio as the reference image. Keep the part at the exact same position, scale and angle as in the reference.
- Draw ONLY the part described below. Everything else must be fully transparent (real alpha channel). No background color, no checkerboard pattern, no frame, no text or labels.
- Output exactly ONE PNG image for this part, not a contact sheet, sprite sheet or set of variations.
- Do not zoom in, crop, re-center or enlarge the part. Most of the canvas stays empty.
- Do not draw any other part, even partially, and no shadows cast by other parts.
- Where other parts cover this part in the reference, paint the hidden area so this part is complete on its own (it will move during animation).
- Same art style, line weight, colors and shading as the reference. Clean edges, no stray pixels; do not switch to a different style.

Part: WHOLE EYE (single-layer version) of the character's own right eye (it appears on the LEFT side of the image).
Draw: the complete open eye exactly as in the reference — eye white, iris, pupil, highlights, upper eyelid with lashes and lower eyelid — merged into one layer.
Do not draw: eyebrow, the other eye, the skin around the eye, or anything else.
```

### 眉

#### 17. 眉 L — `browL.png`

- キャラ自身の左（画面の右）の眉1本だけ。前髪に隠れている部分も描き足す。

```text
Task: create ONE separate layer image for a layered 2D animation model (Live2D-style rig).
The attached image is the finalized standing character illustration, created BEFORE generating any part images. Use this same standing reference for every part; match its position, size, shape, colors, clothes and style.

Output rules:
- Exactly the same canvas size and aspect ratio as the reference image. Keep the part at the exact same position, scale and angle as in the reference.
- Draw ONLY the part described below. Everything else must be fully transparent (real alpha channel). No background color, no checkerboard pattern, no frame, no text or labels.
- Output exactly ONE PNG image for this part, not a contact sheet, sprite sheet or set of variations.
- Do not zoom in, crop, re-center or enlarge the part. Most of the canvas stays empty.
- Do not draw any other part, even partially, and no shadows cast by other parts.
- Where other parts cover this part in the reference, paint the hidden area so this part is complete on its own (it will move during animation).
- Same art style, line weight, colors and shading as the reference. Clean edges, no stray pixels; do not switch to a different style.

Part: EYEBROW — the character's own left eyebrow (it appears on the RIGHT side of the image).
Draw: only this one eyebrow, with the same shape, thickness and color as the reference.
Do not draw: the other eyebrow, eyes, hair, skin, or anything else.
Complete hidden areas: if the bangs cover part of the eyebrow, draw the full eyebrow.
```

#### 18. 眉 R — `browR.png`

- キャラ自身の右（画面の左）の眉1本だけ。前髪に隠れている部分も描き足す。

```text
Task: create ONE separate layer image for a layered 2D animation model (Live2D-style rig).
The attached image is the finalized standing character illustration, created BEFORE generating any part images. Use this same standing reference for every part; match its position, size, shape, colors, clothes and style.

Output rules:
- Exactly the same canvas size and aspect ratio as the reference image. Keep the part at the exact same position, scale and angle as in the reference.
- Draw ONLY the part described below. Everything else must be fully transparent (real alpha channel). No background color, no checkerboard pattern, no frame, no text or labels.
- Output exactly ONE PNG image for this part, not a contact sheet, sprite sheet or set of variations.
- Do not zoom in, crop, re-center or enlarge the part. Most of the canvas stays empty.
- Do not draw any other part, even partially, and no shadows cast by other parts.
- Where other parts cover this part in the reference, paint the hidden area so this part is complete on its own (it will move during animation).
- Same art style, line weight, colors and shading as the reference. Clean edges, no stray pixels; do not switch to a different style.

Part: EYEBROW — the character's own right eyebrow (it appears on the LEFT side of the image).
Draw: only this one eyebrow, with the same shape, thickness and color as the reference.
Do not draw: the other eyebrow, eyes, hair, skin, or anything else.
Complete hidden areas: if the bangs cover part of the eyebrow, draw the full eyebrow.
```

### 口

- 口はこの順に作ると大きさをそろえやすい: 口の中 → 歯 → 舌 → 上唇 → 下唇。
- ツールでの動き: 口を開くと「下唇」と「舌」が下がり、「口の中」も少し下がる。「上唇」と「歯」は動かない。閉じているときは上唇と下唇の2枚で口の中を完全に隠す。
- 大きさの目安（口の線の長さを W とする）: 口の中 = 幅 W・高さ 0.4W／上唇・下唇の肌色の半楕円 = 幅 1.2W・高さ 0.3W。

#### 19. 上唇 ★ — `upperLip.png`

- 閉じた口の上半分。閉じた口の線と、その上に顔と同じ肌色の半楕円。線のない肌色部分は顔に溶け込むこと。
- 下唇と合わせて「口の中」を完全に隠す。口を開いても動かない。

```text
Task: create ONE separate layer image for a layered 2D animation model (Live2D-style rig).
The attached image is the finalized standing character illustration, created BEFORE generating any part images. Use this same standing reference for every part; match its position, size, shape, colors, clothes and style.

Output rules:
- Exactly the same canvas size and aspect ratio as the reference image. Keep the part at the exact same position, scale and angle as in the reference.
- Draw ONLY the part described below. Everything else must be fully transparent (real alpha channel). No background color, no checkerboard pattern, no frame, no text or labels.
- Output exactly ONE PNG image for this part, not a contact sheet, sprite sheet or set of variations.
- Do not zoom in, crop, re-center or enlarge the part. Most of the canvas stays empty.
- Do not draw any other part, even partially, and no shadows cast by other parts.
- Where other parts cover this part in the reference, paint the hidden area so this part is complete on its own (it will move during animation).
- Same art style, line weight, colors and shading as the reference. Clean edges, no stray pixels; do not switch to a different style.

Part: UPPER LIP (the upper half of the closed mouth).
Draw: the closed mouth line exactly as in the reference, plus a patch of the face's skin color directly ABOVE that line: a half-ellipse whose flat bottom edge is the mouth line, about 1.2 times as wide as the mouth line and about 0.3 times as tall as the mouth line is long. The skin patch has no outline and must blend invisibly into the face.
Do not draw: lower lip, mouth interior, teeth, tongue, nose, or the rest of the face.
```

#### 20. 下唇 ★ — `lowerLip.png`

- 閉じた口の下半分。口の線の下に顔と同じ肌色の半楕円（下唇の小さな影があれば含める）。口の線そのものは上唇に入れるので描かない。
- 口を開くとこの1枚が下がる。

```text
Task: create ONE separate layer image for a layered 2D animation model (Live2D-style rig).
The attached image is the finalized standing character illustration, created BEFORE generating any part images. Use this same standing reference for every part; match its position, size, shape, colors, clothes and style.

Output rules:
- Exactly the same canvas size and aspect ratio as the reference image. Keep the part at the exact same position, scale and angle as in the reference.
- Draw ONLY the part described below. Everything else must be fully transparent (real alpha channel). No background color, no checkerboard pattern, no frame, no text or labels.
- Output exactly ONE PNG image for this part, not a contact sheet, sprite sheet or set of variations.
- Do not zoom in, crop, re-center or enlarge the part. Most of the canvas stays empty.
- Do not draw any other part, even partially, and no shadows cast by other parts.
- Where other parts cover this part in the reference, paint the hidden area so this part is complete on its own (it will move during animation).
- Same art style, line weight, colors and shading as the reference. Clean edges, no stray pixels; do not switch to a different style.

Part: LOWER LIP (the lower half of the closed mouth).
Draw: a patch of the face's skin color directly BELOW the closed mouth line of the reference: a half-ellipse whose flat top edge touches the mouth line, as wide as the upper-lip patch (about 1.2 times the mouth line) and about 0.3 times as tall as the mouth line is long. Include the small lower-lip shading mark if the reference has one. No outline; it must blend invisibly into the face.
Do not draw: the mouth line itself, upper lip, mouth interior, teeth, tongue, chin outline, or the rest of the face.
Note: this layer moves down to open the mouth.
```

#### 21. 口の中 ★ — `mouthInside.png`

- 開いた口の中（暗い赤）。元の絵は口を閉じているので新しく描く。閉じた口の線を中心に置く。
- 歯と舌はこの形で切り抜かれる。この高さが口の開く量の基準になる。

```text
Task: create ONE separate layer image for a layered 2D animation model (Live2D-style rig).
The attached image is the finalized standing character illustration, created BEFORE generating any part images. Use this same standing reference for every part; match its position, size, shape, colors, clothes and style.

Output rules:
- Exactly the same canvas size and aspect ratio as the reference image. Keep the part at the exact same position, scale and angle as in the reference.
- Draw ONLY the part described below. Everything else must be fully transparent (real alpha channel). No background color, no checkerboard pattern, no frame, no text or labels.
- Output exactly ONE PNG image for this part, not a contact sheet, sprite sheet or set of variations.
- Do not zoom in, crop, re-center or enlarge the part. Most of the canvas stays empty.
- Do not draw any other part, even partially, and no shadows cast by other parts.
- Where other parts cover this part in the reference, paint the hidden area so this part is complete on its own (it will move during animation).
- Same art style, line weight, colors and shading as the reference. Clean edges, no stray pixels; do not switch to a different style.

Part: MOUTH INTERIOR (the inside of an opened mouth). The reference has a closed mouth, so invent this shape.
Draw: only the dark inside of the mouth as one filled shape (dark red / maroon, slightly darker toward the throat), shaped like a moderately opened mouth: about as wide as the closed mouth line, and about 40% as tall as it is wide. Center it vertically and horizontally on the closed mouth line of the reference.
Do not draw: lips, the mouth line, teeth, tongue, skin, or anything else.
```

#### 22. 歯 — `teeth.png`

- 上の歯の列だけ。口の中の上端に沿わせる。口の中の形で切り抜かれるので、多少はみ出してよい。

```text
Task: create ONE separate layer image for a layered 2D animation model (Live2D-style rig).
The attached image is the finalized standing character illustration, created BEFORE generating any part images. Use this same standing reference for every part; match its position, size, shape, colors, clothes and style.

Output rules:
- Exactly the same canvas size and aspect ratio as the reference image. Keep the part at the exact same position, scale and angle as in the reference.
- Draw ONLY the part described below. Everything else must be fully transparent (real alpha channel). No background color, no checkerboard pattern, no frame, no text or labels.
- Output exactly ONE PNG image for this part, not a contact sheet, sprite sheet or set of variations.
- Do not zoom in, crop, re-center or enlarge the part. Most of the canvas stays empty.
- Do not draw any other part, even partially, and no shadows cast by other parts.
- Where other parts cover this part in the reference, paint the hidden area so this part is complete on its own (it will move during animation).
- Same art style, line weight, colors and shading as the reference. Clean edges, no stray pixels; do not switch to a different style.

Part: UPPER TEETH.
Draw: only a row of upper teeth as one simple white band (anime style, little or no gap between teeth), lying along the top edge of the mouth interior, horizontally centered on the mouth line of the reference.
Do not draw: mouth interior, tongue, lips, skin, or anything else.
It may extend a little beyond the mouth opening; it is clipped later.
```

#### 23. 舌 — `tongue.png`

- 舌だけ。口の中の下側に置く。切り抜かれるので外へはみ出してよい。

```text
Task: create ONE separate layer image for a layered 2D animation model (Live2D-style rig).
The attached image is the finalized standing character illustration, created BEFORE generating any part images. Use this same standing reference for every part; match its position, size, shape, colors, clothes and style.

Output rules:
- Exactly the same canvas size and aspect ratio as the reference image. Keep the part at the exact same position, scale and angle as in the reference.
- Draw ONLY the part described below. Everything else must be fully transparent (real alpha channel). No background color, no checkerboard pattern, no frame, no text or labels.
- Output exactly ONE PNG image for this part, not a contact sheet, sprite sheet or set of variations.
- Do not zoom in, crop, re-center or enlarge the part. Most of the canvas stays empty.
- Do not draw any other part, even partially, and no shadows cast by other parts.
- Where other parts cover this part in the reference, paint the hidden area so this part is complete on its own (it will move during animation).
- Same art style, line weight, colors and shading as the reference. Clean edges, no stray pixels; do not switch to a different style.

Part: TONGUE.
Draw: only the tongue — a rounded pink-red shape lying in the lower part of the mouth interior, just below the mouth line of the reference, slightly lighter than the mouth interior color.
Do not draw: mouth interior, teeth, lips, skin, or anything else.
It may extend beyond the mouth opening at the bottom and sides; it is clipped later.
```

#### 24. 口（まとめて） — `mouthWhole.png`

- 【まとめて版】口を1枚で済ませるときだけ使う。上の5枚と同時には割り当てない。
- この方式では口を開くとき縦に1.6倍に伸ばすだけなので、線1本の閉じた口では開いて見えない。小さく少しだけ開いた口にしておく。

```text
Task: create ONE separate layer image for a layered 2D animation model (Live2D-style rig).
The attached image is the finalized standing character illustration, created BEFORE generating any part images. Use this same standing reference for every part; match its position, size, shape, colors, clothes and style.

Output rules:
- Exactly the same canvas size and aspect ratio as the reference image. Keep the part at the exact same position, scale and angle as in the reference.
- Draw ONLY the part described below. Everything else must be fully transparent (real alpha channel). No background color, no checkerboard pattern, no frame, no text or labels.
- Output exactly ONE PNG image for this part, not a contact sheet, sprite sheet or set of variations.
- Do not zoom in, crop, re-center or enlarge the part. Most of the canvas stays empty.
- Do not draw any other part, even partially, and no shadows cast by other parts.
- Where other parts cover this part in the reference, paint the hidden area so this part is complete on its own (it will move during animation).
- Same art style, line weight, colors and shading as the reference. Clean edges, no stray pixels; do not switch to a different style.

Part: WHOLE MOUTH (single-layer version).
Draw: the mouth as one layer at the same position and width as in the reference, as a small, slightly opened mouth (a thin dark opening with its outline), so that stretching it vertically looks like opening the mouth.
Do not draw: nose, chin, the skin around the mouth, or anything else.
```

### 髪

#### 25. 前髪 — `frontHair.png`

- 前髪と頭頂部（頭の上と前を覆う髪）を1枚に。横髪・後ろ髪は含めない。いちばん手前に描かれる。

```text
Task: create ONE separate layer image for a layered 2D animation model (Live2D-style rig).
The attached image is the finalized standing character illustration, created BEFORE generating any part images. Use this same standing reference for every part; match its position, size, shape, colors, clothes and style.

Output rules:
- Exactly the same canvas size and aspect ratio as the reference image. Keep the part at the exact same position, scale and angle as in the reference.
- Draw ONLY the part described below. Everything else must be fully transparent (real alpha channel). No background color, no checkerboard pattern, no frame, no text or labels.
- Output exactly ONE PNG image for this part, not a contact sheet, sprite sheet or set of variations.
- Do not zoom in, crop, re-center or enlarge the part. Most of the canvas stays empty.
- Do not draw any other part, even partially, and no shadows cast by other parts.
- Where other parts cover this part in the reference, paint the hidden area so this part is complete on its own (it will move during animation).
- Same art style, line weight, colors and shading as the reference. Clean edges, no stray pixels; do not switch to a different style.

Part: FRONT HAIR — the bangs plus the top of the head.
Draw: the bangs and the hair covering the top and front of the head (crown), as in the reference, including the hair's shading and highlights. Keep the tips of the bangs exactly as in the reference.
Do not draw: the side locks hanging beside the face, the back hair behind the head and shoulders, the face, ears, eyebrows, or anything else.
```

#### 26. 横髪 L — `sideHairL.png`

- キャラ自身の左（画面の右）の横髪1房だけ。上端は前髪の下へ入り込むように描き足す（揺れても付け根に隙間が出ない）。

```text
Task: create ONE separate layer image for a layered 2D animation model (Live2D-style rig).
The attached image is the finalized standing character illustration, created BEFORE generating any part images. Use this same standing reference for every part; match its position, size, shape, colors, clothes and style.

Output rules:
- Exactly the same canvas size and aspect ratio as the reference image. Keep the part at the exact same position, scale and angle as in the reference.
- Draw ONLY the part described below. Everything else must be fully transparent (real alpha channel). No background color, no checkerboard pattern, no frame, no text or labels.
- Output exactly ONE PNG image for this part, not a contact sheet, sprite sheet or set of variations.
- Do not zoom in, crop, re-center or enlarge the part. Most of the canvas stays empty.
- Do not draw any other part, even partially, and no shadows cast by other parts.
- Where other parts cover this part in the reference, paint the hidden area so this part is complete on its own (it will move during animation).
- Same art style, line weight, colors and shading as the reference. Clean edges, no stray pixels; do not switch to a different style.

Part: SIDE LOCK — the lock of hair hanging beside the character's own left cheek (it appears on the RIGHT side of the image).
Draw: only this one lock of hair, with the same shape, shading and color as the reference.
Do not draw: the other side lock, bangs, back hair, face, ears, or anything else.
Complete hidden areas: extend the top of the lock upward under the bangs (to about the temple), so there is no gap at its root when the lock sways.
```

#### 27. 横髪 R — `sideHairR.png`

- キャラ自身の右（画面の左）の横髪1房だけ。上端は前髪の下へ入り込むように描き足す（揺れても付け根に隙間が出ない）。

```text
Task: create ONE separate layer image for a layered 2D animation model (Live2D-style rig).
The attached image is the finalized standing character illustration, created BEFORE generating any part images. Use this same standing reference for every part; match its position, size, shape, colors, clothes and style.

Output rules:
- Exactly the same canvas size and aspect ratio as the reference image. Keep the part at the exact same position, scale and angle as in the reference.
- Draw ONLY the part described below. Everything else must be fully transparent (real alpha channel). No background color, no checkerboard pattern, no frame, no text or labels.
- Output exactly ONE PNG image for this part, not a contact sheet, sprite sheet or set of variations.
- Do not zoom in, crop, re-center or enlarge the part. Most of the canvas stays empty.
- Do not draw any other part, even partially, and no shadows cast by other parts.
- Where other parts cover this part in the reference, paint the hidden area so this part is complete on its own (it will move during animation).
- Same art style, line weight, colors and shading as the reference. Clean edges, no stray pixels; do not switch to a different style.

Part: SIDE LOCK — the lock of hair hanging beside the character's own right cheek (it appears on the LEFT side of the image).
Draw: only this one lock of hair, with the same shape, shading and color as the reference.
Do not draw: the other side lock, bangs, back hair, face, ears, or anything else.
Complete hidden areas: extend the top of the lock upward under the bangs (to about the temple), so there is no gap at its root when the lock sways.
```

#### 28. 後ろ髪 — `backHair.png`

- 頭の後ろ側の髪すべて（肩や背中に流れる部分も含む）。いちばん奥に描かれる。
- 顔・頭・首の後ろも髪で塗りつぶし、穴を作らない（頭を回したりかしげたりしたとき、透明な所が見えない）。

```text
Task: create ONE separate layer image for a layered 2D animation model (Live2D-style rig).
The attached image is the finalized standing character illustration, created BEFORE generating any part images. Use this same standing reference for every part; match its position, size, shape, colors, clothes and style.

Output rules:
- Exactly the same canvas size and aspect ratio as the reference image. Keep the part at the exact same position, scale and angle as in the reference.
- Draw ONLY the part described below. Everything else must be fully transparent (real alpha channel). No background color, no checkerboard pattern, no frame, no text or labels.
- Output exactly ONE PNG image for this part, not a contact sheet, sprite sheet or set of variations.
- Do not zoom in, crop, re-center or enlarge the part. Most of the canvas stays empty.
- Do not draw any other part, even partially, and no shadows cast by other parts.
- Where other parts cover this part in the reference, paint the hidden area so this part is complete on its own (it will move during animation).
- Same art style, line weight, colors and shading as the reference. Clean edges, no stray pixels; do not switch to a different style.

Part: BACK HAIR — all hair behind the head.
Draw: the hair mass behind the head, including any hair falling behind the shoulders/back that is present in the reference, using the darker inner color of the hair. Keep the reference's hair length; do not add long hair to a short-haired character.
Do not draw: the bangs and top-of-head hair, side locks, face, ears, neck, body, or anything else.
Complete hidden areas: fill the whole area behind the face, head and neck with hair (one continuous silhouette, no hole and no skin where the face is), so nothing transparent shows when the head turns or tilts.
```

### 体

#### 29. 首 — `neck.png`

- 首だけ。上端はあごの裏へ大きく入り込むように描き足す（首をかしげても隙間が出ない）。
- 首は胴体より手前に描かれるので、下端は服の襟ぐりでぴったり止め、服の上に重ねない。

```text
Task: create ONE separate layer image for a layered 2D animation model (Live2D-style rig).
The attached image is the finalized standing character illustration, created BEFORE generating any part images. Use this same standing reference for every part; match its position, size, shape, colors, clothes and style.

Output rules:
- Exactly the same canvas size and aspect ratio as the reference image. Keep the part at the exact same position, scale and angle as in the reference.
- Draw ONLY the part described below. Everything else must be fully transparent (real alpha channel). No background color, no checkerboard pattern, no frame, no text or labels.
- Output exactly ONE PNG image for this part, not a contact sheet, sprite sheet or set of variations.
- Do not zoom in, crop, re-center or enlarge the part. Most of the canvas stays empty.
- Do not draw any other part, even partially, and no shadows cast by other parts.
- Where other parts cover this part in the reference, paint the hidden area so this part is complete on its own (it will move during animation).
- Same art style, line weight, colors and shading as the reference. Clean edges, no stray pixels; do not switch to a different style.

Part: NECK.
Draw: only the neck skin, in the same color and shading as the reference (a soft shadow under the jaw is fine).
Do not draw: face, chin outline, hair, clothes, collar, or anything else.
Complete hidden areas: extend the neck upward behind the chin and lower face (up to about mouth height), so no gap appears when the head tilts.
The bottom edge must stop exactly at the neckline of the clothes (this layer is drawn on top of the clothes, so it must not cover them).
```

#### 30. 胴体 — `torso.png`

- 胴体（服と、襟ぐりから見える肌）。服の裾より下に体が見える構図では、キャンバス下端までその部分も含める。腕・袖・首・頭・髪は含めない。
- 腕や髪に隠れた肩・脇も描き足す。襟ぐりの肌は首の下まで少し上へ伸ばす。
- `chest.png` を使う場合も、胸が重なる場所を透明にせず、同じ衣装・色で埋める。胸のレイヤーが動いたときの下地になる。

```text
Task: create ONE separate layer image for a layered 2D animation model (Live2D-style rig).
The attached image is the finalized standing character illustration, created BEFORE generating any part images. Use this same standing reference for every part; match its position, size, shape, colors, clothes and style.

Output rules:
- Exactly the same canvas size and aspect ratio as the reference image. Keep the part at the exact same position, scale and angle as in the reference.
- Draw ONLY the part described below. Everything else must be fully transparent (real alpha channel). No background color, no checkerboard pattern, no frame, no text or labels.
- Output exactly ONE PNG image for this part, not a contact sheet, sprite sheet or set of variations.
- Do not zoom in, crop, re-center or enlarge the part. Most of the canvas stays empty.
- Do not draw any other part, even partially, and no shadows cast by other parts.
- Where other parts cover this part in the reference, paint the hidden area so this part is complete on its own (it will move during animation).
- Same art style, line weight, colors and shading as the reference. Clean edges, no stray pixels; do not switch to a different style.

Part: TORSO — the main body with its clothes.
Draw: the main body from the shoulders down to the bottom edge of the canvas: the clothes, the skin visible inside the neckline, and any body portion visible below the garment hem in the reference. Preserve the reference framing and garment coverage.
Do not draw: arms, sleeves, hands, the neck above the neckline, head, hair, or anything else.
Keep the neckline and its trim on this torso layer. Finish each shoulder at the sleeve attachment seam, with only a small overlap beneath the separate sleeve layer; do not include sleeve fabric or sleeve hem trim.
Complete hidden areas: paint the shoulders and the sides of the body that are hidden behind the arms and the hair, and continue the neckline skin a little upward under where the neck is, so no hole appears when the arms, neck or hair move.
If a separate chest layer will be used, also paint matching clothing beneath its full area. Keep the torso solid there so that moving the chest layer never reveals transparent gaps.
```

#### 31. 腕 L — `armL.png`

- キャラ自身の左（画面の右）の腕1本（肩から袖・手まで）。
- 肩を軸に回るので、腕の付け根（肩・袖の上端）は丸く完結させ、胴体の肩に少し重なるように描き足す。

```text
Task: create ONE separate layer image for a layered 2D animation model (Live2D-style rig).
The attached image is the finalized standing character illustration, created BEFORE generating any part images. Use this same standing reference for every part; match its position, size, shape, colors, clothes and style.

Output rules:
- Exactly the same canvas size and aspect ratio as the reference image. Keep the part at the exact same position, scale and angle as in the reference.
- Draw ONLY the part described below. Everything else must be fully transparent (real alpha channel). No background color, no checkerboard pattern, no frame, no text or labels.
- Output exactly ONE PNG image for this part, not a contact sheet, sprite sheet or set of variations.
- Do not zoom in, crop, re-center or enlarge the part. Most of the canvas stays empty.
- Do not draw any other part, even partially, and no shadows cast by other parts.
- Where other parts cover this part in the reference, paint the hidden area so this part is complete on its own (it will move during animation).
- Same art style, line weight, colors and shading as the reference. Clean edges, no stray pixels; do not switch to a different style.

Part: ARM — the character's own left arm (it appears on the RIGHT side of the image).
Draw: the whole arm from the shoulder down to the hand, including the sleeve and the hand, as in the reference.
Do not draw: the other arm, the torso or bodice, neckline or collar trim, hair, or anything else. Sleeve hem trim belongs to this arm layer; neckline trim belongs only to the torso layer.
Complete hidden areas: paint the parts of the arm hidden behind hair, and make the top of the arm (shoulder joint / top of the sleeve) a complete rounded shape that overlaps slightly onto the torso's shoulder, because the arm rotates around the shoulder.
```

#### 32. 腕 R — `armR.png`

- キャラ自身の右（画面の左）の腕1本（肩から袖・手まで）。
- 肩を軸に回るので、腕の付け根（肩・袖の上端）は丸く完結させ、胴体の肩に少し重なるように描き足す。

```text
Task: create ONE separate layer image for a layered 2D animation model (Live2D-style rig).
The attached image is the finalized standing character illustration, created BEFORE generating any part images. Use this same standing reference for every part; match its position, size, shape, colors, clothes and style.

Output rules:
- Exactly the same canvas size and aspect ratio as the reference image. Keep the part at the exact same position, scale and angle as in the reference.
- Draw ONLY the part described below. Everything else must be fully transparent (real alpha channel). No background color, no checkerboard pattern, no frame, no text or labels.
- Output exactly ONE PNG image for this part, not a contact sheet, sprite sheet or set of variations.
- Do not zoom in, crop, re-center or enlarge the part. Most of the canvas stays empty.
- Do not draw any other part, even partially, and no shadows cast by other parts.
- Where other parts cover this part in the reference, paint the hidden area so this part is complete on its own (it will move during animation).
- Same art style, line weight, colors and shading as the reference. Clean edges, no stray pixels; do not switch to a different style.

Part: ARM — the character's own right arm (it appears on the LEFT side of the image).
Draw: the whole arm from the shoulder down to the hand, including the sleeve and the hand, as in the reference.
Do not draw: the other arm, the torso or bodice, neckline or collar trim, hair, or anything else. Sleeve hem trim belongs to this arm layer; neckline trim belongs only to the torso layer.
Complete hidden areas: paint the parts of the arm hidden behind hair, and make the top of the arm (shoulder joint / top of the sleeve) a complete rounded shape that overlaps slightly onto the torso's shoulder, because the arm rotates around the shoulder.
```

#### 33. 胸 — `chest.png`（胸揺れを使うときだけ）

- 衣装を含む胸の前面を1つの別レイヤーにする。上端と脇は胴体に留め、中ほどから下だけを弾ませる。
- 基準画像の位置・角度・衣装・模様を保つ。胴体の素材には、この胸のレイヤーの下も同じ衣装・色で塗り足し、動いても透明な穴が出ないようにする。
- 取り込み後は「その他」の自由パーツとして置き、胸揺れを設定する（7章）。胴体は標準パーツの「胴体」に割り当てる。胸の画像には内部の頂点があるメッシュが必要。

```text
Task: create ONE separate layer image for a layered 2D animation model (Live2D-style rig).
The attached image is the finalized standing character illustration, created BEFORE generating any part images. Use this same standing reference for every part; match its position, size, shape, colors, clothes and style.

Output rules:
- Exactly the same canvas size and aspect ratio as the reference image. Keep the part at the exact same position, scale and angle as in the reference.
- Draw ONLY the part described below. Everything else must be fully transparent (real alpha channel). No background color, no checkerboard pattern, no frame, no text or labels.
- Output exactly ONE PNG image for this part, not a contact sheet, sprite sheet or set of variations.
- Do not zoom in, crop, re-center or enlarge the part. Most of the canvas stays empty.
- Do not draw any other part, even partially, and no shadows cast by other parts.
- Where other parts cover this part in the reference, paint the hidden area so this part is complete on its own (it will move during animation).
- Same art style, line weight, colors and shading as the reference. Clean edges, no stray pixels; do not switch to a different style.

Part: CHEST — the front chest panel, including its clothing.
Draw: only the front chest panel with the exact clothes, colors, pattern and existing details of the reference. Keep the upper edge and both side edges aligned with the torso; the center and lower portion will move slightly during animation.
Do not draw: arms, hair, neck, the rest of the torso, or anything else. Do not change the costume or expose areas covered in the reference.
Complete hidden areas: paint small areas under overlapping hair and clothing so the panel is complete. The separate torso layer must also have matching clothing beneath this panel to prevent gaps; do not output that torso layer in this image.
```

### 追加素材のプロンプト

髪飾り・リボンなど、入力欄で別に動かすと指定した素材に使う。`[PART]` に素材の名前、立ち絵内の位置、含めるもの、含めないものを入れ、`[FILE_NAME]` を入力欄のファイル名に置き換える。ほかの素材と同じ `reference.png` を添付する。

```text
Create ONE separate part image from the attached finalized standing character reference. The standing illustration was created and finalized before this part-generation stage.
Part: [PART]
Save as: [FILE_NAME]
Keep exactly the same canvas width, height, position, scale, angle, colors and art style as the reference. Do not crop, zoom, re-center or redesign the part.
Draw only the specified part, completing any hidden attachment area under overlapping parts. Do not include surrounding skin, hair, clothes, other accessories or shadows cast by other parts unless explicitly included in the part definition.
Output ONE PNG with a real transparent alpha channel everywhere outside this part. No background, checkerboard pattern, contact sheet, sprite sheet, text or labels.
```

## 5. 取り込み前の確認

同じキャンバスを指定しても、生成結果の位置や縮尺がそろうとは限らない。以下は生成後の画像で確認する。元の生成PNGは残し、再生成した修正版や位置合わせ済みの素材は別名で保存する。

- 各ファイルが生成対象一覧で決めた名前の PNG で、1枚に1素材だけが入っている。
- 幅・高さがすべて `reference.png` と同じで、透明な余白を切り詰めていない。
- 素材以外の部分が実際に透明になっている。白背景や市松模様を描いた画像になっていない。
- 立ち絵に重ねると、素材の位置・大きさ・角度・色がそろう。Lが画面の右、Rが画面の左になっている。
- 顔には目・眉・口・髪を焼き込まず、瞳には別素材のハイライトを焼き込んでいない。髪や腕に隠れた部分を塗り足している。
- 目・口の分割版と「まとめて」版を重複して割り当てていない。胸を分けた場合は、胴体の下地も埋まっている。

取り込んだ後は、まばたき・視線・口の開閉・頭や腕の回転を試し、隙間や不要な線が出る素材を直す。

## 6. うまくいかないとき

- **パーツが拡大されたり、中央に描き直されたりする。** プロンプトの先頭を `Edit the attached image: erase everything except the <パーツ名>, keep it exactly where it is, then` に変える。インペイント（範囲を塗って編集）ができるAIなら、基準画像からほかの部分を消させる。
- **出力の大きさが違う・少しずれる。** 画像編集ソフトで基準画像の上に半透明で重ねて位置を合わせ、キャンバスを基準画像と同じ大きさにして PNG で書き出す。
- **ツール上で位置と拡縮を合わせる。** 素材の取り込み後に基準画像の比率へ合わせ、調整したメッシュ・配置を含むプロジェクトとして保存する。元のPNGを再取り込みしたりメッシュを作り直したりするときは、保存した配置を基準に合わせ直す。
- **胴体に袖が残る・腕に襟の線が残る。** 胴体は袖の接続位置で止め、腕には袖口の飾りだけを含める。修正対象の素材を参照画像にし、不要な部分だけを除く。ほかの素材の位置・大きさ・衣装は保つ。
- **透明の代わりに市松模様が描かれる。** 模様が絵として描かれている。2章の単色背景の方法に切り替える。
- **小さいパーツ（ハイライト・下まぶた・瞳）が崩れる。** 目の周りだけを拡大した画像で作ってから縮小して元の位置に置くか、手で描く（ハイライトは白い丸で足りる）。
- **上唇・下唇の肌色が顔と合わない。** 画像編集ソフトのスポイトで顔の肌色を取り、肌色の部分を塗り直す。
- **位置合わせを1か所でまとめたい。** 画像編集ソフトで全パーツをレイヤーとして1つの PSD にまとめ、合わせてから PSD を取り込んでもよい（PSD はレイヤーごとに素材になる）。

## 7. 取り込み・動作確認・保存

1. **生成対象のファイルをそろえる。** 2章で決めた一覧と実ファイルを照合する。省略したものを除いて欠けがなく、5章の確認が済んだら取り込む。`reference.png` は別に保管する。
2. **素材を読み込む。** ツールの「素材を読み込む」画面にパーツの PNG をまとめてドラッグ&ドロップする。大きさの違い・透過の警告が出た場合は、該当画像を直してから先へ進む。
3. **標準パーツへ割り当てる。** 素材トレイから右側の「標準パーツの割り当て」の各枠へドラッグする。4章の一覧でファイル名と部位を照合し、Lは画面の右、Rは画面の左として割り当てる。目・口は選んだ方式だけを使う。髪飾りなどの追加素材は「その他」の「自由パーツ」に入れ、名前を付ける。
4. **動きを付ける。** 割り当て後に「かんたんセットアップ」を実行する。胸を使う場合は下の追加手順も行う。
5. **動作を確認する。** 「パラメータ」で目の開閉・瞳の左右上下・口の開閉・顔の左右上下と傾き・腕の動きを試す。省略した部位やまとめて版で対応しない動きは除く。隙間、ずれ、顔に残った目や口の線があれば該当素材を直し、割り当てを更新して再確認する。
6. **プロジェクトを保存する。** 「保存」（Ctrl+S）または「名前を付けて保存…」を使う。保存したプロジェクトを開き直し、素材、配置、設定が保持されていることを確認する。

### 胸揺れを使う場合の追加手順

現在の通常の割り当て枠は32種類で、「胸」の枠はない。`chest.png` は「その他」の「自由パーツ」に入れて「胸」と名付ける。胸と胴体の下地を重ね、描画順を胴体より前、腕より後ろにする。

胸の画像パーツを選び、内部の頂点があるメッシュを用意する。「パーツの設定」で「軸で揺らす」を有効にし、種類を「胸」へ切り替える。胴体の画像パーツが接続先として割り当てられていることを確認し、「左右を試す」「上下を試す」で隙間や衣装のずれを確かめる。接続やメッシュについて案内が出た場合は、表示された内容を解消する。

### 完了条件

- 選んだ生成対象がすべて出力・保存され、省略した素材と理由が分かる。
- 各素材の透過、キャンバスサイズ、位置合わせ、隠れた部分の塗り足しを確認した。
- ツールへの取り込み・割り当て・セットアップが済み、対象の動きで隙間や不要な線が出ない。
- プロジェクトを保存し、開き直して素材と設定の保持を確認した。

ここまでで、このプロンプト集の工程は完了。未確認の項目が残る場合は、生成済みの素材と残る作業を分けて記録する。
