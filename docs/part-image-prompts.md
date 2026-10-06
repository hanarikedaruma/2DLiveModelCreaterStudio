# 標準パーツの画像生成プロンプト

標準パーツ 32 種類を、画像生成AIで **1パーツ = 1枚の別々の画像** として作るためのプロンプト集。
パーツの種類・左右・描画順・動き方は、このツールの実装（`packages/schema/src/rules.ts`、`packages/core/src/setup/motions.ts`、`apps/desktop/src/modes/modeling/assets/slots.ts`、`packages/io/src/import/importer.ts`）に合わせてある。

## 1. 前提（このツールの取り込みの仕様）

- **1パーツ = 1枚の PNG（背景は透明）。** PNG は1ファイルが1素材になる。透明な余白はツールが自動で切り落とし、元の位置は保たれる。
- **全部の画像を同じキャンバスサイズにし、キャラクターを同じ位置に置く。** 大きさが最初のファイルと違う PNG は左上 (0, 0) に置かれ、「大きさが違う」警告が出る。
- キャンバスの長辺は 1000〜8000px（範囲外は警告）。下のプロンプトは 1024×1536（縦長 2:3）を例にしている。
- 背景が塗られていると「透明な部分がほとんど無い」警告が出る。背景は必ず抜く。
- **L はキャラクター自身の左 = 画面の右。** R は画面の左。割り当て画面の「左目」もキャラ自身の左目（画面の右）。
- パーツどうしは別々に動くので、**ほかのパーツに隠れている部分も描き足す**（額・耳の付け根・首の上端・後ろ髪の内側・腕の付け根など）。描き足しが無いと、動かしたときに穴や隙間が見える。
- 割り当ては手動（割り当て画面の各枠に入れる）。パーツ名はファイル名になるので、ファイル名を下の表の `ファイル名` にしておくと迷わない。
- 「まとめて」版（目・口を1枚で作るもの）は簡易版。細かいパーツと**同時には割り当てない**。細かいパーツで作る場合は不要。

## 2. 進め方

1. **キャラクター設定を決める。** 下の `[CHARACTER]` に入れる文を1つ決め、以後すべて同じ文を使う。
2. **基準画像を1枚作る**（3章）。正面・左右対称・目を開けて口を閉じた全体の絵。これが全パーツの位置と絵柄の基準になる。
3. **パーツを1枚ずつ作る**（4章）。生成AIの「画像を添付して編集する」機能で、**毎回基準画像を添付**して、1回の生成で1パーツだけを出す。
   - 4章のプロンプトは、前半の共通ルールと後半のパーツ別の指示をまとめて1つにしてある。コードブロックをそのまま貼る。
   - 同じ会話の中で続けて作ると絵柄がそろいやすい。
4. **ずれを確かめる。** 画像編集ソフト（Krita・GIMP・Photoshop など）で基準画像の上に重ね、位置・大きさが合っているか、キャンバスサイズが同じかを確かめる。
5. **ツールに取り込む。** 「素材を読み込む」画面に PNG をまとめてドラッグ&ドロップし、割り当て画面で各枠に入れる。

### 透明背景を出せない生成AIの場合

共通ルールの2行目（`Draw ONLY the part ...`）を次に差し替え、生成後に画像編集ソフトの「色を透明に」で背景色を抜く。キャラに緑を使っている場合は `#00FF00` を `#FF00FF`（マゼンタ）に変える。

```text
- Draw ONLY the part described below, on a flat solid #00FF00 green background (one uniform color, no gradient, no shadow, no texture). No checkerboard pattern, no frame, no text or labels.
```

## 3. 基準画像

### キャラクター設定 `[CHARACTER]` の例

自分のキャラクターに書き換えて使う。前髪は眉より上、横髪は耳の前に1房ずつ、服は襟ぐりの単純なもの、が分けやすい。

```text
An anime girl around 17 years old. Medium-long chestnut-brown hair with straight-cut bangs and one long side lock in front of each ear. Large blue eyes. Light skin. Wearing a simple light-blue short-sleeved dress with a round neckline.
```

### 基準画像のプロンプト

`[CHARACTER]` を上の設定に置き換えて使う。

```text
Create a reference illustration for a layered 2D animation model (Live2D-style rig). It will later be split into separate part layers, so the design must be clean and easy to separate.

Character: [CHARACTER]

Pose and expression:
- Perfectly front-facing and left-right symmetrical, head upright with no tilt, looking straight at the viewer.
- Neutral calm expression, both eyes fully open, mouth closed (a simple short line), eyebrows relaxed.
- Arms relaxed and hanging straight down, slightly away from the body so there is a small gap between the arms and the torso. Both hands visible and open.
- Both ears visible at the sides of the head.

Framing:
- Portrait canvas, 2:3 aspect ratio (e.g. 1024x1536). From the top of the head down to the hips.
- Head centered horizontally. Top of the hair about 10% below the top edge, chin at about 45% of the height; the body continues to the bottom edge.

Design constraints (for easy part separation):
- Bangs end at or above the eyebrows; one side lock hangs in front of each ear; the back hair falls behind the shoulders.
- Simple neckline (round or V neck). No high collar, scarf, necktie, hood, headphones, glasses, masks or hats.
- No hair strands crossing the eyes or mouth; no hands touching the face; nothing held in the hands.

Style: clean anime cel shading, clear line art, flat colors with simple 1-2 tone shadows. No complex lighting, no rim light, no glow, no motion blur, no depth of field, no text, no watermark.
Background: transparent (or flat plain white).
```

## 4. パーツ別のプロンプト

★ はツールの割り当て画面で推奨になっているパーツ。並びは割り当て画面と同じ。

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

### 顔

#### 1. 顔 — `face.png`

