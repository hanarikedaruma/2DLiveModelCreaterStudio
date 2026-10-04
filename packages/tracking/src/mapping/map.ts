import type { TrackingMapping } from '@app/schema';

export type MappingShape = Pick<TrackingMapping, 'inputRange' | 'outputRange' | 'invert' | 'curve' | 'deadZone'>;

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

// 0..1 の外は丸める。端で傾きが 0 になる
export function smoothstep(t: number): number {
  const c = clamp(t, 0, 1);
  return c * c * (3 - 2 * c);
}

// 入力範囲（逆向きの範囲でもよい）で丸める
export function clampToInputRange(x: number, inputRange: readonly [number, number]): number {
  const [a, b] = inputRange;
  return clamp(x, Math.min(a, b), Math.max(a, b));
}

// 入力の中央 ± deadZone は中央の値にする。その外は、端の値が変わらないように残りの幅を引き伸ばす（境目で跳ばない）
export function applyDeadZone(x: number, inputRange: readonly [number, number], deadZone: number): number {
  const [a, b] = inputRange;
  const center = (a + b) / 2;
  const half = Math.abs(b - a) / 2;
  const dz = Math.max(0, deadZone);
  if (dz === 0) return x;
  const d = x - center;
  if (Math.abs(d) <= dz || half <= dz) return center;
  return center + Math.sign(d) * (Math.abs(d) - dz) * (half / (half - dz));
}

// トラッキングの値をパラメータの値に写す:
// 入力範囲で丸める → deadZone → 入力範囲を 0..1 に → invert → curve（'smooth' は smoothstep）→ 出力範囲
export function mapTrackingValue(x: number, m: MappingShape): number {
  const [a, b] = m.inputRange;
  const [c, d] = m.outputRange;
  const v = applyDeadZone(clampToInputRange(x, m.inputRange), m.inputRange, m.deadZone);
  let t = a === b ? (x < a ? 0 : 1) : clamp((v - a) / (b - a), 0, 1);
  if (m.invert) t = 1 - t;
  if (m.curve === 'smooth') t = smoothstep(t);
  return c + (d - c) * t;
}
