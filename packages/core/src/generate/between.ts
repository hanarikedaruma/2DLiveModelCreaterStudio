// 代表状態の間に中間キーを作る共通の手順（カード31）。補間のしかただけを方式（回転・曲面・なめらか）ごとに差し替える
import type { Binding, ParameterKey } from '@app/schema';
import { deepEqual } from './equal';
import { COORD_EPSILON, keyCoord, lerpDelta, roundCoord, sameCoord, sortKeys, sortedUnique } from './keys';
import { isRepresentativeKey, normalizeDivisions } from './linear';

// 代表状態 a・b の間の、ts（0..1。区間の中の位置）ごとの差分を作る。作れない位置は null（キーを作らない）
export type Interpolator = (a: ParameterKey, b: ParameterKey, ts: number[]) => (ParameterKey['delta'] | null)[];

// 成分ごとの線形補間（linear・depth の中間キーと同じ）
export const linearInterpolator: Interpolator = (a, b, ts) => ts.map((t) => lerpDelta(a.delta, b.delta, t));

export interface BetweenOptions {
  divisions: number | null; // 区間の分割数（null なら step で決める）
  step: number; // 自動のときの刻み
  within: [number, number] | null; // 作り直す範囲（両端を含む。小さい順）。null なら全体
  generation: Binding['generation']; // 結果のバインディングの方式
}

// キー位置の広がり（パラメータの範囲が分からないときに刻みを決める）
export function keySpan(binding: Binding): number {
  const values = [...(binding.keyValues[0] ?? []), ...binding.keys.map(keyCoord)];
  if (values.length === 0) return 0;
  return Math.max(...values) - Math.min(...values);
}

// 範囲の両端を小さい順にする。使えない範囲なら null（全体）
export function normalizeWithin(range: readonly [number, number] | undefined | null): [number, number] | null {
  if (!range) return null;
  const [a, b] = range;
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return a <= b ? [a, b] : [b, a];
}

// 代表状態（manual・auto・ロックされたキー）の隣り合う2つの間に、interpolate で中間キー（source 'generated'）を
// 等間隔に作る。within があれば、その中の未ロックの generated だけを作り直し、範囲の外のキーはそのまま残す。
// 1パラメータのバインディングだけが対象。結果が同じ内容なら元のバインディングを返す
export function generateBetweenKeys(binding: Binding, interpolate: Interpolator, options: BetweenOptions): Binding {
  if (binding.parameterIds.length !== 1) return binding;
  const divisions = normalizeDivisions(options.divisions);
  const within = options.within;
  const inside = (c: number) => within === null || (c >= within[0] - COORD_EPSILON && c <= within[1] + COORD_EPSILON);
  const regenerated = (k: ParameterKey) => k.source === 'generated' && !k.locked && inside(keyCoord(k));

  const kept = binding.keys.filter((k) => !regenerated(k));
  // 補間の両端は範囲の外のものも使う（範囲が区間の途中で切れても、区間の両端の間で補間する）
  const anchors = sortKeys(kept.filter(isRepresentativeKey));
  const step = options.step > 0 ? options.step : 1;

  const fresh: ParameterKey[] = [];
  for (let i = 0; i + 1 < anchors.length; i++) {
    const a = anchors[i]!;
    const b = anchors[i + 1]!;
    const from = keyCoord(a);
    const to = keyCoord(b);
    if (to - from <= COORD_EPSILON) continue;
    // 刻みを超えない等間隔にする（linear と同じ位置）
    const n = divisions ?? Math.max(1, Math.ceil((to - from) / step - COORD_EPSILON));
    const spots: { t: number; coord: number }[] = [];
    for (let j = 1; j < n; j++) {
      const t = j / n;
      const coord = roundCoord(from + (to - from) * t);
      if (!inside(coord) || kept.some((k) => sameCoord(keyCoord(k), coord))) continue;
      spots.push({ t, coord });
    }
    if (spots.length === 0) continue;
    const deltas = interpolate(
      a,
      b,
      spots.map((s) => s.t),
    );
    spots.forEach((s, j) => {
      const delta = deltas[j];
      if (delta) fresh.push({ coords: [s.coord], delta, source: 'generated', locked: false });
    });
  }

  const keys = sortKeys([...kept, ...fresh]);
  // 消した中間キーの位置は keyValues からも除く（ほかの値はそのまま残す）
  const removed = binding.keys.filter(regenerated).map(keyCoord);
  const carried = (binding.keyValues[0] ?? []).filter(
    (v) => !removed.some((c) => sameCoord(c, v)) || keys.some((k) => sameCoord(keyCoord(k), v)),
  );
  const next: Binding = {
    ...binding,
    keyValues: [sortedUnique([...carried, ...keys.map(keyCoord)])],
    keys,
    generation: options.generation,
    divisions,
  };
  return deepEqual(next, binding) ? binding : next;
}
