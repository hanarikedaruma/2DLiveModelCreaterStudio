import { MAX_BINDING_PARAMETERS, type Binding, type ParameterKey, type TransformDelta, type Vec2 } from '@app/schema';
import { identityDelta } from './transformDelta';

// キーの位置が同じとみなす差（値の大きさに対する割合）
const COORD_EPS = 1e-6;

export function sameCoord(a: number, b: number): boolean {
  return Math.abs(a - b) <= COORD_EPS * Math.max(1, Math.abs(a), Math.abs(b));
}

interface PreparedBase {
  ok: true;
  dims: number; // パラメータの数（1..MAX_BINDING_PARAMETERS）
  // 軸ごとのキーの位置（昇順）。1パラメータはキーのある位置だけ
  axes: number[][];
  strides: number[]; // 格子の点の添字 = Σ 軸の添字 × strides（最後の軸が 1）
  defaults: number[]; // 格子の代用に使ったデフォルト値（変わったら作り直す）
  warning: string | null; // 無視して続けられる問題（格子に乗らないキーなど）
}
export interface PreparedTransform extends PreparedBase {
  kind: 'transform';
  values: TransformDelta[]; // 格子の点ごと
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

function stridesOf(axes: number[][]): number[] {
  const strides = new Array<number>(axes.length).fill(1);
  for (let k = axes.length - 2; k >= 0; k--) strides[k] = strides[k + 1]! * axes[k + 1]!.length;
  return strides;
}

// 格子の値を coords で多重線形補間する（評価と同じ規則）
function interpolate(axes: number[][], strides: number[], value: (index: number) => number, coords: number[]): number {
  let total = 0;
  const brackets = axes.map((axis, k) => bracket(axis, coords[k] ?? 0));
  for (let corner = 0; corner < 1 << axes.length; corner++) {
    let index = 0;
    let weight = 1;
    for (let k = 0; k < axes.length; k++) {
      const [i0, i1, t] = brackets[k]!;
      const high = (corner >> k) & 1;
      weight *= high ? t : 1 - t;
      index += (high ? i1 : i0) * strides[k]!;
    }
    if (weight !== 0) total += value(index) * weight;
  }
  return total;
}

// 下ごしらえした transform のバインディングの、coords（parameterIds の順の値）での不透明度
export function preparedOpacityAt(prep: PreparedTransform, coords: number[]): number {
  if (prep.values.length === 0) return 1;
  return interpolate(prep.axes, prep.strides, (i) => prep.values[i]!.opacity, coords);
}

// 符号つきで足し合わせる（格子の欠けた点の代用。位置・回転・頂点は加算、拡縮は乗算、不透明度は絶対値の加算）
interface SignedSum<V> {
  add(value: V, sign: 1 | -1): void;
  result(): V;
}

function transformSum(controlsOpacity: boolean): SignedSum<TransformDelta> {
  const acc = { px: 0, py: 0, rot: 0, sx: 1, sy: 1, op: 0 };
  const pow = (v: number, sign: 1 | -1) => (sign > 0 ? v : v !== 0 ? 1 / v : 1);
  return {
    add(d, sign) {
      acc.px += sign * d.position.x;
      acc.py += sign * d.position.y;
      acc.rot += sign * d.rotation;
      acc.sx *= pow(d.scale.x, sign);
      acc.sy *= pow(d.scale.y, sign);
      acc.op += sign * d.opacity;
    },
    result: () => ({
      position: { x: acc.px, y: acc.py },
      rotation: acc.rot,
      scale: { x: acc.sx, y: acc.sy },
      opacity: controlsOpacity ? acc.op : 1,
    }),
  };
}

function pointsSum(count: number): SignedSum<Float32Array> {
  const out = new Float32Array(count * 2);
  return {
    add(v, sign) {
      for (let k = 0; k < out.length; k++) out[k]! += sign * v[k]!;
    },
    result: () => out,
  };
}

// 格子の点の値を決める。キーがあればその値。デフォルト値から外れた軸が1つ以下でキーが無ければ、デフォルト値の点の値
// （その点のキーか、無ければ変化なし）。2つ以上なら、外れた軸の一部だけをデフォルト値に戻した点の値の包除で代用する
// （2パラメータなら (x, y) = (x, y0) + (x0, y) − (x0, y0)、3つなら 面の和 − 辺の和 + 頂点）。I-028
function fillGrid<V>(
  axes: number[][],
  strides: number[],
  cells: (V | undefined)[],
  defaultIndex: number[],
  identity: () => V,
  sum: () => SignedSum<V>,
): V[] {
  const dims = axes.length;
  const memo = new Map<number, V>();
  const flat = (idx: number[]) => idx.reduce((s, v, k) => s + v * strides[k]!, 0);
  const originIdx = defaultIndex.every((i) => i >= 0) ? flat(defaultIndex) : -1;
  const origin = (): V => (originIdx >= 0 ? (cells[originIdx] ?? identity()) : identity());

  const valueAt = (idx: number[]): V => {
    const at = flat(idx);
    const own = cells[at];
    if (own !== undefined) return own;
    const cached = memo.get(at);
    if (cached !== undefined) return cached;
    const off: number[] = [];
    for (let k = 0; k < dims; k++) if (idx[k] !== defaultIndex[k]) off.push(k);
    let value: V;
    if (off.length <= 1) value = origin();
    else {
      const acc = sum();
      // off の真部分集合 kept（kept の軸は残し、ほかの外れた軸をデフォルト値に戻す）
      for (let mask = 0; mask < (1 << off.length) - 1; mask++) {
        const kept = off.filter((_, b) => (mask >> b) & 1);
        const sign = (off.length - 1 - kept.length) % 2 === 0 ? 1 : -1;
        // デフォルト値が格子に無い軸を戻す点は、無いもの（変化なし）として扱う
        if (off.some((k) => !kept.includes(k) && defaultIndex[k]! < 0)) {
          acc.add(identity(), sign);
          continue;
        }
        const point = idx.map((v, k) => (off.includes(k) && !kept.includes(k) ? defaultIndex[k]! : v));
        acc.add(valueAt(point), sign);
      }
      value = acc.result();
    }
    memo.set(at, value);
    return value;
  };

  const total = axes.reduce((n, a) => n * a.length, 1);
  const out: V[] = new Array<V>(total);
  for (let i = 0; i < total; i++) {
    const idx: number[] = [];
    let rest = i;
    for (let k = 0; k < dims; k++) {
      idx.push(Math.floor(rest / strides[k]!));
      rest -= idx[k]! * strides[k]!;
    }
    out[i] = valueAt(idx);
  }
  return out;
}

// バインディングを毎フレームの計算に使う形にする（キーを格子に並べ、2つ以上のパラメータの欠けを代用で埋める）。
// defaults は parameterIds の順のデフォルト値
export function prepareBinding(binding: Binding, defaults: number[]): PreparedBinding {
  const dims = binding.parameterIds.length;
  if (dims < 1 || dims > MAX_BINDING_PARAMETERS) {
    return { ok: false, reason: `パラメータの数が ${dims}（1〜${MAX_BINDING_PARAMETERS} だけ使える）` };
  }
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

  // 格子の点 → キー（同じ点に複数あれば先のもの）
  const grid = binding.keyValues.map(axisValues);
  const strides = stridesOf(grid);
  const cells = new Array<ParameterKey | undefined>(grid.reduce((n, a) => n * a.length, 1)).fill(undefined);
  let offGrid = 0;
  for (const key of binding.keys) {
    let index = 0;
    let ok = key.coords.length === dims;
    for (let k = 0; ok && k < dims; k++) {
      const i = indexOfCoord(grid[k]!, key.coords[k]!);
      if (i < 0) ok = false;
      else index += i * strides[k]!;
    }
    if (!ok) {
      offGrid++;
      continue;
    }
    if (!cells[index]) cells[index] = key;
  }
  const warning = offGrid > 0 ? `keyValues の格子に乗らないキーが ${offGrid} 個ある（無視する）` : null;
  const base = { ok: true as const, dims, defaults: [...defaults], warning };

  if (dims === 1) {
    // キーのある位置だけを使う
    const used: number[] = [];
    const keys: ParameterKey[] = [];
    cells.forEach((key, i) => {
      if (key) {
        used.push(grid[0]![i]!);
        keys.push(key);
      }
    });
    const axes = [used];
    if (!isTransform) {
      const values = keys.map((k) => flatten(k.delta as Vec2[]));
      return { ...base, kind: 'points', count, axes, strides: [1], values };
    }
    const values = keys.map((k) => k.delta as TransformDelta);
    const prep: PreparedTransform = { ...base, kind: 'transform', axes, strides: [1], values, opacityAtDefault: null };
    if (binding.controlsOpacity) prep.opacityAtDefault = preparedOpacityAt(prep, defaults);
    return prep;
  }

  // 2つ以上のパラメータ: 欠けた点は包除で代用する（fillGrid）
  const defaultIndex = grid.map((axis, k) => indexOfCoord(axis, defaults[k]!));
  if (isTransform) {
    const values = fillGrid(
      grid,
      strides,
      cells.map((key) => key?.delta as TransformDelta | undefined),
      defaultIndex,
      identityDelta,
      () => transformSum(binding.controlsOpacity === true),
    );
    const prep: PreparedTransform = { ...base, kind: 'transform', axes: grid, strides, values, opacityAtDefault: null };
    if (binding.controlsOpacity) prep.opacityAtDefault = preparedOpacityAt(prep, defaults);
    return prep;
  }
  const values = fillGrid(
    grid,
    strides,
    cells.map((key) => (key ? flatten(key.delta as Vec2[]) : undefined)),
    defaultIndex,
    () => new Float32Array(count * 2),
    () => pointsSum(count),
  );
  return { ...base, kind: 'points', count, axes: grid, strides, values };
}
