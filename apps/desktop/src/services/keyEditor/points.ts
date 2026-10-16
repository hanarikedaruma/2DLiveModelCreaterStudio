// メッシュの頂点（vertices）・ワープの制御点（warpPoints）の編集。基準状態なら基準の点、パラメータの編集中ならキーの差分を変える
import { newId, type Model, type Project, type Vec2 } from '@app/schema';
import type { Command, EditorState, PointsTarget } from '@app/contracts';
import { modelCommand } from '@app/core';
import { activeParams, addKey, editKey, isBaseState, type BindingTarget, type DeltaOps } from './common';

const ZERO: Vec2 = { x: 0, y: 0 };
const same = (a: number, b: number) => Math.abs(a - b) <= 1e-9;

// 点ごとの差分（加算）。長さは対象の点の数 n にそろえる（足りない点は 0）
export function pointsOps(n: number): DeltaOps<Vec2[]> {
  const zeros = () => Array.from({ length: n }, () => ({ x: 0, y: 0 }));
  const at = (d: Vec2[], i: number) => d[i] ?? ZERO;
  return {
    identity: zeros,
    read: (delta) => {
      if (!Array.isArray(delta)) return zeros();
      return delta.length === n ? delta : Array.from({ length: n }, (_, i) => delta[i] ?? { x: 0, y: 0 });
    },
    lerp: (a, b, t) =>
      Array.from({ length: n }, (_, i) => {
        const p = at(a, i);
        const q = at(b, i);
        return { x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t };
      }),
    combine: (a, b) =>
      Array.from({ length: n }, (_, i) => {
        const p = at(a, i);
        const q = at(b, i);
        return { x: p.x + q.x, y: p.y + q.y };
      }),
    inverse: (a) =>
      Array.from({ length: n }, (_, i) => {
        const p = at(a, i);
        return { x: -p.x, y: -p.y };
      }),
    same: (a, b) =>
      Array.from({ length: n }, (_, i) => i).every((i) => same(at(a, i).x, at(b, i).x) && same(at(a, i).y, at(b, i).y)),
  };
}

type Move = { index: number; d: Vec2 };

// モデル座標で保存するキーのドラッグは、表示中のキャンバス座標の差分をそのまま使う。
export function meshKeySpace(project: Project, editor: EditorState, meshId: string): 'part' | 'model' {
  const params = activeParams(project.model, editor);
  if (isBaseState(params)) return 'part';
  const ids = params.map((p) => p.id);
  return project.model.bindings.some(
    (b) => b.target.id === meshId && b.vertexSpace === 'model' && b.parameterIds.some((id) => ids.includes(id)),
  )
    ? 'model'
    : 'part';
}

const labelOf = (target: PointsTarget) => (target.kind === 'mesh' ? '頂点の移動' : '制御点の移動');
const noop = (label: string): Command => ({ label, apply: (p) => p });

// 対象のバインディングの対象・チャンネルと点の数。対象が無ければ null
function resolve(model: Model, target: PointsTarget): { binding: BindingTarget; count: number } | null {
  if (target.kind === 'mesh') {
    const mesh = model.meshes.find((m) => m.id === target.meshId);
    return mesh ? { binding: { type: 'mesh', id: mesh.id, channel: 'vertices' }, count: mesh.vertices.length } : null;
  }
  const warp = model.warps.find((w) => w.id === target.warpId);
  return warp ? { binding: { type: 'warp', id: warp.id, channel: 'warpPoints' }, count: warp.points.length } : null;
}

function movePoints(points: Vec2[], moves: Move[]): Vec2[] {
  const out = points.slice();
  for (const { index, d } of moves) {
    const p = out[index];
    if (p) out[index] = { x: p.x + d.x, y: p.y + d.y };
  }
  return out;
}

// 基準状態の点（メッシュの vertices、ワープの points）を動かす
function baseCommand(target: PointsTarget, moves: Move[]): Command {
  return modelCommand(labelOf(target), (model) => {
    if (target.kind === 'mesh') {
      const mesh = model.meshes.find((m) => m.id === target.meshId);
      if (!mesh) return model;
      return {
        ...model,
        meshes: model.meshes.map((m) => (m === mesh ? { ...m, vertices: movePoints(m.vertices, moves) } : m)),
      };
    }
    const warp = model.warps.find((w) => w.id === target.warpId);
    if (!warp) return model;
    return {
      ...model,
      warps: model.warps.map((w) => (w === warp ? { ...w, points: movePoints(w.points, moves) } : w)),
    };
  });
}

export function pointsEdit(
  project: Project,
  editor: EditorState,
  target: PointsTarget,
  moves: Move[],
): Command | 'needsKey' {
  const model = project.model;
  const resolved = resolve(model, target);
  let valid = resolved
    ? moves.filter((m) => Number.isInteger(m.index) && m.index >= 0 && m.index < resolved.count)
    : [];
  if (!resolved || valid.length === 0) return noop(labelOf(target));

  const params = activeParams(model, editor);
  if (isBaseState(params)) return baseCommand(target, valid);

  if (target.kind === 'mesh' && meshKeySpace(project, editor, target.meshId) === 'model') {
    resolved.binding.vertexSpace = 'model';
    const item = project.physics.find((p) => p.deform === 'bounce' && p.bounce?.meshId === target.meshId);
    if (item?.bounce) valid = valid.filter((m) => item.bounce!.weights[m.index]! > 0);
    if (!valid.length) return noop(labelOf(target));
  }

  const spec = {
    target: resolved.binding,
    params,
    newBindingId: newId(),
    ops: pointsOps(resolved.count),
  };
  const edit = (delta: Vec2[]) => movePoints(delta, valid);
  if (editKey(model, spec, edit) === 'needsKey') return 'needsKey';
  return modelCommand(`${labelOf(target)}（キー）`, (m) => {
    const next = editKey(m, spec, edit);
    return next === 'needsKey' ? m : next;
  });
}

export function addPointsKey(project: Project, editor: EditorState, target: PointsTarget): Command {
  const model = project.model;
  const resolved = resolve(model, target);
  const params = activeParams(model, editor);
  if (!resolved || isBaseState(params)) return noop('キーの追加');
  if (target.kind === 'mesh' && meshKeySpace(project, editor, target.meshId) === 'model')
    resolved.binding.vertexSpace = 'model';
  const spec = {
    target: resolved.binding,
    params,
    newBindingId: newId(),
    ops: pointsOps(resolved.count),
  };
  return modelCommand('キーの追加', (m) => addKey(m, spec));
}