- 頭の土台になる肌。輪郭と鼻は顔に含める。目・眉・口・頬染め・耳・髪は描かず、目や口の所は素肌のままにする。
- 前髪・横髪に隠れている額やこめかみも肌で描き足す（頭を回したとき、髪の下から肌が見える）。髪の影は顔に描かない。

```text
Task: create ONE separate layer image for a layered 2D animation model (Live2D-style rig).
The attached image is the reference (the whole character). Use it only to match position, size, shape, colors and style.

Output rules:
- Exactly the same canvas size and aspect ratio as the reference image. Keep the part at the exact same position, scale and angle as in the reference.
- Draw ONLY the part described below. Everything else must be fully transparent (real alpha channel). No background color, no checkerboard pattern, no frame, no text or labels.
- Do not zoom in, crop, re-center or enlarge the part. Most of the canvas stays empty.
- Do not draw any other part, even partially, and no shadows cast by other parts.
- Where other parts cover this part in the reference, paint the hidden area so this part is complete on its own (it will move during animation).
- Same art style, line weight, colors and cel shading as the reference. Clean hard edges, no glow, no stray pixels.

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
The attached image is the reference (the whole character). Use it only to match position, size, shape, colors and style.

Output rules:
- Exactly the same canvas size and aspect ratio as the reference image. Keep the part at the exact same position, scale and angle as in the reference.
- Draw ONLY the part described below. Everything else must be fully transparent (real alpha channel). No background color, no checkerboard pattern, no frame, no text or labels.
- Do not zoom in, crop, re-center or enlarge the part. Most of the canvas stays empty.
- Do not draw any other part, even partially, and no shadows cast by other parts.
- Where other parts cover this part in the reference, paint the hidden area so this part is complete on its own (it will move during animation).
- Same art style, line weight, colors and cel shading as the reference. Clean hard edges, no glow, no stray pixels.

Part: EAR — the character's own left ear (it appears on the RIGHT side of the image).
Draw: only this one ear with its inner details, in the same skin color and line art as the reference.
Do not draw: the other ear, face, hair, or anything else.
Complete hidden areas: draw the whole ear even where hair covers it, and extend the base of the ear a little inward (toward the face center) under the face edge, so the ear stays attached when the head turns.
```

#### 3. 耳 R — `earR.png`

- キャラ自身の右（画面の左）の耳1つだけ。髪や顔の輪郭に隠れた所と付け根も描き足す（頭を回すと顔の後ろからのぞく）。

```text
Task: create ONE separate layer image for a layered 2D animation model (Live2D-style rig).
The attached image is the reference (the whole character). Use it only to match position, size, shape, colors and style.

Output rules:
- Exactly the same canvas size and aspect ratio as the reference image. Keep the part at the exact same position, scale and angle as in the reference.
- Draw ONLY the part described below. Everything else must be fully transparent (real alpha channel). No background color, no checkerboard pattern, no frame, no text or labels.
- Do not zoom in, crop, re-center or enlarge the part. Most of the canvas stays empty.
- Do not draw any other part, even partially, and no shadows cast by other parts.
- Where other parts cover this part in the reference, paint the hidden area so this part is complete on its own (it will move during animation).
- Same art style, line weight, colors and cel shading as the reference. Clean hard edges, no glow, no stray pixels.

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
The attached image is the reference (the whole character). Use it only to match position, size, shape, colors and style.

Output rules:
- Exactly the same canvas size and aspect ratio as the reference image. Keep the part at the exact same position, scale and angle as in the reference.
- Draw ONLY the part described below. Everything else must be fully transparent (real alpha channel). No background color, no checkerboard pattern, no frame, no text or labels.
- Do not zoom in, crop, re-center or enlarge the part. Most of the canvas stays empty.
- Do not draw any other part, even partially, and no shadows cast by other parts.
- Where other parts cover this part in the reference, paint the hidden area so this part is complete on its own (it will move during animation).
- Same art style, line weight, colors and cel shading as the reference. Clean hard edges, no glow, no stray pixels.

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
The attached image is the reference (the whole character). Use it only to match position, size, shape, colors and style.

Output rules:
- Exactly the same canvas size and aspect ratio as the reference image. Keep the part at the exact same position, scale and angle as in the reference.
- Draw ONLY the part described below. Everything else must be fully transparent (real alpha channel). No background color, no checkerboard pattern, no frame, no text or labels.
- Do not zoom in, crop, re-center or enlarge the part. Most of the canvas stays empty.
- Do not draw any other part, even partially, and no shadows cast by other parts.
- Where other parts cover this part in the reference, paint the hidden area so this part is complete on its own (it will move during animation).
- Same art style, line weight, colors and cel shading as the reference. Clean hard edges, no glow, no stray pixels.

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
The attached image is the reference (the whole character). Use it only to match position, size, shape, colors and style.

Output rules:
- Exactly the same canvas size and aspect ratio as the reference image. Keep the part at the exact same position, scale and angle as in the reference.
- Draw ONLY the part described below. Everything else must be fully transparent (real alpha channel). No background color, no checkerboard pattern, no frame, no text or labels.
- Do not zoom in, crop, re-center or enlarge the part. Most of the canvas stays empty.
- Do not draw any other part, even partially, and no shadows cast by other parts.
- Where other parts cover this part in the reference, paint the hidden area so this part is complete on its own (it will move during animation).
- Same art style, line weight, colors and cel shading as the reference. Clean hard edges, no glow, no stray pixels.

Part: IRIS of the character's own left eye (it appears on the RIGHT side of the image).
Draw: only the iris with the pupil and its color gradient, as a complete round/oval shape, with the same color and size as in the reference.
Do not draw: highlights (they are a separate layer), eye white, eyelashes, eyelid lines, the other eye, or skin.
Complete hidden areas: the iris must be a full, uncut circle/oval — also paint the parts covered by the upper eyelid or lying outside the eye white (it is clipped by the eye white later and moves when the character looks around).
```

