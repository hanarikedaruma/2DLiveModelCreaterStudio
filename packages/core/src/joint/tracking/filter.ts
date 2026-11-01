// 腕の目標位置のならし（AT-09）。One Euro Filter（Casiez ほか 2012）を、肩の座標（腕の長さ1）の点に使う。
// trackingパッケージの顔用（mapping/oneEuro.ts）は import しない（coreは tracking に依存しない）
import type { Vec2 } from '@app/schema';

// 設定の「なめらかさ」0..1 を minCutoff の 6.0〜0.6 Hz に割り当てる（周波数なので対数の上で等間隔。0.5 で約1.9Hz）。
// 顔より速く動くので、顔（3.0〜0.3）より高い側に置く。beta は腕の長さ/秒あたり
export const ARM_FILTER = Object.freeze({ minCutoffAt0: 6.0, minCutoffAt1: 0.6, beta: 1.0, dCutoff: 1.0 });

export function armSmoothingToMinCutoff(smoothing: number): number {
  const s = Math.min(1, Math.max(0, Number.isFinite(smoothing) ? smoothing : 0));
  return ARM_FILTER.minCutoffAt0 * Math.pow(ARM_FILTER.minCutoffAt1 / ARM_FILTER.minCutoffAt0, s);
}

const alpha = (cutoff: number, dt: number) => {
  const r = 2 * Math.PI * cutoff * dt;
  return r / (r + 1);
};

// 2次元の点を、撮影時刻（ms）でならす。最初の点・時刻が進まない点はそのまま／前の出力のまま
export class PointFilter {
  private prev: Vec2 | null = null;
  private prevSpeed = 0;
  private prevTime = 0;

  constructor(private minCutoff: number) {}

  setMinCutoff(minCutoff: number): void {
    this.minCutoff = minCutoff;
  }

  reset(): void {
    this.prev = null;
    this.prevSpeed = 0;
  }

  filter(p: Vec2, timeMs: number): Vec2 {
    if (!this.prev) {
      this.prev = { ...p };
      this.prevTime = timeMs;
      return { ...p };
    }
    const dt = (timeMs - this.prevTime) / 1000;
    if (!(dt > 0)) return { ...this.prev };
    const speed = Math.hypot(p.x - this.prev.x, p.y - this.prev.y) / dt;
    const smoothSpeed = this.prevSpeed + alpha(ARM_FILTER.dCutoff, dt) * (speed - this.prevSpeed);
    const a = alpha(this.minCutoff + ARM_FILTER.beta * smoothSpeed, dt);
    const out = { x: this.prev.x + a * (p.x - this.prev.x), y: this.prev.y + a * (p.y - this.prev.y) };
    this.prev = out;
    this.prevSpeed = smoothSpeed;
    this.prevTime = timeMs;
    return { ...out };
  }
}
