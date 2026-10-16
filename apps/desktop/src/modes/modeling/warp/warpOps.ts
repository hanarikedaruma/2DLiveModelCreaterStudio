// ワープの追加・削除のコマンドと、追加するときの格子の計算（カード29）。計算は純粋関数
import { newId, type Model, type Part, type Project, type Vec2, type Warp } from '@app/schema';
import type { Command, TargetDeltas } from '@app/contracts';
import {
  baseWarpAngle,
  createBindingEvaluator,
  createDeformPipeline,
  isUsableWarp,
  pointsToAncestorSpace,
  refitWarp,
  regularWarpPoints,
  reorientWarp,
  warpFrameBounds,
  warpToFrame,
} from '@app/core';
import { ancestorsOf, imageDescendants, partById } from '../canvas/parts';

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

// パーツに付いているワープ（画像・グループとも1つまで作る）
export function warpOfPart(model: Model, partId: string): Warp | undefined {
  return model.warps.find((w) => w.partId === partId);
}

export function warpPart(model: Model, partId: string | undefined): Part | null {
  const part = partId === undefined ? undefined : partById(model, partId);
  return part ?? null;
}

const hasUsableWarp = (model: Model, partId: string) => {
  const warp = warpOfPart(model, partId);
  return !!warp && isUsableWarp(warp);
};

// 押した画像自身の格子、格子のある最も近い親、押した画像の順で選ぶ
export function pickWarpPart(model: Model, imageId: string): string {
  if (hasUsableWarp(model, imageId)) return imageId;
  const groups = ancestorsOf(model, imageId).filter((p) => p.kind === 'group');
  return groups.find((g) => hasUsableWarp(model, g.id))?.id ?? imageId;
}

export interface WarpChoice {
  part: Part;
  depth: number; // 字下げ（いちばん上の祖先が 0）
  warp: boolean; // 格子が付いている
}

// 対象を変える候補: 祖先、選択したパーツ、画像を含む直下のグループと子孫の画像
export function warpPartChoices(project: Project, groupId: string): WarpChoice[] {
  const model = project.model;
  const group = warpPart(model, groupId);
  if (!group) return [];
  const chain = [...ancestorsOf(model, group.id).filter((p) => p.kind === 'group')].reverse();
  const children = model.parts.filter(
    (p) =>
      (p.parentId === group.id && p.kind === 'group' && imageDescendants(model, p.id).length > 0) ||
      (p.kind === 'image' && ancestorsOf(model, p.id).some((a) => a.id === group.id)),
  );
  const choice = (part: Part, depth: number) => ({ part, depth, warp: hasUsableWarp(model, part.id) });
  return [
    ...chain.map((p, i) => choice(p, i)),
    choice(group, chain.length),
    ...children.map((p) => choice(p, chain.length + ancestorsOf(model, p.id).findIndex((a) => a.id === group.id) + 1)),
  ];
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
  return pointsBounds(warpInputPoints(project, groupId));
}

function pointsBounds(points: Vec2[]): Rect | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  if (minX > maxX || minY > maxY) return null;
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

export function warpInputPoints(project: Project, partId: string): Vec2[] {
  const model = project.model,
    selected = partById(model, partId);
  if (!selected) return [];
  if (selected.kind === 'image') return basePoints(project, selected);
  return imageDescendants(model, partId).flatMap((id) => {
    const part = partById(model, id);
    return part ? pointsToAncestorSpace(model, NO_DELTAS, id, partId, basePoints(project, part)) : [];
  });
}

// 外接矩形に余白を足した格子の範囲。幅や高さが 0 でも格子が潰れないよう、余白は最低 1px にする
export function warpBoundsFor(rect: Rect): Rect {
  const mx = Math.max(rect.width * WARP_MARGIN, 1);
  const my = Math.max(rect.height * WARP_MARGIN, 1);
  return { x: rect.x - mx, y: rect.y - my, width: rect.width + mx * 2, height: rect.height + my * 2 };
}

