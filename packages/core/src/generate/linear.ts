import type { Binding, ParameterKey } from '@app/schema';
import { deepEqual } from './equal';
import { COORD_EPSILON, keyCoord, lerpDelta, roundCoord, sameCoord, sortKeys, sortedUnique } from './keys';

// 代表状態のキー（manual か auto、またはロックされたキー）
export function isRepresentativeKey(key: ParameterKey): boolean {
  return key.source === 'manual' || key.source === 'auto' || key.locked;
}

// 作り直すキー（generated で未ロック）
function isRegenerated(key: ParameterKey): boolean {
  return key.source === 'generated' && !key.locked;
}

// 自動のときの刻み。範囲が10を超えるパラメータは10、それ以外は 0.25
export function linearStep(range: number): number {
  return range > 10 ? 10 : 0.25;
}

// 区間の分割数として使える値にする。使えなければ null（自動）
export function normalizeDivisions(divisions: number | null | undefined): number | null {
  if (divisions === null || divisions === undefined || !Number.isFinite(divisions) || divisions < 1) return null;
  return Math.floor(divisions);
}

export interface LinearOptions {
  divisions: number | null; // 区間の分割数（null なら刻みで決める）
  range: number | null; // パラメータの範囲（max − min）。null ならキーの範囲で代用する
}

// 代表状態の隣り合う2つの間に、線形補間した中間キー（source 'generated'）を等間隔に作る。
// 1パラメータのバインディングだけが対象。結果が同じ内容なら元のバインディングを返す
export function generateLinearKeys(binding: Binding, options: LinearOptions): Binding {
  if (binding.parameterIds.length !== 1) return binding;
  const divisions = normalizeDivisions(options.divisions);
  const kept = binding.keys.filter((k) => !isRegenerated(k));
  const anchors = sortKeys(kept.filter(isRepresentativeKey));
  const range = options.range ?? spanOf([...(binding.keyValues[0] ?? []), ...binding.keys.map(keyCoord)]);
  const step = linearStep(range);

  const fresh: ParameterKey[] = [];
  for (let i = 0; i + 1 < anchors.length; i++) {
    const a = anchors[i]!;
    const b = anchors[i + 1]!;
    const from = keyCoord(a);
    const to = keyCoord(b);
    if (to - from <= COORD_EPSILON) continue;
    // 刻みを超えない等間隔にする
    const n = divisions ?? Math.max(1, Math.ceil((to - from) / step - COORD_EPSILON));
    for (let j = 1; j < n; j++) {
      const t = j / n;
      const coord = roundCoord(from + (to - from) * t);
      if (kept.some((k) => sameCoord(keyCoord(k), coord))) continue;
      const delta = lerpDelta(a.delta, b.delta, t);
      if (!delta) continue;
      fresh.push({ coords: [coord], delta, source: 'generated', locked: false });
    }
  }

  const keys = sortKeys([...kept, ...fresh]);
  // 消した中間キーの位置は keyValues からも除く（ほかの値はそのまま残す）
  const removed = binding.keys.filter(isRegenerated).map(keyCoord);
  const carried = (binding.keyValues[0] ?? []).filter(
    (v) => !removed.some((c) => sameCoord(c, v)) || keys.some((k) => sameCoord(keyCoord(k), v)),
  );
  const next: Binding = {
    ...binding,
    keyValues: [sortedUnique([...carried, ...keys.map(keyCoord)])],
    keys,
    generation: 'linear',
    divisions,
  };
  return deepEqual(next, binding) ? binding : next;
}

function spanOf(values: number[]): number {
  if (values.length === 0) return 0;
  return Math.max(...values) - Math.min(...values);
}
