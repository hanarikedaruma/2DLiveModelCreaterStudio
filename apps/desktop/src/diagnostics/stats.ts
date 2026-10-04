// 計測の数値の計算（カード25）。どれも純粋な関数

// 昇順に並べたときの p（0..100）パーセンタイル。線形補間する。空なら NaN
export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = (Math.min(100, Math.max(0, p)) / 100) * (sorted.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (rank - lo);
}

export function mean(values: readonly number[]): number {
  if (values.length === 0) return NaN;
  let sum = 0;
  for (const v of values) sum += v;
  return sum / values.length;
}

export interface FpsStats {
  avg: number; // 平均の fps（フレームの間隔の平均から）
  low1: number; // 1% 最低値（いちばん遅いほうから 1% のフレームの間隔の平均から）
  frames: number;
}

// 描いた時刻（ミリ秒、昇順）から fps を求める
export function fpsStats(times: readonly number[]): FpsStats {
  const intervals: number[] = [];
  for (let i = 1; i < times.length; i++) intervals.push(times[i]! - times[i - 1]!);
  if (intervals.length === 0) return { avg: NaN, low1: NaN, frames: times.length };
  const slowest = [...intervals].sort((a, b) => b - a).slice(0, Math.max(1, Math.ceil(intervals.length / 100)));
  return { avg: 1000 / mean(intervals), low1: 1000 / mean(slowest), frames: times.length };
}

// 時刻の並び（ミリ秒）のうち、最後から windowMs の中に入る数を秒あたりにする
export function ratePerSecond(times: readonly number[], windowMs: number, now: number): number {
  let n = 0;
  for (let i = times.length - 1; i >= 0 && times[i]! > now - windowMs; i--) n++;
  return (n * 1000) / windowMs;
}

export interface LatencyStats {
  p95: number;
  avg: number;
  max: number;
  samples: number;
}

export function latencyStats(latencies: readonly number[]): LatencyStats {
  return {
    p95: percentile(latencies, 95),
    avg: mean(latencies),
    max: latencies.length ? Math.max(...latencies) : NaN,
    samples: latencies.length,
  };
}
