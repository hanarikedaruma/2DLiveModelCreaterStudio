// One Euro Filter（Casiez ほか 2012）。ゆっくりした動きは強くならし、速い動きは遅れを小さくする
export interface OneEuroParams {
  minCutoff: number; // Hz
  beta: number;
  dCutoff: number; // Hz
}

export const ONE_EURO_DEFAULTS: Readonly<OneEuroParams> = Object.freeze({ minCutoff: 1.0, beta: 0.02, dCutoff: 1.0 });

const MIN_CUTOFF_AT_0 = 3.0;
const MIN_CUTOFF_AT_1 = 0.3;

// mapping.smoothing（0..1）を minCutoff の 3.0〜0.3 に割り当てる。周波数なので対数の上で等間隔にする
// （0.5 で約 0.95）。範囲の外は丸める
export function smoothingToMinCutoff(smoothing: number): number {
  const s = Math.min(1, Math.max(0, Number.isFinite(smoothing) ? smoothing : 0));
  return MIN_CUTOFF_AT_0 * Math.pow(MIN_CUTOFF_AT_1 / MIN_CUTOFF_AT_0, s);
}

// minCutoff が初期値の 1.0 になる smoothing（≈ 0.477）。既定のマッピングに使う
export const DEFAULT_SMOOTHING =
  Math.log(ONE_EURO_DEFAULTS.minCutoff / MIN_CUTOFF_AT_0) / Math.log(MIN_CUTOFF_AT_1 / MIN_CUTOFF_AT_0);

// 時間 dt 秒・遮断周波数 cutoff Hz の1次の低域通過の係数
function alpha(cutoff: number, dt: number): number {
  const r = 2 * Math.PI * cutoff * dt;
  return r / (r + 1);
}

export class OneEuroFilter {
  private prev: number | null = null; // 前の出力
  private prevDx = 0; // ならした変化の速さ（単位/秒）
  private prevTime = 0; // ミリ秒

  constructor(private readonly params: Readonly<OneEuroParams>) {}

  // 最初の値はそのまま返す。時刻が進まないときは前の出力のまま
  filter(value: number, timeMs: number): number {
    if (this.prev === null) {
      this.prev = value;
      this.prevDx = 0;
      this.prevTime = timeMs;
      return value;
    }
    const dt = (timeMs - this.prevTime) / 1000;
    if (!(dt > 0)) return this.prev;
    const { minCutoff, beta, dCutoff } = this.params;
    // 速さは前の出力からの差で見る（論文の擬似コードと同じ）
    const dx = (value - this.prev) / dt;
    const edx = this.prevDx + alpha(dCutoff, dt) * (dx - this.prevDx);
    const cutoff = minCutoff + beta * Math.abs(edx);
    const out = this.prev + alpha(cutoff, dt) * (value - this.prev);
    this.prev = out;
    this.prevDx = edx;
    this.prevTime = timeMs;
    return out;
  }

  reset(): void {
    this.prev = null;
  }
}