#### 7. ハイライト L — `highlightL.png`

- キャラ自身の左目（画面の右）。瞳の上の白い光だけ。白目の形で切り抜かれる。

```text
Task: create ONE separate layer image for a layered 2D animation model (Live2D-style rig).
The attached image is the reference (the whole character). Use it only to match position, size, shape, colors and style.

Output rules:
- Exactly the same canvas size and aspect ratio as the reference image. Keep the part at the exact same position, scale and angle as in the reference.
- Draw ONLY the part described below. Everything else must be fully transparent (real alpha channel). No background color, no checkerboard pattern, no frame, no text or labels.
- Do not zoom in, crop, re-center or enlarge the part. Most of the canvas stays empty.
- Do not draw any other part, even partially, and no shadows cast by other parts.
- Where other parts cover this part in the reference, paint the hidden area so this part is complete on its own (it will move during animation).
- Same art style, line weight, colors and cel shading as the reference. Clean hard edges, no glow, no stray pixels.

Part: EYE HIGHLIGHTS of the character's own left eye (it appears on the RIGHT side of the image).
Draw: only the white light reflections (catchlights) that sit on the iris, at the same positions and sizes as in the reference. Pure white or a very light color.
Do not draw: iris, pupil, eye white, eyelashes, eyelid lines, the other eye, or anything else.
```

#### 8. 上まぶた L ★ — `upperLidL.png`

- キャラ自身の左目（画面の右）。上まぶたの線とまつげだけ。二重の線は描かない。
- まばたきではこの1枚が白目の下端まで下がり、閉じた目の線になる。

```text
Task: create ONE separate layer image for a layered 2D animation model (Live2D-style rig).
The attached image is the reference (the whole character). Use it only to match position, size, shape, colors and style.

Output rules:
- Exactly the same canvas size and aspect ratio as the reference image. Keep the part at the exact same position, scale and angle as in the reference.
- Draw ONLY the part described below. Everything else must be fully transparent (real alpha channel). No background color, no checkerboard pattern, no frame, no text or labels.
- Do not zoom in, crop, re-center or enlarge the part. Most of the canvas stays empty.
- Do not draw any other part, even partially, and no shadows cast by other parts.
- Where other parts cover this part in the reference, paint the hidden area so this part is complete on its own (it will move during animation).
- Same art style, line weight, colors and cel shading as the reference. Clean hard edges, no glow, no stray pixels.

Part: UPPER EYELID of the character's own left eye (it appears on the RIGHT side of the image).
Draw: only the upper eyelid line with its eyelashes (the thick dark line along the top edge of the eye, including the lashes at the outer corner).
Do not draw: eye white, iris, highlights, lower eyelid, double-eyelid crease, eyebrow, the other eye, or skin.
Note: this layer slides down to close the eye, so draw it as one clean, self-contained shape.
```

#### 9. 下まぶた L — `lowerLidL.png`

- キャラ自身の左目（画面の右）。下まぶたの線（下まつげ）だけ。目を閉じるときに少し上がる。

```text
Task: create ONE separate layer image for a layered 2D animation model (Live2D-style rig).
The attached image is the reference (the whole character). Use it only to match position, size, shape, colors and style.

Output rules:
- Exactly the same canvas size and aspect ratio as the reference image. Keep the part at the exact same position, scale and angle as in the reference.
- Draw ONLY the part described below. Everything else must be fully transparent (real alpha channel). No background color, no checkerboard pattern, no frame, no text or labels.
- Do not zoom in, crop, re-center or enlarge the part. Most of the canvas stays empty.
- Do not draw any other part, even partially, and no shadows cast by other parts.
- Where other parts cover this part in the reference, paint the hidden area so this part is complete on its own (it will move during animation).
- Same art style, line weight, colors and cel shading as the reference. Clean hard edges, no glow, no stray pixels.

Part: LOWER EYELID of the character's own left eye (it appears on the RIGHT side of the image).
Draw: only the lower eyelid line / lower lashes along the bottom edge of the eye, with the same thickness and color as in the reference.
Do not draw: eye white, iris, highlights, upper eyelid, eyebrow, the other eye, or skin.
```

#### 10. 目（まとめて）L — `eyeWholeL.png`

- キャラ自身の左目（画面の右）。【まとめて版】目を1枚で済ませるときだけ使う。白目・瞳・ハイライト・上下のまぶたを1枚に合成した開いた目。眉は含めない。
- 上の5枚と同時には割り当てない。この方式ではまばたきは目全体を縦に縮めるだけになり、視線も動かない。

