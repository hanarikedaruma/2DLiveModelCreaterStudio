// グリッドの補助線（I-077）。キャンバスの座標（素材のキャンバスの左上が 0）に沿って、拡大率に合わせた間隔で線を引く。
// 絵の上、ツールの枠の下に薄く重ねる。表示するかは見ている人ごとの好みとして覚える（保存できない環境では覚えない）
import type { ViewTransform } from '@app/contracts';

const STEPS = [5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000]; // キャンバスの px
const MIN_SCREEN_STEP = 16; // 細い線の間隔は画面でこれより狭くしない
const VISIBLE_KEY = 'live2d-studio.canvasGrid';

// 細い線と太い線の間隔（キャンバスの px）
export function gridSteps(scale: number): { minor: number; major: number } {
  const minor = STEPS.find((s) => s * scale >= MIN_SCREEN_STEP) ?? STEPS.at(-1)!;
  const lead = minor / 10 ** Math.floor(Math.log10(minor));
  return { minor, major: minor * (lead === 5 ? 2 : 5) };
}

export function readGridVisible(): boolean {
  try {
    return localStorage.getItem(VISIBLE_KEY) === 'true';
  } catch {
    return false;
  }
}

export function saveGridVisible(visible: boolean): void {
  try {
    localStorage.setItem(VISIBLE_KEY, String(visible));
  } catch {
    // 覚えられなくても動作は続ける
  }
}

// width・height は重ね描きの大きさ（CSS ピクセル）。canvasSize があれば、その中心の縦横の線を色で出す
export function drawGrid(
  ctx: CanvasRenderingContext2D,
  view: ViewTransform,
  width: number,
  height: number,
  canvasSize: { width: number; height: number } | null,
  accent: string,
): void {
  const { minor, major } = gridSteps(view.scale);
  const toScreenX = (x: number) => x * view.scale + view.offset.x;
  const toScreenY = (y: number) => y * view.scale + view.offset.y;
  const x0 = Math.floor(-view.offset.x / view.scale / minor) * minor;
  const x1 = (width - view.offset.x) / view.scale;
  const y0 = Math.floor(-view.offset.y / view.scale / minor) * minor;
  const y1 = (height - view.offset.y) / view.scale;
  const isMajor = (v: number) => Math.abs(v / major - Math.round(v / major)) < 1e-6;
  // 線は実ピクセルの真ん中に置いて、にじませない
  const crisp = (v: number) => Math.round(v) + 0.5;

  ctx.save();
  ctx.lineWidth = 1;
  for (const majorPass of [false, true]) {
    ctx.strokeStyle = majorPass ? 'rgba(255, 255, 255, 0.28)' : 'rgba(255, 255, 255, 0.11)';
    ctx.beginPath();
    for (let x = x0; x <= x1; x += minor) {
      if (isMajor(x) !== majorPass) continue;
      const sx = crisp(toScreenX(x));
      ctx.moveTo(sx, 0);
      ctx.lineTo(sx, height);
    }
    for (let y = y0; y <= y1; y += minor) {
      if (isMajor(y) !== majorPass) continue;
      const sy = crisp(toScreenY(y));
      ctx.moveTo(0, sy);
      ctx.lineTo(width, sy);
    }
    ctx.stroke();
  }
  if (canvasSize) {
    // 素材のキャンバスの中心線（左右対称の確認に使う）
    ctx.strokeStyle = accent;
    ctx.globalAlpha = 0.7;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    const cx = crisp(toScreenX(canvasSize.width / 2));
    const cy = crisp(toScreenY(canvasSize.height / 2));
    ctx.moveTo(cx, 0);
    ctx.lineTo(cx, height);
    ctx.moveTo(0, cy);
    ctx.lineTo(width, cy);
    ctx.stroke();
  }
  ctx.restore();
}
