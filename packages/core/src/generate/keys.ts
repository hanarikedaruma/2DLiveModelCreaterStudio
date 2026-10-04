import type { Binding, ParameterKey, TransformDelta } from '@app/schema';
import { deepEqual } from './equal';

// キーの位置が同じとみなす差
export const COORD_EPSILON = 1e-9;

export function sameCoord(a: number, b: number): boolean {
  return Math.abs(a - b) <= COORD_EPSILON;
}

// -0 を 0 にする（保存やテストで 0 と -0 が混ざらないようにする）
export function clean(v: number): number {
  return v + 0;
}

// 計算で作ったキーの位置の端数（0.30000000000000004 など）を落とす
export function roundCoord(v: number): number {
  return clean(Math.round(v * 1e9) / 1e9);
}

// 1パラメータのキーの位置
export function keyCoord(key: ParameterKey): number {
  return key.coords[0] ?? 0;
}

export interface DeltaParts {
  x?: number;
  y?: number;
  rotation?: number;
  scaleX?: number;
  scaleY?: number;
  opacity?: number;
}

// 指定の無い成分は変化なし（位置・回転は 0、拡縮・不透明度は 1）
export function transformDelta(p: DeltaParts = {}): TransformDelta {
  return {
    position: { x: clean(p.x ?? 0), y: clean(p.y ?? 0) },
    rotation: clean(p.rotation ?? 0),
    scale: { x: clean(p.scaleX ?? 1), y: clean(p.scaleY ?? 1) },
    opacity: clean(p.opacity ?? 1),
  };
}

const lerp = (a: number, b: number, t: number) => clean(a + (b - a) * t);

// 2つの差分を成分ごとに線形補間する（拡縮・不透明度も倍率のまま）。形が合わなければ null
export function lerpDelta(a: ParameterKey['delta'], b: ParameterKey['delta'], t: number): ParameterKey['delta'] | null {
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return null;
    return a.map((p, i) => ({ x: lerp(p.x, b[i]!.x, t), y: lerp(p.y, b[i]!.y, t) }));
  }
  if (Array.isArray(a) || Array.isArray(b)) return null;
  return {
    position: { x: lerp(a.position.x, b.position.x, t), y: lerp(a.position.y, b.position.y, t) },
    rotation: lerp(a.rotation, b.rotation, t),
    scale: { x: lerp(a.scale.x, b.scale.x, t), y: lerp(a.scale.y, b.scale.y, t) },
    opacity: lerp(a.opacity, b.opacity, t),
  };
}

// キーを位置の昇順に並べる（同じ位置は元の順）
export function sortKeys(keys: readonly ParameterKey[]): ParameterKey[] {
  return [...keys].sort((p, q) => keyCoord(p) - keyCoord(q));
}

// 昇順で重なりの無い値の列
export function sortedUnique(values: readonly number[]): number[] {
  const out: number[] = [];
  for (const v of [...values].sort((a, b) => a - b)) {
    const last = out[out.length - 1];
    if (last === undefined || !sameCoord(last, v)) out.push(v);
  }
  return out;
}

// パーツの1パラメータの transform バインディング（最初の1つ）の番号。無ければ -1
export function findTransformBindingIndex(bindings: readonly Binding[], partId: string, parameterId: string): number {
  return bindings.findIndex(
    (b) =>
      b.channel === 'transform' &&
      b.target.type === 'part' &&
      b.target.id === partId &&
      b.parameterIds.length === 1 &&
      b.parameterIds[0] === parameterId,
  );
}

export interface KeySpec {
  coord: number;
  delta: TransformDelta;
}

export interface RebuildInput {
  existing: Binding | undefined;
  partId: string;
  parameterId: string;
  keys: readonly KeySpec[]; // 作るキー（source 'auto'）
  keep: (key: ParameterKey) => boolean; // 残す既存のキー
  generation: Binding['generation'];
  newId: () => string;
}

// 1パラメータの transform バインディングを作り直す。keep のキーは残し、同じ位置には新しいキーを作らない。
// 結果が既存と同じ内容なら既存をそのまま返す
export function rebuildTransformBinding(input: RebuildInput): Binding {
  const { existing } = input;
  const kept = existing ? existing.keys.filter(input.keep) : [];
  const fresh: ParameterKey[] = input.keys
    .filter((spec) => !kept.some((k) => sameCoord(keyCoord(k), spec.coord)))
    .map((spec) => ({ coords: [spec.coord], delta: spec.delta, source: 'auto', locked: false }));
  const keys = sortKeys([...kept, ...fresh]);
  const binding: Binding = {
    id: existing?.id ?? input.newId(),
    target: { type: 'part', id: input.partId },
    channel: 'transform',
    parameterIds: [input.parameterId],
    keyValues: [sortedUnique(keys.map(keyCoord))],
    keys,
    generation: input.generation,
    divisions: existing?.divisions ?? null,
  };
  return existing && deepEqual(binding, existing) ? existing : binding;
}