```text
Task: create ONE separate layer image for a layered 2D animation model (Live2D-style rig).
The attached image is the reference (the whole character). Use it only to match position, size, shape, colors and style.

Output rules:
- Exactly the same canvas size and aspect ratio as the reference image. Keep the part at the exact same position, scale and angle as in the reference.
- Draw ONLY the part described below. Everything else must be fully transparent (real alpha channel). No background color, no checkerboard pattern, no frame, no text or labels.
- Do not zoom in, crop, re-center or enlarge the part. Most of the canvas stays empty.
- Do not draw any other part, even partially, and no shadows cast by other parts.
- Where other parts cover this part in the reference, paint the hidden area so this part is complete on its own (it will move during animation).
- Same art style, line weight, colors and cel shading as the reference. Clean hard edges, no glow, no stray pixels.

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
The attached image is the reference (the whole character). Use it only to match position, size, shape, colors and style.

Output rules:
- Exactly the same canvas size and aspect ratio as the reference image. Keep the part at the exact same position, scale and angle as in the reference.
- Draw ONLY the part described below. Everything else must be fully transparent (real alpha channel). No background color, no checkerboard pattern, no frame, no text or labels.
- Do not zoom in, crop, re-center or enlarge the part. Most of the canvas stays empty.
- Do not draw any other part, even partially, and no shadows cast by other parts.
- Where other parts cover this part in the reference, paint the hidden area so this part is complete on its own (it will move during animation).
- Same art style, line weight, colors and cel shading as the reference. Clean hard edges, no glow, no stray pixels.

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
The attached image is the reference (the whole character). Use it only to match position, size, shape, colors and style.

Output rules:
- Exactly the same canvas size and aspect ratio as the reference image. Keep the part at the exact same position, scale and angle as in the reference.
- Draw ONLY the part described below. Everything else must be fully transparent (real alpha channel). No background color, no checkerboard pattern, no frame, no text or labels.
- Do not zoom in, crop, re-center or enlarge the part. Most of the canvas stays empty.
- Do not draw any other part, even partially, and no shadows cast by other parts.
- Where other parts cover this part in the reference, paint the hidden area so this part is complete on its own (it will move during animation).
- Same art style, line weight, colors and cel shading as the reference. Clean hard edges, no glow, no stray pixels.

Part: IRIS of the character's own right eye (it appears on the LEFT side of the image).
Draw: only the iris with the pupil and its color gradient, as a complete round/oval shape, with the same color and size as in the reference.
Do not draw: highlights (they are a separate layer), eye white, eyelashes, eyelid lines, the other eye, or skin.
Complete hidden areas: the iris must be a full, uncut circle/oval — also paint the parts covered by the upper eyelid or lying outside the eye white (it is clipped by the eye white later and moves when the character looks around).
```

#### 13. ハイライト R — `highlightR.png`

- キャラ自身の右目（画面の左）。瞳の上の白い光だけ。白目の形で切り抜かれる。

```text
Task: create ONE separate layer image for a layered 2D animation model (Live2D-style rig).
The attached image is the reference (the whole character). Use it only to match position, size, shape, colors and style.

Output rules:
- Exactly the same canvas size and aspect ratio as the reference image. Keep the part at the exact same position, scale and angle as in the reference.
- Draw ONLY the part described below. Everything else must be fully transparent (real alpha channel). No background color, no checkerboard pattern, no frame, no text or labels.
- Do not zoom in, crop, re-center or enlarge the part. Most of the canvas stays empty.
- Do not draw any other part, even partially, and no shadows cast by other parts.
- Where other parts cover this part in the reference, paint the hidden area so this part is complete on its own (it will move during animation).
- Same art style, line weight, colors and cel shading as the reference. Clean hard edges, no glow, no stray pixels.

Part: EYE HIGHLIGHTS of the character's own right eye (it appears on the LEFT side of the image).
Draw: only the white light reflections (catchlights) that sit on the iris, at the same positions and sizes as in the reference. Pure white or a very light color.
Do not draw: iris, pupil, eye white, eyelashes, eyelid lines, the other eye, or anything else.
```

#### 14. 上まぶた R ★ — `upperLidR.png`

- キャラ自身の右目（画面の左）。上まぶたの線とまつげだけ。二重の線は描かない。
- まばたきではこの1枚が白目の下端まで下がり、閉じた目の線になる。

```text
Task: create ONE separate layer image for a layered 2D animation model (Live2D-style rig).
The attached image is the reference (the whole character). Use it only to match position, size, shape, colors and style.

Output rules:
- Exactly the same canvas size and aspect ratio as the reference image. Keep the part at the exact same position, scale and angle as in the reference.
- Draw ONLY the part described below. Everything else must be fully transparent (real alpha channel). No background color, no checkerboard pattern, no frame, no text or labels.
- Do not zoom in, crop, re-center or enlarge the part. Most of the canvas stays empty.
- Do not draw any other part, even partially, and no shadows cast by other parts.
- Where other parts cover this part in the reference, paint the hidden area so this part is complete on its own (it will move during animation).
- Same art style, line weight, colors and cel shading as the reference. Clean hard edges, no glow, no stray pixels.

Part: UPPER EYELID of the character's own right eye (it appears on the LEFT side of the image).
Draw: only the upper eyelid line with its eyelashes (the thick dark line along the top edge of the eye, including the lashes at the outer corner).
Do not draw: eye white, iris, highlights, lower eyelid, double-eyelid crease, eyebrow, the other eye, or skin.
Note: this layer slides down to close the eye, so draw it as one clean, self-contained shape.
```

#### 15. 下まぶた R — `lowerLidR.png`

- キャラ自身の右目（画面の左）。下まぶたの線（下まつげ）だけ。目を閉じるときに少し上がる。

```text
Task: create ONE separate layer image for a layered 2D animation model (Live2D-style rig).
The attached image is the reference (the whole character). Use it only to match position, size, shape, colors and style.

Output rules:
- Exactly the same canvas size and aspect ratio as the reference image. Keep the part at the exact same position, scale and angle as in the reference.
- Draw ONLY the part described below. Everything else must be fully transparent (real alpha channel). No background color, no checkerboard pattern, no frame, no text or labels.
- Do not zoom in, crop, re-center or enlarge the part. Most of the canvas stays empty.
- Do not draw any other part, even partially, and no shadows cast by other parts.
- Where other parts cover this part in the reference, paint the hidden area so this part is complete on its own (it will move during animation).
- Same art style, line weight, colors and cel shading as the reference. Clean hard edges, no glow, no stray pixels.

Part: LOWER EYELID of the character's own right eye (it appears on the LEFT side of the image).
Draw: only the lower eyelid line / lower lashes along the bottom edge of the eye, with the same thickness and color as in the reference.
Do not draw: eye white, iris, highlights, upper eyelid, eyebrow, the other eye, or skin.
```

