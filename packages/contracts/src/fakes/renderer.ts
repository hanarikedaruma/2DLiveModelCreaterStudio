import type { BlendMode } from '@app/schema';
import type { Background, DeformedModel, Renderer, ViewTransform } from '../index';

// 合成モードを Canvas 2D の合成に写す（WebGL2 のレンダラーと同じ4つ。I-011）
const COMPOSITE: Record<BlendMode, GlobalCompositeOperation> = {
  normal: 'source-over',
  multiply: 'multiply',
  screen: 'screen',
  add: 'lighter',
};

// Canvas 2D で、各 DrawItem の画像を頂点の外接矩形に drawImage する。WebGL2 が使えない PC で使う
export class FakeRenderer implements Renderer {
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private textures: Record<string, ImageBitmap> = {};

  init(canvas: HTMLCanvasElement): void {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    if (!this.ctx) throw new Error('2D コンテキストを作れない');
  }

  setTextures(images: Record<string, ImageBitmap>): void {
    this.textures = { ...images };
  }

  render(model: DeformedModel, view: ViewTransform, background: Background): void {
    const { canvas, ctx } = this;
    if (!canvas || !ctx) throw new Error('init の前に render を呼んだ');
    // view は CSS ピクセル。キャンバスの実ピクセルとの比を掛ける
    const ratio = canvas.clientWidth > 0 ? canvas.width / canvas.clientWidth : 1;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (background.type === 'color') {
      ctx.fillStyle = background.color;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    } else if (background.type === 'image') {
      ctx.drawImage(background.image, 0, 0, canvas.width, canvas.height);
    }
    ctx.setTransform(view.scale * ratio, 0, 0, view.scale * ratio, view.offset.x * ratio, view.offset.y * ratio);
    for (const item of model.items) {
      const image = this.textures[item.assetId];
      if (!image || item.positions.length < 2) continue;
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (let i = 0; i < item.positions.length; i += 2) {
        const x = item.positions[i]!;
        const y = item.positions[i + 1]!;
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
      ctx.globalAlpha = item.opacity;
      ctx.globalCompositeOperation = COMPOSITE[item.blendMode] ?? 'source-over';
      ctx.drawImage(image, minX, minY, maxX - minX, maxY - minY);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  dispose(): void {
    this.canvas = null;
    this.ctx = null;
    this.textures = {};
  }
}
