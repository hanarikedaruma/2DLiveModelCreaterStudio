import {
  MAX_BINDING_PARAMETERS,
  type Binding,
  type Mesh,
  type Model,
  type Parameter,
  type TransformDelta,
  type Warp,
} from '@app/schema';
import type { BindingEvaluator, ParamValues, TargetDeltas } from '@app/contracts';
import { prepareBinding, type PreparedBinding } from './prepare';
import { identityDelta } from './transformDelta';

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

// params に無いか数でなければデフォルト値。min..max に丸める
export function parameterValue(parameter: Parameter, params: ParamValues): number {
  const raw = Object.hasOwn(params, parameter.id) ? params[parameter.id] : undefined;
  const v = typeof raw === 'number' && Number.isFinite(raw) ? raw : parameter.default;
  return clamp(v, parameter.min, parameter.max);
}

// 昇順の位置 xs の中での v の位置を、小数の添字（0..xs.length−1）で返す。範囲外は端
function fractionalIndex(xs: number[], v: number): number {
  const last = xs.length - 1;
  if (last <= 0 || v <= xs[0]!) return 0;
  if (v >= xs[last]!) return last;
  let lo = 0;
  let hi = last;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (xs[mid]! <= v) lo = mid;
    else hi = mid;
  }
  return lo + (v - xs[lo]!) / (xs[hi]! - xs[lo]!);
}

// 格子の角（2^次元）と重み（重み 0 の角は使わない）。毎回の確保を避けるため使い回す
const MAX_CORNERS = 1 << MAX_BINDING_PARAMETERS;
const cornerIndex = new Int32Array(MAX_CORNERS);
const cornerWeight = new Float64Array(MAX_CORNERS);
const fraction = new Float64Array(MAX_BINDING_PARAMETERS);

// fraction[k] は軸 k の小数の添字。1・2パラメータはよく使うので展開して数える
function corners(prepared: { axes: number[][]; strides: number[] }, dims: number): number {
  const { strides } = prepared;
  if (dims === 1) {
    const i0 = Math.floor(fraction[0]!);
    const t = fraction[0]! - i0;
    let n = pushCorner(0, i0, 1 - t);
    if (t > 0) n = pushCorner(n, i0 + 1, t);
    return n;
  }
  if (dims === 2) {
    const ny = strides[0]!;
    const i0 = Math.floor(fraction[0]!);
    const j0 = Math.floor(fraction[1]!);
    const tx = fraction[0]! - i0;
    const ty = fraction[1]! - j0;
    const i1 = tx > 0 ? i0 + 1 : i0;
    const j1 = ty > 0 ? j0 + 1 : j0;
    let n = 0;
    n = pushCorner(n, i0 * ny + j0, (1 - tx) * (1 - ty));
    n = pushCorner(n, i1 * ny + j0, tx * (1 - ty));
    n = pushCorner(n, i0 * ny + j1, (1 - tx) * ty);
    n = pushCorner(n, i1 * ny + j1, tx * ty);
    return n;
  }
  let n = 0;
  for (let corner = 0; corner < 1 << dims; corner++) {
    let index = 0;
    let weight = 1;
    for (let k = 0; k < dims; k++) {
      const i0 = Math.floor(fraction[k]!);
      const t = fraction[k]! - i0;
      const high = (corner >> k) & 1;
      weight *= high ? t : 1 - t;
      index += (high && t > 0 ? i0 + 1 : i0) * strides[k]!;
    }
    n = pushCorner(n, index, weight);
  }
  return n;
}

function pushCorner(n: number, index: number, w: number): number {
  if (w === 0) return n;
  cornerIndex[n] = index;
  cornerWeight[n] = w;
  return n + 1;
}

// acc に角の差分を重み付きで足す。よくある角の数（2・4）は1回の走査で済ませる
function addWeighted(acc: Float32Array, values: Float32Array[], n: number): void {
  const len = acc.length;
  if (n === 2) {
    const a = values[cornerIndex[0]!]!;
    const b = values[cornerIndex[1]!]!;
    const wa = cornerWeight[0]!;
    const wb = cornerWeight[1]!;
    for (let k = 0; k < len; k++) acc[k]! += a[k]! * wa + b[k]! * wb;
    return;
  }
  if (n === 4) {
    const a = values[cornerIndex[0]!]!;
    const b = values[cornerIndex[1]!]!;
    const c = values[cornerIndex[2]!]!;
    const d = values[cornerIndex[3]!]!;
    const wa = cornerWeight[0]!;
    const wb = cornerWeight[1]!;
    const wc = cornerWeight[2]!;
    const wd = cornerWeight[3]!;
    for (let k = 0; k < len; k++) acc[k]! += a[k]! * wa + b[k]! * wb + c[k]! * wc + d[k]! * wd;
    return;
  }
  // 1つ（キーの上）か、重みの積が 0 になった3つ
  for (let c = 0; c < n; c++) {
    const v = values[cornerIndex[c]!]!;
    const w = cornerWeight[c]!;
    for (let k = 0; k < len; k++) acc[k]! += v[k]! * w;
  }
}

function pointCounts<T extends Mesh | Warp>(
  cache: WeakMap<T[], Map<string, number>>,
  items: T[],
  countOf: (item: T) => number,
): Map<string, number> {
  let map = cache.get(items);
  if (!map) {
    map = new Map(items.map((item) => [item.id, countOf(item)]));
    cache.set(items, map);
  }
  return map;
}

