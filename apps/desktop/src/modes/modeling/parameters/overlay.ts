// キャンバスの「編集中: 顔 左右 ＝ 右（+30）」の表示（registerCanvasOverlay で登録する）
import type { EditorStore, ProjectStore, ViewTransform } from '@app/contracts';
import { editingLabel } from './labels';

export const EDITING_OVERLAY_ID = 'parameters.editing';

interface Source {
  store: ProjectStore;
  editor: EditorStore;
}

// オーバーレイの描画は状態を受け取らないので、パネルが出ている間だけストアをつないでおく
let source: Source | null = null;

export function connectEditingOverlay(next: Source): () => void {
  source = next;
  return () => {
    if (source === next) source = null;
  };
}

// 色は shell.css の --bg-panel・--accent・--text に合わせる（canvas では CSS 変数を使えない）
const FONT = "13px system-ui, 'Segoe UI', 'Yu Gothic UI', 'Meiryo', sans-serif";

function wrappedLines(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const char of text) {
    if (line && ctx.measureText(line + char).width > maxWidth) {
      lines.push(line);
      line = char;
    } else line += char;
  }
  if (line) lines.push(line);
  return lines;
}

// 左上に描く（ctx は CSS ピクセル）
export function drawEditingOverlay(ctx: CanvasRenderingContext2D, _view: ViewTransform): void {
  if (!source) return;
  const text = editingLabel(source.store.get(), source.editor.get());
  if (!text) return;
  ctx.font = FONT;
  ctx.textBaseline = 'middle';
  const available = ctx.canvas?.clientWidth;
  const lines = wrappedLines(ctx, text, available > 0 ? Math.max(1, available - 38) : Infinity);
  const width = Math.max(...lines.map((line) => ctx.measureText(line).width));
  const height = 26 + (lines.length - 1) * 20;
  ctx.fillStyle = 'rgba(38, 40, 44, 0.9)';
  ctx.fillRect(8, 8, width + 22, height);
  ctx.fillStyle = '#5b8def';
  ctx.fillRect(8, 8, 3, height);
  ctx.fillStyle = '#e6e7ea';
  lines.forEach((line, i) => ctx.fillText(line, 19, 21 + i * 20));
}
