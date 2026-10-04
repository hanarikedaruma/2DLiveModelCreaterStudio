// ワープの追加・削除のコマンドと、追加するときの格子の計算（カード29）。計算は純粋関数
import { newId, type Model, type Part, type Project, type Vec2, type Warp } from '@app/schema';
import type { Command, TargetDeltas } from '@app/contracts';
import { pointsToAncestorSpace, regularWarpPoints } from '@app/core';
import { imageDescendants, partById } from '../canvas/parts';

export const WARP_DIVISIONS = { min: 2, max: 8, initial: 4 } as const;
export const WARP_MARGIN = 0.05; // 子の外接矩形のまわりに足す余白（幅・高さに対する割合、各辺）

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

const NO_DELTAS: TargetDeltas = { transforms: {}, vertices: {}, warpPoints: {} };

export function clampDivisions(n: number): number {
  if (!Number.isFinite(n)) return WARP_DIVISIONS.initial;
  return Math.min(WARP_DIVISIONS.max, Math.max(WARP_DIVISIONS.min, Math.round(n)));
}

// グループに付いているワープ（1つのグループに1つまで作る）
export function warpOfPart(model: Model, partId: string): Warp | undefined {
  return model.warps.find((w) => w.partId === partId);
}

export function groupPart(model: Model, partId: string | undefined): Part | null {
  const part = partId === undefined ? undefined : partById(model, partId);
  return part?.kind === 'group' ? part : null;
}

// 画像パーツの基準の形（メッシュがあれば頂点、無ければ素材の矩形の四隅）。どちらも無ければ空
function basePoints(project: Project, part: Part): Vec2[] {
  const mesh = part.meshId ? project.model.meshes.find((m) => m.id === part.meshId) : undefined;
  if (mesh && mesh.vertices.length > 0) return mesh.vertices;
  const asset = part.assetId ? project.assets.find((a) => a.id === part.assetId) : undefined;
  if (!asset) return [];
  const { x, y } = asset.offset;
  return [
    { x, y },
    { x: x + asset.width, y },
    { x: x + asset.width, y: y + asset.height },
    { x, y: y + asset.height },
  ];
}

// 子孫の画像パーツの外接矩形（基準状態）。グループのワープを掛ける直前の空間
// （子孫の変形と、間にあるグループのワープ・変形を掛けた位置）で測る。画像パーツが無ければ null
export function descendantImageBounds(project: Project, groupId: string): Rect | null {
  const model = project.model;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const id of imageDescendants(model, groupId)) {
    if (id === groupId) continue;
    const part = partById(model, id);
    if (!part) continue;
    for (const p of pointsToAncestorSpace(model, NO_DELTAS, id, groupId, basePoints(project, part))) {
      if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
  }
  if (minX > maxX || minY > maxY) return null;
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

// 外接矩形に余白を足した格子の範囲。幅や高さが 0 でも格子が潰れないよう、余白は最低 1px にする
export function warpBoundsFor(rect: Rect): Rect {
  const mx = Math.max(rect.width * WARP_MARGIN, 1);
  const my = Math.max(rect.height * WARP_MARGIN, 1);
  return { x: rect.x - mx, y: rect.y - my, width: rect.width + mx * 2, height: rect.height + my * 2 };
}

// グループに付けるワープ（規則的な格子なので、付けただけでは見た目は変わらない）。付けられなければ null
export function createWarp(project: Project, groupId: string, columns: number, rows: number, id: string): Warp | null {
  if (!groupPart(project.model, groupId)) return null;
  const rect = descendantImageBounds(project, groupId);
  if (!rect) return null;
  const bounds = warpBoundsFor(rect);
  const c = clampDivisions(columns);
  const r = clampDivisions(rows);
  return { id, partId: groupId, columns: c, rows: r, bounds, points: regularWarpPoints(bounds, c, r) };
}

// [ワープを追加]。id は apply を純粋にするため先に決めておく。すでにワープがあるか、付けられなければ何もしない
export function addWarpCommand(groupId: string, columns: number, rows: number, id: string = newId()): Command {
  return {
    label: 'ワープの追加',
    apply(project) {
      if (warpOfPart(project.model, groupId)) return project;
      const warp = createWarp(project, groupId, columns, rows, id);
      if (!warp) return project;
      return { ...project, model: { ...project.model, warps: [...project.model.warps, warp] } };
    },
  };
}

// このワープの制御点のバインディング
export function warpBindings(model: Model, warpId: string): Model['bindings'] {
  return model.bindings.filter((b) => b.target.type === 'warp' && b.target.id === warpId);
}

export function warpKeyCount(model: Model, warpId: string): number {
  return warpBindings(model, warpId).reduce((n, b) => n + b.keys.length, 0);
}

// [ワープを削除]。関係するバインディングも消す
export function removeWarpCommand(warpId: string): Command {
  return {
    label: 'ワープの削除',
    apply(project) {
      const model = project.model;
      if (!model.warps.some((w) => w.id === warpId)) return project;
      const remove = new Set(warpBindings(model, warpId).map((b) => b.id));
      return {
        ...project,
        model: {
          ...model,
          warps: model.warps.filter((w) => w.id !== warpId),
          bindings: remove.size === 0 ? model.bindings : model.bindings.filter((b) => !remove.has(b.id)),
        },
      };
    },
  };
}

export const removeWarpMessage = (count: number) => `このワープのキー（${count}個）も消えます`;
