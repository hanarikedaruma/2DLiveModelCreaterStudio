# カード64 左右反転コピーの符号

| 段              | 担当 | 依存 | 契約 | 実機 | テスト |
| --------------- | ---- | ---- | ---- | ---- | ------ |
| 1（部品・並行） | CO   | 55   | —    | —    | CL     |

課題: I-006。

## 目的

左右反転コピーで、左右の組が無い向きのパラメータ（FaceAngleX・EyeBallX など）のキーを正しく写し、反転したパーツが逆の向きに動かないようにする。

## 前提

- 左右反転コピー: `apps/desktop/src/modes/modeling/structure/mirrorCopy.ts`。パラメータの id の末尾の L/R を入れ替え（相手があるときだけ）、キーの x と回転を反転する（mirrorKey）。
- I-006 と追記（docs/issues.md）: 組の無いパラメータでも x を反転するので、反転コピーした瞳が逆を向くおそれがある。BodyAngleX・FaceAngleZ・BodyAngleZ も同じ。
- 既存のテスト: `mirrorCopy.test.ts`（今の動きを確かめている）、UC-07 の手順6、UC-CH-03 の手順6。

## 作るもの・直すもの

1. **向きのあるパラメータ**（FaceAngleX・EyeBallX・BodyAngleX・FaceAngleZ・BodyAngleZ）: 差分の反転に加えて、キーの位置（値）も反転する（v → −v）。反転したパーツが、元のパーツの鏡像として同じ向きへ動く。
2. **組のあるパラメータ**（…L ↔ …R）: 今のまま。
3. **向きの無いパラメータ**（FaceAngleY・MouthOpen など）とユーザー定義パラメータ: 今のまま（差分の x を反転、キーの位置はそのまま）。この扱いを記録に書く。
4. `mirrorCopy.test.ts` の今の動きを確かめるテストを、新しい動きに直す（瞳・顔の向き・傾きの場合を足す）。

## 触ってよいもの

- `apps/desktop/src/modes/modeling/structure/mirrorCopy.ts`・`mirrorCopy.test.ts`

## 触らないもの

- `StructureTab.tsx`（カード59）。スキーマ（向きのあるパラメータの一覧は mirrorCopy.ts の中に置く）。

## テスト（担当: CL）

このカードのテストは、実装の担当（CO）ではなく CL が書く（README の「テストの分担」）。テストのファイルは名前にカードの番号（`.c64.`）を入れ、実装の担当は書き換えない。

- `apps/desktop/src/modes/modeling/structure/mirrorCopy.c64.test.ts`: 反転コピーした瞳が EyeBallX で元と同じ向きに動く。FaceAngleX・FaceAngleZ・BodyAngleX・BodyAngleZ のキーで鏡像として動く。組のある・向きの無い・ユーザー定義のパラメータは前と同じ。評価した頂点の位置で確かめる。
- CH: 左右反転コピーの CH（CH-016 など）を新しい動きに書き直す。

## 完了条件

- [ ] 反転コピーした瞳が、EyeBallX で元の瞳と同じ向きに動く（テスト）
- [ ] 顔の向き・傾きのキーを持つパーツの反転コピーが、鏡像として正しく動く（テスト）
- [ ] 組のあるパラメータ・向きの無いパラメータの動きが前と同じ（テスト）

## 締めるときに書くもの

- docs/issues.md の I-006 を対応済みに。

## 記録

（作業中に書く）
