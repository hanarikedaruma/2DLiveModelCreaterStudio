// 揺れの自動作成（カード50）のバインディング。揺れパラメータの値 ±1 で、パーツ全体をピボット中心に回し（transform）、
// 画像パーツは先端ほど大きく曲げる（vertices）。どれも純粋関数
import type { Binding, Mesh, Model, ParameterKey, Part, TransformDelta, Vec2 } from '@app/schema';
import { generateRotateKeys } from '@app/core';

export const SWAY_ROTATION = 12; // 値 ±1 での transform の Δrotation（度）
export const SWAY_BEND = 12; // 値 ±1 での、先端の頂点の曲げ（transform の回転に足す角度。度）
export const SWAY_STEP = 0.25; // vertices の中間キーの間隔（generateRotateKeys で作る）

const IDENTITY: TransformDelta = { position: { x: 0, y: 0 }, rotation: 0, scale: { x: 1, y: 1 }, opacity: 1 };
const clean = (v: number) => v + 0; // -0 を 0 にする

// 値 v の transform（Δrotation = v × SWAY_ROTATION。ほかは変化なし）
function rotationDelta(v: number): TransformDelta {
  return { ...IDENTITY, rotation: clean(v * SWAY_ROTATION) };
}

// transform のバインディング（キーは −1・0・1、source 'auto'）
export function swayTransformBinding(id: string, partId: string, parameterId: string): Binding {
  const keys: ParameterKey[] = [-1, 0, 1].map((v) => ({
    coords: [v],
    delta: rotationDelta(v),
    source: 'auto',
    locked: false,
  }));
  return {
    id,
    target: { type: 'part', id: partId },
    channel: 'transform',
    parameterIds: [parameterId],
    keyValues: [[-1, 0, 1]],
    keys,
    generation: 'linear',
    divisions: null,
  };
}

// 頂点ごとの曲げの重み（0..1）。根元（ピボット）から先端へ向かう向きでの距離の割合の2乗。
// 向きはピボットから頂点の重心へ（重心がピボットとほぼ重なるときは下向き）。根元より後ろの頂点は 0
export function bendWeights(base: readonly Vec2[], pivot: Vec2): number[] {
  if (base.length === 0) return [];
  let cx = 0;
  let cy = 0;
  for (const v of base) {
    cx += v.x;
    cy += v.y;
  }
  cx = cx / base.length - pivot.x;
  cy = cy / base.length - pivot.y;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const v of base) {
    minX = Math.min(minX, v.x);
    minY = Math.min(minY, v.y);
    maxX = Math.max(maxX, v.x);
    maxY = Math.max(maxY, v.y);
  }
  const size = Math.max(maxX - minX, maxY - minY);
  const len = Math.hypot(cx, cy);
  const axis = len > size * 0.01 && len > 0 ? { x: cx / len, y: cy / len } : { x: 0, y: 1 };
  const along = base.map((v) => Math.max(0, (v.x - pivot.x) * axis.x + (v.y - pivot.y) * axis.y));
  const tip = Math.max(...along);
  if (!(tip > 0)) return base.map(() => 0);
  return along.map((d) => (d / tip) ** 2);
}

// 値 v（±1）の頂点の差分。頂点 i をピボット中心に v × SWAY_BEND × 重み i だけ回す
// （y が下向きで正の角度が時計回り。transform の回転と同じ向き）
export function bendDeltas(base: readonly Vec2[], pivot: Vec2, weights: readonly number[], v: number): Vec2[] {
  return base.map((p, i) => {
    const rad = (v * SWAY_BEND * (weights[i] ?? 0) * Math.PI) / 180;
    const dx = p.x - pivot.x;
    const dy = p.y - pivot.y;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    return { x: clean(pivot.x + cos * dx - sin * dy - p.x), y: clean(pivot.y + sin * dx + cos * dy - p.y) };
  });
}