#### 16. 目（まとめて）R — `eyeWholeR.png`

- キャラ自身の右目（画面の左）。【まとめて版】目を1枚で済ませるときだけ使う。白目・瞳・ハイライト・上下のまぶたを1枚に合成した開いた目。眉は含めない。
- 上の5枚と同時には割り当てない。この方式ではまばたきは目全体を縦に縮めるだけになり、視線も動かない。

```text
Task: create ONE separate layer image for a layered 2D animation model (Live2D-style rig).
The attached image is the reference (the whole character). Use it only to match position, size, shape, colors and style.

Output rules:
- Exactly the same canvas size and aspect ratio as the reference image. Keep the part at the exact same position, scale and angle as in the reference.
- Draw ONLY the part described below. Everything else must be fully transparent (real alpha channel). No background color, no checkerboard pattern, no frame, no text or labels.
- Do not zoom in, crop, re-center or enlarge the part. Most of the canvas stays empty.
- Do not draw any other part, even partially, and no shadows cast by other parts.
- Where other parts cover this part in the reference, paint the hidden area so this part is complete on its own (it will move during animation).
- Same art style, line weight, colors and cel shading as the reference. Clean hard edges, no glow, no stray pixels.

Part: WHOLE EYE (single-layer version) of the character's own right eye (it appears on the LEFT side of the image).
Draw: the complete open eye exactly as in the reference — eye white, iris, pupil, highlights, upper eyelid with lashes and lower eyelid — merged into one layer.
Do not draw: eyebrow, the other eye, the skin around the eye, or anything else.
```

### 眉

#### 17. 眉 L — `browL.png`

- キャラ自身の左（画面の右）の眉1本だけ。前髪に隠れている部分も描き足す。

```text
Task: create ONE separate layer image for a layered 2D animation model (Live2D-style rig).
The attached image is the reference (the whole character). Use it only to match position, size, shape, colors and style.

Output rules:
- Exactly the same canvas size and aspect ratio as the reference image. Keep the part at the exact same position, scale and angle as in the reference.
- Draw ONLY the part described below. Everything else must be fully transparent (real alpha channel). No background color, no checkerboard pattern, no frame, no text or labels.
- Do not zoom in, crop, re-center or enlarge the part. Most of the canvas stays empty.
- Do not draw any other part, even partially, and no shadows cast by other parts.
- Where other parts cover this part in the reference, paint the hidden area so this part is complete on its own (it will move during animation).
- Same art style, line weight, colors and cel shading as the reference. Clean hard edges, no glow, no stray pixels.

Part: EYEBROW — the character's own left eyebrow (it appears on the RIGHT side of the image).
Draw: only this one eyebrow, with the same shape, thickness and color as the reference.
Do not draw: the other eyebrow, eyes, hair, skin, or anything else.
Complete hidden areas: if the bangs cover part of the eyebrow, draw the full eyebrow.
```

#### 18. 眉 R — `browR.png`

- キャラ自身の右（画面の左）の眉1本だけ。前髪に隠れている部分も描き足す。

```text
Task: create ONE separate layer image for a layered 2D animation model (Live2D-style rig).
The attached image is the reference (the whole character). Use it only to match position, size, shape, colors and style.

Output rules:
- Exactly the same canvas size and aspect ratio as the reference image. Keep the part at the exact same position, scale and angle as in the reference.
- Draw ONLY the part described below. Everything else must be fully transparent (real alpha channel). No background color, no checkerboard pattern, no frame, no text or labels.
- Do not zoom in, crop, re-center or enlarge the part. Most of the canvas stays empty.
- Do not draw any other part, even partially, and no shadows cast by other parts.
- Where other parts cover this part in the reference, paint the hidden area so this part is complete on its own (it will move during animation).
- Same art style, line weight, colors and cel shading as the reference. Clean hard edges, no glow, no stray pixels.

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
The attached image is the reference (the whole character). Use it only to match position, size, shape, colors and style.

Output rules:
- Exactly the same canvas size and aspect ratio as the reference image. Keep the part at the exact same position, scale and angle as in the reference.
- Draw ONLY the part described below. Everything else must be fully transparent (real alpha channel). No background color, no checkerboard pattern, no frame, no text or labels.
- Do not zoom in, crop, re-center or enlarge the part. Most of the canvas stays empty.
- Do not draw any other part, even partially, and no shadows cast by other parts.
- Where other parts cover this part in the reference, paint the hidden area so this part is complete on its own (it will move during animation).
- Same art style, line weight, colors and cel shading as the reference. Clean hard edges, no glow, no stray pixels.

Part: UPPER LIP (the upper half of the closed mouth).
Draw: the closed mouth line exactly as in the reference, plus a patch of the face's skin color directly ABOVE that line: a half-ellipse whose flat bottom edge is the mouth line, about 1.2 times as wide as the mouth line and about 0.3 times as tall as the mouth line is long. The skin patch has no outline and must blend invisibly into the face.
Do not draw: lower lip, mouth interior, teeth, tongue, nose, or the rest of the face.
```

#### 20. 下唇 ★ — `lowerLip.png`

- 閉じた口の下半分。口の線の下に顔と同じ肌色の半楕円（下唇の小さな影があれば含める）。口の線そのものは上唇に入れるので描かない。
- 口を開くとこの1枚が下がる。

