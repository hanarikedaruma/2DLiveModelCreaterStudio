import type { Binding, ParameterKey, TransformDelta, Vec2 } from '@app/schema';
import { composeDelta, identityDelta } from './transformDelta';

// キーの位置が同じとみなす差（値の大きさに対する割合）
const COORD_EPS = 1e-6;

export function sameCoord(a: number, b: number): boolean {
  return Math.abs(a - b) <= COORD_EPS * Math.max(1, Math.abs(a), Math.abs(b));
}

interface PreparedBase {
  ok: true;
  dims: 1 | 2;
  xs: number[]; // 1軸目のキーの位置（昇順）
  ys: number[]; // 2軸目のキーの位置（昇順）。1パラメータなら [0] の1つだけ
  defaults: number[]; // 格子の代用に使ったデフォルト値（変わったら作り直す）
  warning: string | null; // 無視して続けられる問題（格子に乗らないキーなど）
}
export interface PreparedTransform extends PreparedBase {
  kind: 'transform';
  values: TransformDelta[]; // 格子の点ごと。添字は i * ys.length + j
  // 不透明度のバインディング（controlsOpacity）の、デフォルト値での不透明度。ほかは null（I-026）
  opacityAtDefault: number | null;
}
export interface PreparedPoints extends PreparedBase {
  kind: 'points';
  count: number; // 頂点・制御点の数
  values: Float32Array[]; // 格子の点ごと。[dx0, dy0, dx1, dy1, ...]
}
export type PreparedBinding = { ok: false; reason: string } | PreparedTransform | PreparedPoints;

const TARGET_OF_CHANNEL = { transform: 'part', vertices: 'mesh', warpPoints: 'warp' } as const;

// 昇順で重なりの無いキーの位置
function axisValues(values: number[]): number[] {
  const sorted = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  const out: number[] = [];
  for (const v of sorted) if (out.length === 0 || !sameCoord(out[out.length - 1]!, v)) out.push(v);
  return out;
}

function indexOfCoord(axis: number[], v: number): number {
  for (let i = 0; i < axis.length; i++) if (sameCoord(axis[i]!, v)) return i;
  return -1;
}

function flatten(points: Vec2[]): Float32Array {
  const out = new Float32Array(points.length * 2);
  for (let i = 0; i < points.length; i++) {
    const p = points[i]!;
    out[i * 2] = p.x;
    out[i * 2 + 1] = p.y;
  }
  return out;
}

// 昇順の位置 axis の中で v をはさむ2つと割合（範囲外は端）
function bracket(axis: number[], v: number): [number, number, number] {
  const last = axis.length - 1;
  if (last <= 0 || v <= axis[0]!) return [0, 0, 0];
  if (v >= axis[last]!) return [last, last, 0];
  let i = 0;
  while (i < last - 1 && v > axis[i + 1]!) i++;
  return [i, i + 1, (v - axis[i]!) / (axis[i + 1]! - axis[i]!)];
}

// 格子の不透明度を (x, y) で双線形補間する（評価と同じ規則。1パラメータは ys = [0]）
function opacityAt(xs: number[], ys: number[], values: TransformDelta[], x: number, y: number): number {
  if (values.length === 0) return 1;
  const ny = ys.length;
  const [i0, i1, tx] = bracket(xs, x);
  const [j0, j1, ty] = ny > 1 ? bracket(ys, y) : [0, 0, 0];
  const v = (i: number, j: number) => values[i * ny + j]!.opacity;
  const low = v(i0, j0) + (v(i1, j0) - v(i0, j0)) * tx;
  const high = v(i0, j1) + (v(i1, j1) - v(i0, j1)) * tx;
  return low + (high - low) * ty;
}

// 下ごしらえした transform のバインディングの、(x, y) での不透明度
export function preparedOpacityAt(prep: PreparedTransform, x: number, y: number): number {
  return opacityAt(prep.xs, prep.ys, prep.values, x, y);
}

function addPoints(a: Float32Array | undefined, b: Float32Array | undefined, count: number): Float32Array {
  const out = new Float32Array(count * 2);
  if (a) out.set(a);
  if (b) for (let k = 0; k < out.length; k++) out[k]! += b[k]!;
  return out;
}