// パラメータの値から、対象ごとの差分の合計を求める（カード06）。
// 出力は呼ぶたびに新しく作る。バインディングの下ごしらえはバインディングのオブジェクトごとに覚えておく
export function createBindingEvaluator(): BindingEvaluator {
  const preparedCache = new WeakMap<Binding, PreparedBinding>();
  const warned = new WeakMap<Binding, Set<string>>();
  const parameterMaps = new WeakMap<Parameter[], Map<string, Parameter>>();
  const meshCounts = new WeakMap<Mesh[], Map<string, number>>();
  const warpCounts = new WeakMap<Warp[], Map<string, number>>();

  // 毎フレーム呼ばれるので、同じバインディングの同じ警告は1回だけ出す
  function warn(binding: Binding, message: string) {
    let seen = warned.get(binding);
    if (!seen) warned.set(binding, (seen = new Set()));
    if (seen.has(message)) return;
    seen.add(message);
    console.warn(`バインディング ${binding.id}: ${message}`);
  }

  // defaults は各パラメータのデフォルト値（2つ以上のパラメータの代用に使うので、変わったら作り直す）
  function prepared(binding: Binding, defaults: number[]): PreparedBinding {
    const cached = preparedCache.get(binding);
    if (cached && (!cached.ok || cached.defaults.every((d, k) => d === defaults[k]))) return cached;
    const next = prepareBinding(binding, defaults);
    preparedCache.set(binding, next);
    return next;
  }

  return {
    evaluate(model: Model, params: ParamValues): TargetDeltas {
      const out: TargetDeltas = { transforms: {}, vertices: {}, warpPoints: {} };
      let parameters = parameterMaps.get(model.parameters);
      if (!parameters) {
        parameters = new Map(model.parameters.map((p) => [p.id, p]));
        parameterMaps.set(model.parameters, parameters);
      }
      const vertexCounts = pointCounts(meshCounts, model.meshes, (m) => m.vertices.length);
      const controlCounts = pointCounts(warpCounts, model.warps, (w) => w.points.length);
      const opacityChanges = new Map<string, number>(); // partId → 不透明度のバインディングの変化の和

      for (const binding of model.bindings) {
        const ids = binding.parameterIds;
        const ps = ids.map((id) => parameters.get(id));
        if (ids.length > 0 && ids.length <= MAX_BINDING_PARAMETERS && ps.some((p) => !p)) {
          warn(binding, `無視する（モデルに無いパラメータを使っている: ${ids.join(', ')}）`);
          continue;
        }
        const prep = prepared(
          binding,
          ps.map((p) => (p ? p.default : 0)),
        );
        if (!prep.ok) {
          warn(binding, `無視する（${prep.reason}）`);
          continue;
        }
        if (prep.warning) warn(binding, prep.warning);
        if (prep.values.length === 0) continue;

        // ここでは parameterIds が 1〜MAX_BINDING_PARAMETERS 個で、どれもモデルにある
        for (let k = 0; k < prep.dims; k++)
          fraction[k] = fractionalIndex(prep.axes[k]!, parameterValue(ps[k]!, params));
        const n = corners(prep, prep.dims);
        const targetId = binding.target.id;

        if (prep.kind === 'transform') {
          let px = 0;
          let py = 0;
          let rot = 0;
          let sx = 0;
          let sy = 0;
          let op = 0;
          for (let c = 0; c < n; c++) {
            const d = prep.values[cornerIndex[c]!]!;
            const w = cornerWeight[c]!;
            px += d.position.x * w;
            py += d.position.y * w;
            rot += d.rotation * w;
            sx += d.scale.x * w;
            sy += d.scale.y * w;
            op += d.opacity * w;
          }
          const acc: TransformDelta = Object.hasOwn(out.transforms, targetId)
            ? out.transforms[targetId]!
            : (out.transforms[targetId] = identityDelta());
          // 同じパーツの差分: 位置・回転は加算、拡縮は乗算
          acc.position.x += px;
          acc.position.y += py;
          acc.rotation += rot;
          acc.scale.x *= sx;
          acc.scale.y *= sy;
          // 不透明度のバインディングは、デフォルト値からの変化を足す（あとで Part.opacity に足す。I-026）
          if (prep.opacityAtDefault !== null) {
            opacityChanges.set(targetId, (opacityChanges.get(targetId) ?? 0) + op - prep.opacityAtDefault);
          }
          continue;
        }

        const isMesh = binding.channel === 'vertices';
        const expected = (isMesh ? vertexCounts : controlCounts).get(targetId);
        if (expected === undefined) {
          warn(binding, `無視する（対象の${isMesh ? 'メッシュ' : 'ワープ'} ${targetId} が無い）`);
          continue;
        }
        if (prep.count !== expected) {
          warn(
            binding,
            `無視する（差分の長さ ${prep.count} が${isMesh ? 'メッシュの頂点' : 'ワープの制御点'}の数 ${expected} と違う）`,
          );
          continue;
        }
        const record = isMesh ? out.vertices : out.warpPoints;
        const acc = Object.hasOwn(record, targetId)
          ? record[targetId]!
          : (record[targetId] = new Float32Array(expected * 2));
        addWeighted(acc, prep.values, n);
      }
      // パーツ自身の不透明度 = Part.opacity + 不透明度のバインディングの変化の和（0..1 に収める。I-026）
      if (opacityChanges.size > 0) {
        const opacities: Record<string, number> = {};
        for (const part of model.parts) {
          const change = opacityChanges.get(part.id);
          if (change !== undefined) opacities[part.id] = clamp(part.opacity + change, 0, 1);
        }
        out.opacities = opacities;
      }
      return out;
    },
  };
}