```text
Task: create ONE separate layer image for a layered 2D animation model (Live2D-style rig).
The attached image is the reference (the whole character). Use it only to match position, size, shape, colors and style.

Output rules:
- Exactly the same canvas size and aspect ratio as the reference image. Keep the part at the exact same position, scale and angle as in the reference.
- Draw ONLY the part described below. Everything else must be fully transparent (real alpha channel). No background color, no checkerboard pattern, no frame, no text or labels.
- Do not zoom in, crop, re-center or enlarge the part. Most of the canvas stays empty.
- Do not draw any other part, even partially, and no shadows cast by other parts.
- Where other parts cover this part in the reference, paint the hidden area so this part is complete on its own (it will move during animation).
- Same art style, line weight, colors and cel shading as the reference. Clean hard edges, no glow, no stray pixels.

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
The attached image is the reference (the whole character). Use it only to match position, size, shape, colors and style.

Output rules:
- Exactly the same canvas size and aspect ratio as the reference image. Keep the part at the exact same position, scale and angle as in the reference.
- Draw ONLY the part described below. Everything else must be fully transparent (real alpha channel). No background color, no checkerboard pattern, no frame, no text or labels.
- Do not zoom in, crop, re-center or enlarge the part. Most of the canvas stays empty.
- Do not draw any other part, even partially, and no shadows cast by other parts.
- Where other parts cover this part in the reference, paint the hidden area so this part is complete on its own (it will move during animation).
- Same art style, line weight, colors and cel shading as the reference. Clean hard edges, no glow, no stray pixels.

Part: MOUTH INTERIOR (the inside of an opened mouth). The reference has a closed mouth, so invent this shape.
Draw: only the dark inside of the mouth as one filled shape (dark red / maroon, slightly darker toward the throat), shaped like a moderately opened mouth: about as wide as the closed mouth line, and about 40% as tall as it is wide. Center it vertically and horizontally on the closed mouth line of the reference.
Do not draw: lips, the mouth line, teeth, tongue, skin, or anything else.
```

#### 22. 歯 — `teeth.png`

- 上の歯の列だけ。口の中の上端に沿わせる。口の中の形で切り抜かれるので、多少はみ出してよい。

```text
Task: create ONE separate layer image for a layered 2D animation model (Live2D-style rig).
The attached image is the reference (the whole character). Use it only to match position, size, shape, colors and style.

Output rules:
- Exactly the same canvas size and aspect ratio as the reference image. Keep the part at the exact same position, scale and angle as in the reference.
- Draw ONLY the part described below. Everything else must be fully transparent (real alpha channel). No background color, no checkerboard pattern, no frame, no text or labels.
- Do not zoom in, crop, re-center or enlarge the part. Most of the canvas stays empty.
- Do not draw any other part, even partially, and no shadows cast by other parts.
- Where other parts cover this part in the reference, paint the hidden area so this part is complete on its own (it will move during animation).
- Same art style, line weight, colors and cel shading as the reference. Clean hard edges, no glow, no stray pixels.

Part: UPPER TEETH.
Draw: only a row of upper teeth as one simple white band (anime style, little or no gap between teeth), lying along the top edge of the mouth interior, horizontally centered on the mouth line of the reference.
Do not draw: mouth interior, tongue, lips, skin, or anything else.
It may extend a little beyond the mouth opening; it is clipped later.
```

#### 23. 舌 — `tongue.png`

- 舌だけ。口の中の下側に置く。切り抜かれるので外へはみ出してよい。

```text
Task: create ONE separate layer image for a layered 2D animation model (Live2D-style rig).
The attached image is the reference (the whole character). Use it only to match position, size, shape, colors and style.

Output rules:
- Exactly the same canvas size and aspect ratio as the reference image. Keep the part at the exact same position, scale and angle as in the reference.
- Draw ONLY the part described below. Everything else must be fully transparent (real alpha channel). No background color, no checkerboard pattern, no frame, no text or labels.
- Do not zoom in, crop, re-center or enlarge the part. Most of the canvas stays empty.
- Do not draw any other part, even partially, and no shadows cast by other parts.
- Where other parts cover this part in the reference, paint the hidden area so this part is complete on its own (it will move during animation).
- Same art style, line weight, colors and cel shading as the reference. Clean hard edges, no glow, no stray pixels.

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
The attached image is the reference (the whole character). Use it only to match position, size, shape, colors and style.

Output rules:
- Exactly the same canvas size and aspect ratio as the reference image. Keep the part at the exact same position, scale and angle as in the reference.
- Draw ONLY the part described below. Everything else must be fully transparent (real alpha channel). No background color, no checkerboard pattern, no frame, no text or labels.
- Do not zoom in, crop, re-center or enlarge the part. Most of the canvas stays empty.
- Do not draw any other part, even partially, and no shadows cast by other parts.
- Where other parts cover this part in the reference, paint the hidden area so this part is complete on its own (it will move during animation).
- Same art style, line weight, colors and cel shading as the reference. Clean hard edges, no glow, no stray pixels.

Part: WHOLE MOUTH (single-layer version).
Draw: the mouth as one layer at the same position and width as in the reference, as a small, slightly opened mouth (a thin dark opening with its outline), so that stretching it vertically looks like opening the mouth.
Do not draw: nose, chin, the skin around the mouth, or anything else.
```

### 髪

#### 25. 前髪 — `frontHair.png`

- 前髪と頭頂部（頭の上と前を覆う髪）を1枚に。横髪・後ろ髪は含めない。いちばん手前に描かれる。

```text
Task: create ONE separate layer image for a layered 2D animation model (Live2D-style rig).
The attached image is the reference (the whole character). Use it only to match position, size, shape, colors and style.

Output rules:
- Exactly the same canvas size and aspect ratio as the reference image. Keep the part at the exact same position, scale and angle as in the reference.
- Draw ONLY the part described below. Everything else must be fully transparent (real alpha channel). No background color, no checkerboard pattern, no frame, no text or labels.
- Do not zoom in, crop, re-center or enlarge the part. Most of the canvas stays empty.
- Do not draw any other part, even partially, and no shadows cast by other parts.
- Where other parts cover this part in the reference, paint the hidden area so this part is complete on its own (it will move during animation).
- Same art style, line weight, colors and cel shading as the reference. Clean hard edges, no glow, no stray pixels.

Part: FRONT HAIR — the bangs plus the top of the head.
Draw: the bangs and the hair covering the top and front of the head (crown), as in the reference, including the hair's shading and highlights. Keep the tips of the bangs exactly as in the reference.
Do not draw: the side locks hanging beside the face, the back hair behind the head and shoulders, the face, ears, eyebrows, or anything else.
```

