// パーツの変形（transform チャンネル）の編集。基準状態なら Part の値、パラメータの編集中ならキーの差分を変える
import { newId, type Model, type Part, type Project, type TransformDelta } from '@app/schema';
import type { Command, EditorState, TransformChange } from '@app/contracts';
import { modelCommand } from '@app/core';
import {
  activeParams,
  addKey,
  editKey,
  isBaseState,
  isEasy,
  type ActiveParam,
  type DeltaOps,
  type KeySpec,
} from './common';

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const same = (a: number, b: number) => Math.abs(a - b) <= 1e-9;
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

// 位置・回転は加算、拡縮・不透明度は倍率（1 = 変化なし）
export const transformOps: DeltaOps<TransformDelta> = {
  identity: () => ({ position: { x: 0, y: 0 }, rotation: 0, scale: { x: 1, y: 1 }, opacity: 1 }),
  read: (delta) => (Array.isArray(delta) ? transformOps.identity() : delta),
  lerp: (a, b, t) => ({
    position: { x: lerp(a.position.x, b.position.x, t), y: lerp(a.position.y, b.position.y, t) },
    rotation: lerp(a.rotation, b.rotation, t),
    scale: { x: lerp(a.scale.x, b.scale.x, t), y: lerp(a.scale.y, b.scale.y, t) },
    opacity: lerp(a.opacity, b.opacity, t),
  }),
  combine: (a, b) => ({
    position: { x: a.position.x + b.position.x, y: a.position.y + b.position.y },
    rotation: a.rotation + b.rotation,
    scale: { x: a.scale.x * b.scale.x, y: a.scale.y * b.scale.y },
    opacity: a.opacity * b.opacity,
  }),
  same: (a, b) =>
    same(a.position.x, b.position.x) &&
    same(a.position.y, b.position.y) &&
    same(a.rotation, b.rotation) &&
    same(a.scale.x, b.scale.x) &&
    same(a.scale.y, b.scale.y) &&
    same(a.opacity, b.opacity),
};

// キーの差分に変更を足す（位置・回転は加算、scaleFactor・opacityFactor は掛ける）
export function applyChangeToDelta(delta: TransformDelta, change: TransformChange): TransformDelta {
  const { dPosition, dRotation, scaleFactor, opacityFactor } = change;
  return {
    position: dPosition ? { x: delta.position.x + dPosition.x, y: delta.position.y + dPosition.y } : delta.position,
    rotation: delta.rotation + (dRotation ?? 0),
    scale: scaleFactor ? { x: delta.scale.x * scaleFactor.x, y: delta.scale.y * scaleFactor.y } : delta.scale,
    opacity: opacityFactor !== undefined ? Math.max(0, delta.opacity * opacityFactor) : delta.opacity,
  };
}

function applyChangeToPart(part: Part, change: TransformChange): Part {
  const { dPosition, dRotation, scaleFactor, opacityFactor, dPivot } = change;
  const next: Part = {
    ...part,
    position: dPosition ? { x: part.position.x + dPosition.x, y: part.position.y + dPosition.y } : part.position,
    rotation: part.rotation + (dRotation ?? 0),
    scale: scaleFactor ? { x: part.scale.x * scaleFactor.x, y: part.scale.y * scaleFactor.y } : part.scale,
    opacity: opacityFactor !== undefined ? clamp01(part.opacity * opacityFactor) : part.opacity,
    pivot: dPivot ? { x: part.pivot.x + dPivot.x, y: part.pivot.y + dPivot.y } : part.pivot,
  };
  const unchanged =
    next.position === part.position &&
    next.rotation === part.rotation &&
    next.scale === part.scale &&
    next.opacity === part.opacity &&
    next.pivot === part.pivot;
  return unchanged ? part : next;
}

const noop = (label: string): Command => ({ label, apply: (p) => p });

// 基準状態の変形（Part の position・rotation・scale・pivot・opacity）
function baseTransformCommand(partIds: string[], change: TransformChange): Command {
  const ids = new Set(partIds);
  return modelCommand('パーツの変形', (model) => {
    let changed = false;
    const parts = model.parts.map((part) => {
      if (!ids.has(part.id)) return part;
      const next = applyChangeToPart(part, change);
      if (next !== part) changed = true;
      return next;
    });
    return changed ? { ...model, parts } : model;
  });
}

function hasKeyChange(change: TransformChange): boolean {
  return (
    change.dPosition !== undefined ||
    change.dRotation !== undefined ||
    change.scaleFactor !== undefined ||
    change.opacityFactor !== undefined
  );
}

function partSpec(partId: string, params: ActiveParam[], editor: EditorState): KeySpec<TransformDelta> {
  return {
    target: { type: 'part', id: partId, channel: 'transform' },
    params,
    easy: isEasy(editor),
    newBindingId: newId(),
    ops: transformOps,
  };
}

export function transformEdit(
  project: Project,
  editor: EditorState,
  partIds: string[],
  change: TransformChange,
): Command | 'needsKey' {
  const model = project.model;
  const params = activeParams(model, editor);
  if (isBaseState(params)) return baseTransformCommand(partIds, change);

  // dPivot は基準状態でだけ受け付ける
  const { dPivot: _pivot, ...keyChange } = change;
  const ids = [...new Set(partIds)].filter((id) => model.parts.some((p) => p.id === id));
  if (ids.length === 0 || !hasKeyChange(keyChange)) return noop('パーツの変形');

  const specs = ids.map((id) => partSpec(id, params, editor));
  const run = (m: Model): Model | 'needsKey' => {
    let out = m;
    for (const spec of specs) {
      const next = editKey(out, spec, (d) => applyChangeToDelta(d, keyChange));
      if (next === 'needsKey') return 'needsKey'; // 1つでもキーの無いパーツがあれば何も変えない
      out = next;
    }
    return out;
  };
  if (run(model) === 'needsKey') return 'needsKey';
  return modelCommand('パーツの変形（キー）', (m) => {
    const next = run(m);
    return next === 'needsKey' ? m : next;
  });
}

export function addTransformKey(project: Project, editor: EditorState, partId: string): Command {
  const model = project.model;
  const params = activeParams(model, editor);
  if (isBaseState(params) || !model.parts.some((p) => p.id === partId)) return noop('キーの追加');
  const spec = partSpec(partId, params, editor);
  return modelCommand('キーの追加', (m) => addKey(m, spec));
}
