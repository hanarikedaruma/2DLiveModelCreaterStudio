# カード99: 流れ線の編集と髪の重力追従（I-063）

状態: 着手（CO、2026-10-08）。ユーザーが「これを実装して」と指示したため、候補 #17 を独立して先行実装する。カード72の受け入れを完了した扱いにはしない。他のSTEP4カードの開始条件は維持する。CLの上限による引き継ぎを継続し、実装・追加テストはCOが行う。

元の設計: [curve-guide-design.md](../curve-guide-design.md)。まず一本の流れ線・少数点の編集・連続する重力追従・手動キーへの記録・保存/Undoを実装する。慣性による揺れ・肩との接触・3Dねじれは元の設計どおり次の段階。

## 触ってよいもの

- `packages/schema/src/` の型・検証・3→4の移行とテスト（CC-011）。
- `packages/contracts/src/index.ts` の変形結果の流れ線情報。
- `packages/core/src/deform/` の流れ線の評価、パイプライン、公開、テスト。
- `apps/desktop/src/modes/modeling/curveGuide/` の操作・パネル・コマンド・テスト。
- `apps/desktop/src/modes/modeling/mesh/meshDrag.ts` の点ごとに違う移動先の逆変換とテスト。
- `apps/desktop/src/modes/modeling/physics/commands.ts`・`PhysicsSection.tsx` の重力方式と既存の揺れの二重適用の防止。
- `apps/desktop/src/modes/index.ts` の登録行。
- `apps/desktop/src/modes/modeling/structure/` と `packages/io/src/` の削除・複製・反転・読込時の流れ線の参照の保護。
- `apps/desktop/e2e/curveGuide.c99.e2e.ts`、既存の検査の版番号の追従。
- `apps/desktop/src/shell/Layout.c61.test.tsx` の右パネル一覧への「流れ線」の追加。CLの引き継ぎとしてCOが追加パネルも既存の小画面検査に含める（検査の条件は維持）。
- `docs/contract-changes.md`、候補・計画・課題・状態・設計の実装記録、`tests/usecase/changes.md`。

契約の変更はこのカード1枚だけを行い、カード78〜82と同時に進めない。新しい環境・リモート・開発スクリプトは作らない。別作業の `projects/` と `fixtures/scripts/build-desktop-character.ts` は変更しない。

## 完了条件

1. 髪の画像パーツを選び、一本なぞって流れ線を作り、中間・毛先を動かして周囲を滑らかに変形できる。短い根元の区間は頭に追従する。
2. 重力を有効にすると、直毛の見本の頭を−30〜+30度の間で動かしても、下側が下へ垂れる。毛先の位置は固定しない。長さ・幅・三角形の反転を検証する。
3. 影響幅の外・別パーツは変えず、既存の頂点キーと親ワープを保持する。逆変換・新しい反転の失敗では有効な状態を保つ。
4. 保存/再読込・再編集・Undo/Redo・Esc・ロック・プレビュー・プロジェクト切り替えを保護する。メッシュ変更で対応を失った線は理由を表示して使わない。
5. 現在のキーへ形を記録する操作は既存のKeyEditorを使い、他のmanual/lockedキーを書き換えない。実行時の変形を二重に重ねない。
6. 既存の髪の物理との切り替えを明示する。削除/複製/反転で参照を保護する。
7. 型・lint・整形・全体単体テストと、Edgeの1440×1000/800×600、既存のNative e2eで確認する。実際の髪の見た目の未確認は記録する。

## 記録

- 2026-10-08 CO: ユーザーの実装指示を受けて先行着手。完了条件は未確認。