#### 26. 横髪 L — `sideHairL.png`

- キャラ自身の左（画面の右）の横髪1房だけ。上端は前髪の下へ入り込むように描き足す（揺れても付け根に隙間が出ない）。

```text
Task: create ONE separate layer image for a layered 2D animation model (Live2D-style rig).
The attached image is the reference (the whole character). Use it only to match position, size, shape, colors and style.

Output rules:
- Exactly the same canvas size and aspect ratio as the reference image. Keep the part at the exact same position, scale and angle as in the reference.
- Draw ONLY the part described below. Everything else must be fully transparent (real alpha channel). No background color, no checkerboard pattern, no frame, no text or labels.
- Do not zoom in, crop, re-center or enlarge the part. Most of the canvas stays empty.
- Do not draw any other part, even partially, and no shadows cast by other parts.
- Where other parts cover this part in the reference, paint the hidden area so this part is complete on its own (it will move during animation).
- Same art style, line weight, colors and cel shading as the reference. Clean hard edges, no glow, no stray pixels.

Part: SIDE LOCK — the lock of hair hanging beside the character's own left cheek (it appears on the RIGHT side of the image).
Draw: only this one lock of hair, with the same shape, shading and color as the reference.
Do not draw: the other side lock, bangs, back hair, face, ears, or anything else.
Complete hidden areas: extend the top of the lock upward under the bangs (to about the temple), so there is no gap at its root when the lock sways.
```

#### 27. 横髪 R — `sideHairR.png`

- キャラ自身の右（画面の左）の横髪1房だけ。上端は前髪の下へ入り込むように描き足す（揺れても付け根に隙間が出ない）。

```text
Task: create ONE separate layer image for a layered 2D animation model (Live2D-style rig).
The attached image is the reference (the whole character). Use it only to match position, size, shape, colors and style.

Output rules:
- Exactly the same canvas size and aspect ratio as the reference image. Keep the part at the exact same position, scale and angle as in the reference.
- Draw ONLY the part described below. Everything else must be fully transparent (real alpha channel). No background color, no checkerboard pattern, no frame, no text or labels.
- Do not zoom in, crop, re-center or enlarge the part. Most of the canvas stays empty.
- Do not draw any other part, even partially, and no shadows cast by other parts.
- Where other parts cover this part in the reference, paint the hidden area so this part is complete on its own (it will move during animation).
- Same art style, line weight, colors and cel shading as the reference. Clean hard edges, no glow, no stray pixels.

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
The attached image is the reference (the whole character). Use it only to match position, size, shape, colors and style.

Output rules:
- Exactly the same canvas size and aspect ratio as the reference image. Keep the part at the exact same position, scale and angle as in the reference.
- Draw ONLY the part described below. Everything else must be fully transparent (real alpha channel). No background color, no checkerboard pattern, no frame, no text or labels.
- Do not zoom in, crop, re-center or enlarge the part. Most of the canvas stays empty.
- Do not draw any other part, even partially, and no shadows cast by other parts.
- Where other parts cover this part in the reference, paint the hidden area so this part is complete on its own (it will move during animation).
- Same art style, line weight, colors and cel shading as the reference. Clean hard edges, no glow, no stray pixels.

Part: BACK HAIR — all hair behind the head.
Draw: the hair mass behind the head and the long hair falling behind the shoulders/back, using the darker inner color of the hair.
Do not draw: the bangs and top-of-head hair, side locks, face, ears, neck, body, or anything else.
Complete hidden areas: fill the whole area behind the face, head and neck with hair (one continuous silhouette, no hole and no skin where the face is), so nothing transparent shows when the head turns or tilts.
```

### 体

#### 29. 首 — `neck.png`

- 首だけ。上端はあごの裏へ大きく入り込むように描き足す（首をかしげても隙間が出ない）。
- 首は胴体より手前に描かれるので、下端は服の襟ぐりでぴったり止め、服の上に重ねない。

```text
Task: create ONE separate layer image for a layered 2D animation model (Live2D-style rig).
The attached image is the reference (the whole character). Use it only to match position, size, shape, colors and style.

Output rules:
- Exactly the same canvas size and aspect ratio as the reference image. Keep the part at the exact same position, scale and angle as in the reference.
- Draw ONLY the part described below. Everything else must be fully transparent (real alpha channel). No background color, no checkerboard pattern, no frame, no text or labels.
- Do not zoom in, crop, re-center or enlarge the part. Most of the canvas stays empty.
- Do not draw any other part, even partially, and no shadows cast by other parts.
- Where other parts cover this part in the reference, paint the hidden area so this part is complete on its own (it will move during animation).
- Same art style, line weight, colors and cel shading as the reference. Clean hard edges, no glow, no stray pixels.

Part: NECK.
Draw: only the neck skin, in the same color and shading as the reference (a soft shadow under the jaw is fine).
Do not draw: face, chin outline, hair, clothes, collar, or anything else.
Complete hidden areas: extend the neck upward behind the chin and lower face (up to about mouth height), so no gap appears when the head tilts.
The bottom edge must stop exactly at the neckline of the clothes (this layer is drawn on top of the clothes, so it must not cover them).
```

#### 30. 胴体 — `torso.png`

