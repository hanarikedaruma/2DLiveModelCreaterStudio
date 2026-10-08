// キャンバスの上の中央に重ねて描く案内の帯（ツールの次の手順など）と、選べるものを囲む点線。
// キャンバスの領域は縮めない。折り返しても文字は欠かさない（テストは描いた文字をつなげて比べる）
import type { Vec2 } from '@app/schema';

const FONT = '13px sans-serif';
const LINE_HEIGHT = 18;
const PADDING_X = 14;
const PADDING_Y = 8;
const MAX_WIDTH = 560;
const TOP = 12;

export function cssColor(name: string, fallback: string): string {
  try {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
  } catch {
    return fallback;
  }
}

function canvasWidthOf(ctx: CanvasRenderingContext2D): number {
  return ctx.canvas?.clientWidth || ctx.canvas?.width || 800;
}

// 1文字ずつ足して、幅を超えたら折り返す（日本語は単語の区切りが無いため）
export function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const char of text) {
    if (line && ctx.measureText(line + char).width > maxWidth) {
      lines.push(line);
      line = '';
    }
    line += char;
  }
  if (line) lines.push(line);
  return lines;
}

export function drawCanvasBanner(ctx: CanvasRenderingContext2D, text: string): void {
  ctx.save();
  ctx.font = FONT;
  ctx.textBaseline = 'top';
  const canvasWidth = canvasWidthOf(ctx);
  const lines = wrapText(ctx, text, Math.max(80, Math.min(MAX_WIDTH, canvasWidth - 24 - PADDING_X * 2)));
  const width = Math.max(...lines.map((l) => ctx.measureText(l).width)) + PADDING_X * 2;
  const height = lines.length * LINE_HEIGHT + PADDING_Y * 2;
  const x = Math.max(4, (canvasWidth - width) / 2);
  ctx.globalAlpha = 0.94;
  ctx.fillStyle = cssColor('--bg-raised', '#30333a');
  ctx.fillRect(x, TOP, width, height);
  ctx.globalAlpha = 1;
  ctx.lineWidth = 1;
  ctx.strokeStyle = cssColor('--accent', '#5b8def');
  ctx.strokeRect(x, TOP, width, height);
  ctx.fillStyle = cssColor('--text', '#e6e7ea');
  lines.forEach((l, i) => ctx.fillText(l, x + PADDING_X, TOP + PADDING_Y + i * LINE_HEIGHT + 1));
  ctx.restore();
}

// 選べるもの・選んだもの（画面座標の矩形）を点線で囲む。name があれば上に出す
export function drawPickOutline(ctx: CanvasRenderingContext2D, min: Vec2, max: Vec2, name?: string): void {
  ctx.save();
  const accent = cssColor('--accent', '#5b8def');
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = accent;
  ctx.setLineDash([6, 4]);
  ctx.strokeRect(min.x - 4, min.y - 4, max.x - min.x + 8, max.y - min.y + 8);
  ctx.setLineDash([]);
  if (name === undefined) {
    ctx.restore();
    return;
  }
  ctx.font = '12px sans-serif';
  ctx.textBaseline = 'top';
  const width = ctx.measureText(name).width + 12;
  const y = Math.max(0, min.y - 4 - 20);
  ctx.fillStyle = accent;
  ctx.fillRect(min.x - 4, y, width, 18);
  ctx.fillStyle = cssColor('--accent-text', '#ffffff');
  ctx.fillText(name, min.x + 2, y + 3);
  ctx.restore();
}
