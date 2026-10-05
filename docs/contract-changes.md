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

### CC-001 キャンバスのツールに、かんたん/詳細の出し分け（level）を足す

- 決めた日 / ステップ: 2026-10-05 / STEP2 の後の課題の修正（docs/issues.md の I-008）
- 対象の契約: アプリの枠の差し込み口（apps/desktop/src/shell/api.ts）の CanvasTool（カード05）
- 変更前: `interface CanvasTool { id; label; cursor?; onPointerDown?; onPointerMove?; onPointerUp?; onKeyDown?; drawOverlay? }`
- 変更後: 上に `level?: 'easy' | 'detail' | 'both'` を足す（省略は both。PanelDef・SectionDef の level と同じ意味）
- 理由: 詳細モードにだけ出すワープのセクションに対して、ツールのボタン「ワープ編集」がかんたんモードでも出て、押しても何もしなかった（I-008）
- 影響するカード: CanvasTool を前提に載せるカード（18・21・29・42 など）。省略できる項目を足しただけなので、既存のツールはそのまま動く
- 移行: shell/canvas/CanvasHost.tsx がツールのボタンを今のかんたん/詳細で出し分け、使っているツールが出ないほうになったら既定のツールに戻す。ワープのツール（modes/modeling/warp/warpTool.ts）を `level: 'detail'` にした。テスト: shell/canvas/toolLevel.test.tsx