- 胴体（服と、襟ぐりから見える胸元の肌）。腕・袖・首・頭・髪は含めない。
- 腕や髪に隠れた肩・脇も描き足す。襟ぐりの肌は首の下まで少し上へ伸ばす。

```text
Task: create ONE separate layer image for a layered 2D animation model (Live2D-style rig).
The attached image is the reference (the whole character). Use it only to match position, size, shape, colors and style.

Output rules:
- Exactly the same canvas size and aspect ratio as the reference image. Keep the part at the exact same position, scale and angle as in the reference.
- Draw ONLY the part described below. Everything else must be fully transparent (real alpha channel). No background color, no checkerboard pattern, no frame, no text or labels.
- Do not zoom in, crop, re-center or enlarge the part. Most of the canvas stays empty.
- Do not draw any other part, even partially, and no shadows cast by other parts.
- Where other parts cover this part in the reference, paint the hidden area so this part is complete on its own (it will move during animation).
- Same art style, line weight, colors and cel shading as the reference. Clean hard edges, no glow, no stray pixels.

Part: TORSO — the upper body with its clothes.
Draw: the upper body from the shoulders down to the bottom edge of the canvas: the clothes, plus the skin visible inside the neckline.
Do not draw: arms, sleeves, hands, the neck above the neckline, head, hair, or anything else.
Complete hidden areas: paint the shoulders and the sides of the body that are hidden behind the arms and the hair, and continue the neckline skin a little upward under where the neck is, so no hole appears when the arms, neck or hair move.
```

#### 31. 腕 L — `armL.png`

- キャラ自身の左（画面の右）の腕1本（肩から袖・手まで）。
- 肩を軸に回るので、腕の付け根（肩・袖の上端）は丸く完結させ、胴体の肩に少し重なるように描き足す。

```text
Task: create ONE separate layer image for a layered 2D animation model (Live2D-style rig).
The attached image is the reference (the whole character). Use it only to match position, size, shape, colors and style.

Output rules:
- Exactly the same canvas size and aspect ratio as the reference image. Keep the part at the exact same position, scale and angle as in the reference.
- Draw ONLY the part described below. Everything else must be fully transparent (real alpha channel). No background color, no checkerboard pattern, no frame, no text or labels.
- Do not zoom in, crop, re-center or enlarge the part. Most of the canvas stays empty.
- Do not draw any other part, even partially, and no shadows cast by other parts.
- Where other parts cover this part in the reference, paint the hidden area so this part is complete on its own (it will move during animation).
- Same art style, line weight, colors and cel shading as the reference. Clean hard edges, no glow, no stray pixels.

Part: ARM — the character's own left arm (it appears on the RIGHT side of the image).
Draw: the whole arm from the shoulder down to the hand, including the sleeve and the hand, as in the reference.
Do not draw: the other arm, the torso and its clothes, hair, or anything else.
Complete hidden areas: paint the parts of the arm hidden behind hair, and make the top of the arm (shoulder joint / top of the sleeve) a complete rounded shape that overlaps slightly onto the torso's shoulder, because the arm rotates around the shoulder.
```

#### 32. 腕 R — `armR.png`

- キャラ自身の右（画面の左）の腕1本（肩から袖・手まで）。
- 肩を軸に回るので、腕の付け根（肩・袖の上端）は丸く完結させ、胴体の肩に少し重なるように描き足す。

```text
Task: create ONE separate layer image for a layered 2D animation model (Live2D-style rig).
The attached image is the reference (the whole character). Use it only to match position, size, shape, colors and style.

Output rules:
- Exactly the same canvas size and aspect ratio as the reference image. Keep the part at the exact same position, scale and angle as in the reference.
- Draw ONLY the part described below. Everything else must be fully transparent (real alpha channel). No background color, no checkerboard pattern, no frame, no text or labels.
- Do not zoom in, crop, re-center or enlarge the part. Most of the canvas stays empty.
- Do not draw any other part, even partially, and no shadows cast by other parts.
- Where other parts cover this part in the reference, paint the hidden area so this part is complete on its own (it will move during animation).
- Same art style, line weight, colors and cel shading as the reference. Clean hard edges, no glow, no stray pixels.

Part: ARM — the character's own right arm (it appears on the LEFT side of the image).
Draw: the whole arm from the shoulder down to the hand, including the sleeve and the hand, as in the reference.
Do not draw: the other arm, the torso and its clothes, hair, or anything else.
Complete hidden areas: paint the parts of the arm hidden behind hair, and make the top of the arm (shoulder joint / top of the sleeve) a complete rounded shape that overlaps slightly onto the torso's shoulder, because the arm rotates around the shoulder.
```

## 5. うまくいかないとき

- **パーツが拡大されたり、中央に描き直されたりする。** プロンプトの先頭を `Edit the attached image: erase everything except the <パーツ名>, keep it exactly where it is, then` に変える。インペイント（範囲を塗って編集）ができるAIなら、基準画像からほかの部分を消させる。
- **出力の大きさが違う・少しずれる。** 画像編集ソフトで基準画像の上に半透明で重ねて位置を合わせ、キャンバスを基準画像と同じ大きさにして PNG で書き出す。
- **透明の代わりに市松模様が描かれる。** 模様が絵として描かれている。2章の単色背景の方法に切り替える。
- **小さいパーツ（ハイライト・下まぶた・瞳）が崩れる。** 目の周りだけを拡大した画像で作ってから縮小して元の位置に置くか、手で描く（ハイライトは白い丸で足りる）。
- **上唇・下唇の肌色が顔と合わない。** 画像編集ソフトのスポイトで顔の肌色を取り、肌色の部分を塗り直す。
- **位置合わせを1か所でまとめたい。** 画像編集ソフトで全パーツをレイヤーとして1つの PSD にまとめ、合わせてから PSD を取り込んでもよい（PSD はレイヤーごとに素材になる）。