// グループに付けるワープ（規則的な格子なので、付けただけでは見た目は変わらない）。付けられなければ null
export function createWarp(project: Project, groupId: string, columns: number, rows: number, id: string): Warp | null {
  if (!warpPart(project.model, groupId)) return null;
  const angle = baseWarpAngle(project.model, groupId);
  const bounds = warpFrameBounds(warpInputPoints(project, groupId), angle, WARP_MARGIN);
  if (!bounds) return null;
  const c = clampDivisions(columns);
  const r = clampDivisions(rows);
  return {
    id,
    partId: groupId,
    columns: c,
    rows: r,
    bounds,
    ...(angle !== 0 ? { angle } : {}),
    points: regularWarpPoints(bounds, c, r, angle),
  };
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

export function warpNeedsRefit(project: Project, warp: Warp): boolean {
  const rect = pointsBounds(warpInputPoints(project, warp.partId).map((p) => warpToFrame(warp, p)));
  const b = warp.bounds;
  return (
    rect !== null &&
    (rect.x < b.x - 1e-6 ||
      rect.y < b.y - 1e-6 ||
      rect.x + rect.width > b.x + b.width + 1e-6 ||
      rect.y + rect.height > b.y + b.height + 1e-6)
  );
}

export function refitWarpCommand(project: Project, warpId: string): Command | null {
  const warp = project.model.warps.find((w) => w.id === warpId);
  const rect = warp ? pointsBounds(warpInputPoints(project, warp.partId).map((p) => warpToFrame(warp, p))) : null;
  if (!warp || !rect) return null;
  const result = refitWarp(warp, warpBoundsFor(rect), project.model.bindings);
  if (!result) return null;
  return {
    label: 'ワープの範囲を合わせ直す',
    apply: (p) =>
      p !== project || result.warp === warp
        ? p
        : {
            ...p,
            model: {
              ...p.model,
              warps: p.model.warps.map((w) => (w.id === warpId ? result.warp : w)),
              bindings: result.bindings,
            },
          },
  };
}

// 表示するずれは、既定値・全キー座標・1軸の途中の姿勢で、全描画頂点を実測する
export function straightenWarpCommand(
  project: Project,
  warpId: string,
): { command: Command; maxError: number; samples: number } | null {
  const warp = project.model.warps.find((w) => w.id === warpId);
  if (!warp) return null;
  const result = reorientWarp(warp, baseWarpAngle(project.model, warp.partId), project.model.bindings);
  if (!result) return null;
  const model = {
    ...project.model,
    warps: project.model.warps.map((w) => (w.id === warpId ? result.warp : w)),
    bindings: result.bindings,
  };
  const values: Record<string, number>[] = [{}];
  for (const b of project.model.bindings) {
    for (const k of b.keys) values.push(Object.fromEntries(b.parameterIds.map((id, i) => [id, k.coords[i] ?? 0])));
    if (b.parameterIds.length === 1) {
      const coords = [...new Set(b.keys.map((k) => k.coords[0]!))].sort((a, b) => a - b);
      for (let i = 1; i < coords.length; i++) values.push({ [b.parameterIds[0]!]: (coords[i - 1]! + coords[i]!) / 2 });
    }
  }
  const evaluator = createBindingEvaluator(),
    pipeline = createDeformPipeline();
  let maxError = 0;
  for (const v of values) {
    const old = pipeline.deform(project.model, evaluator.evaluate(project.model, v));
    const next = pipeline.deform(model, evaluator.evaluate(model, v));
    for (const item of old.items) {
      const other = next.byPartId[item.partId];
      if (!other) return null;
      for (let i = 0; i < item.positions.length; i += 2)
        maxError = Math.max(
          maxError,
          Math.hypot(item.positions[i]! - other.positions[i]!, item.positions[i + 1]! - other.positions[i + 1]!),
        );
    }
  }
  if (!Number.isFinite(maxError)) return null;
  return {
    maxError,
    samples: values.length,
    command: {
      label: '格子をまっすぐにする',
      apply: (p) => (p !== project || result.warp === warp ? p : { ...p, model }),
    },
  };
}