// vertices のバインディング。−1・0・1 は source 'auto'、その間（SWAY_STEP ごと）は generateRotateKeys で
// 円弧に沿って作る（source 'generated'）。方式は 'rotate'（[すべて再補間] でも同じ形になる）
export function swayVertexBinding(id: string, mesh: Mesh, pivot: Vec2, parameterId: string): Binding {
  const base = mesh.vertices;
  const weights = bendWeights(base, pivot);
  const zero: Vec2[] = base.map(() => ({ x: 0, y: 0 }));
  const ts: number[] = [];
  for (let t = SWAY_STEP; t < 1 - 1e-9; t += SWAY_STEP) ts.push(Math.round(t * 1e9) / 1e9);

  const keys: ParameterKey[] = [];
  const side = (sign: -1 | 1): ParameterKey[] => {
    const end = bendDeltas(base, pivot, weights, sign);
    const between = generateRotateKeys(base, pivot, zero, end, ts).map((delta, i): ParameterKey => ({
      coords: [clean(sign * ts[i]!)],
      delta,
      source: 'generated',
      locked: false,
    }));
    return [...between, { coords: [sign], delta: end, source: 'auto', locked: false }];
  };
  keys.push(...side(-1).reverse(), { coords: [0], delta: zero, source: 'auto', locked: false }, ...side(1));
  return {
    id,
    target: { type: 'mesh', id: mesh.id },
    channel: 'vertices',
    parameterIds: [parameterId],
    keyValues: [keys.map((k) => k.coords[0]!)],
    keys,
    generation: 'rotate',
    divisions: null,
  };
}

// 自動で作った揺れのバインディングか（このパーツの transform か、このパーツのメッシュの vertices で、
// 揺れパラメータだけを使い、手で直したキーが無いもの）
export function isAutoSwayBinding(binding: Binding, part: Part, parameterId: string): boolean {
  if (binding.parameterIds.length !== 1 || binding.parameterIds[0] !== parameterId) return false;
  const own =
    (binding.channel === 'transform' && binding.target.type === 'part' && binding.target.id === part.id) ||
    (binding.channel === 'vertices' &&
      binding.target.type === 'mesh' &&
      part.meshId !== null &&
      binding.target.id === part.meshId);
  return own && binding.keys.every((k) => k.source === 'auto' || k.source === 'generated');
}

export interface SwayBindingIds {
  transform: string;
  vertices: string;
}

// パーツの揺れのバインディングを作り直したモデル。同じ対象・チャンネル・パラメータのバインディングがあれば、
// 自動で作ったものは置き換え（id はそのまま）、手で直したものは残す。メッシュの無いパーツとグループは transform だけ
export function withSwayBindings(model: Model, part: Part, parameterId: string, ids: SwayBindingIds): Model {
  const mesh =
    part.kind === 'image' && part.meshId !== null ? model.meshes.find((m) => m.id === part.meshId) : undefined;
  const wanted: { match: (b: Binding) => boolean; make: (id: string) => Binding }[] = [
    {
      match: (b) => b.channel === 'transform' && b.target.type === 'part' && b.target.id === part.id,
      make: (id) => swayTransformBinding(id, part.id, parameterId),
    },
  ];
  if (mesh && mesh.vertices.length > 0) {
    wanted.push({
      match: (b) => b.channel === 'vertices' && b.target.type === 'mesh' && b.target.id === mesh.id,
      make: (id) => swayVertexBinding(id, mesh, part.pivot, parameterId),
    });
  }
  const fallback = [ids.transform, ids.vertices];
  let bindings = model.bindings;
  wanted.forEach(({ match, make }, i) => {
    const index = bindings.findIndex(
      (b) => match(b) && b.parameterIds.length === 1 && b.parameterIds[0] === parameterId,
    );
    const existing = bindings[index];
    if (existing && !isAutoSwayBinding(existing, part, parameterId)) return; // 手で直したものは残す
    const next = make(existing?.id ?? fallback[i]!);
    if (existing && JSON.stringify(existing) === JSON.stringify(next)) return; // 同じ内容なら置き換えない
    bindings = existing ? bindings.map((b, j) => (j === index ? next : b)) : [...bindings, next];
  });
  return bindings === model.bindings ? model : { ...model, bindings };
}