// バインディングを毎フレームの計算に使う形にする（キーを格子に並べ、2パラメータの欠けを代用で埋める）。
// defaults は parameterIds の順のデフォルト値
export function prepareBinding(binding: Binding, defaults: number[]): PreparedBinding {
  const dims = binding.parameterIds.length;
  if (dims !== 1 && dims !== 2) return { ok: false, reason: `パラメータの数が ${dims}（1 か 2 だけ使える）` };
  if (binding.keyValues.length !== dims) return { ok: false, reason: 'keyValues の数が parameterIds と違う' };
  const expectedTarget = TARGET_OF_CHANNEL[binding.channel];
  if (binding.target.type !== expectedTarget) {
    return {
      ok: false,
      reason: `チャンネル ${binding.channel} の対象は ${expectedTarget}（${binding.target.type} になっている）`,
    };
  }

  const isTransform = binding.channel === 'transform';
  let count = -1;
  for (const key of binding.keys) {
    if (isTransform) {
      if (Array.isArray(key.delta)) return { ok: false, reason: 'transform のキーの差分が配列になっている' };
    } else {
      if (!Array.isArray(key.delta)) return { ok: false, reason: '頂点・制御点のキーの差分が配列でない' };
      if (count === -1) count = key.delta.length;
      else if (key.delta.length !== count) return { ok: false, reason: 'キーごとの差分の長さがそろっていない' };
    }
  }
  if (count === -1) count = 0;

  const xs = axisValues(binding.keyValues[0]!);
  const ys = dims === 2 ? axisValues(binding.keyValues[1]!) : [0];
  const ny = ys.length;

  // 格子の点 → キー（同じ点に複数あれば先のもの）
  const cells: (ParameterKey | undefined)[] = new Array<ParameterKey | undefined>(xs.length * ny).fill(undefined);
  let offGrid = 0;
  for (const key of binding.keys) {
    const i = key.coords.length === dims ? indexOfCoord(xs, key.coords[0]!) : -1;
    const j = dims === 2 ? (i >= 0 ? indexOfCoord(ys, key.coords[1]!) : -1) : 0;
    if (i < 0 || j < 0) {
      offGrid++;
      continue;
    }
    if (!cells[i * ny + j]) cells[i * ny + j] = key;
  }
  const warning = offGrid > 0 ? `keyValues の格子に乗らないキーが ${offGrid} 個ある（無視する）` : null;
  const base = { ok: true as const, dims: dims as 1 | 2, defaults: [...defaults], warning };

  if (dims === 1) {
    // キーのある位置だけを使う
    const usedXs: number[] = [];
    const used: ParameterKey[] = [];
    cells.forEach((key, i) => {
      if (key) {
        usedXs.push(xs[i]!);
        used.push(key);
      }
    });
    if (!isTransform) {
      return { ...base, kind: 'points', count, xs: usedXs, ys, values: used.map((k) => flatten(k.delta as Vec2[])) };
    }
    const values = used.map((k) => k.delta as TransformDelta);
    const opacityAtDefault = binding.controlsOpacity ? opacityAt(usedXs, ys, values, defaults[0]!, 0) : null;
    return { ...base, kind: 'transform', xs: usedXs, ys, values, opacityAtDefault };
  }

  // 2パラメータ: 欠けた点は (x, y) = (x, y0) + (x0, y)。どちらも無ければ 0
  const i0 = indexOfCoord(xs, defaults[0]!);
  const j0 = indexOfCoord(ys, defaults[1]!);
  const at = (i: number, j: number) => (i >= 0 && j >= 0 ? cells[i * ny + j] : undefined);

  if (isTransform) {
    // 不透明度のバインディングの不透明度は絶対値なので、欠けた点は (x, y0) + (x0, y) − (x0, y0)（I-026）
    const origin = binding.controlsOpacity ? (at(i0, j0)?.delta as TransformDelta | undefined) : undefined;
    const originOpacity = origin ? origin.opacity : 1;
    const values: TransformDelta[] = [];
    for (let i = 0; i < xs.length; i++) {
      for (let j = 0; j < ny; j++) {
        const own = at(i, j);
        if (own) {
          values.push(own.delta as TransformDelta);
          continue;
        }
        const a = at(i, j0)?.delta as TransformDelta | undefined;
        const b = at(i0, j)?.delta as TransformDelta | undefined;
        const value = composeDelta(a ?? identityDelta(), b ?? identityDelta());
        if (binding.controlsOpacity) {
          value.opacity = (a ? a.opacity : originOpacity) + (b ? b.opacity : originOpacity) - originOpacity;
        }
        values.push(value);
      }
    }
    const opacityAtDefault = binding.controlsOpacity ? opacityAt(xs, ys, values, defaults[0]!, defaults[1]!) : null;
    return { ...base, kind: 'transform', xs, ys, values, opacityAtDefault };
  }

  const flat = cells.map((key) => (key ? flatten(key.delta as Vec2[]) : undefined));
  const values: Float32Array[] = [];
  for (let i = 0; i < xs.length; i++) {
    for (let j = 0; j < ny; j++) {
      const own = flat[i * ny + j];
      if (own) {
        values.push(own);
        continue;
      }
      const a = i >= 0 && j0 >= 0 ? flat[i * ny + j0] : undefined;
      const b = i0 >= 0 ? flat[i0 * ny + j] : undefined;
      values.push(addPoints(a, b, count));
    }
  }
  return { ...base, kind: 'points', count, xs, ys, values };
}
