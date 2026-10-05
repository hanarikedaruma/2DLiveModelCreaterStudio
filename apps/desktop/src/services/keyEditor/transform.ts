// パーツの変形（transform チャンネル）の編集。基準状態なら Part の値、パラメータの編集中ならキーの差分を変える
import { newId, type Binding, type Model, type Part, type Project, type TransformDelta } from '@app/schema';
import type { Command, EditorState, ParamValues, TransformChange } from '@app/contracts';
import { bindingOpacity, modelCommand, rawPartOpacity, withPartOpacity } from '@app/core';
import {
  activeParams,
  addKey,
  coordsOf,
  editKey,
  findBinding,
  isBaseState,
  isEasy,
  keyIndexAt,
  replaceBinding,
  sampleBinding,
  type ActiveParam,
  type DeltaOps,
  type KeySpec,
} from './common';

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const same = (a: number, b: number) => Math.abs(a - b) <= 1e-9;
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

// 位置・回転は加算、拡縮は倍率（1 = 変化なし）。opacity は不透明度のバインディングでだけ使う（使わないものは 1）
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

// 不透明度のバインディング（controlsOpacity）の差分の扱い方（I-026）。opacity は絶対値で、変化なしは基準の不透明度 base。
// 2パラメータの格子の代用は (x, y0) + (x0, y) − (x0, y0)（評価と同じ）
export function opacityOps(base: number): DeltaOps<TransformDelta> {
  const identity = () => ({ ...transformOps.identity(), opacity: base });
  return {
    ...transformOps,
    identity,
    read: (delta) => (Array.isArray(delta) ? identity() : delta),
    combine: (a, b) => ({ ...transformOps.combine(a, b), opacity: a.opacity + b.opacity - base }),
  };
}

// キーの差分に変更を足す（位置・回転は加算、scaleFactor は掛ける。opacity は別に扱う）
export function applyChangeToDelta(delta: TransformDelta, change: TransformChange): TransformDelta {
  const { dPosition, dRotation, scaleFactor } = change;
  return {
    position: dPosition ? { x: delta.position.x + dPosition.x, y: delta.position.y + dPosition.y } : delta.position,
    rotation: delta.rotation + (dRotation ?? 0),
    scale: scaleFactor ? { x: delta.scale.x * scaleFactor.x, y: delta.scale.y * scaleFactor.y } : delta.scale,
    opacity: delta.opacity,
  };
}

function applyChangeToPart(part: Part, change: TransformChange): Part {
  const { dPosition, dRotation, scaleFactor, opacity, dPivot } = change;
  const next: Part = {
    ...part,
    position: dPosition ? { x: part.position.x + dPosition.x, y: part.position.y + dPosition.y } : part.position,
    rotation: part.rotation + (dRotation ?? 0),
    scale: scaleFactor ? { x: part.scale.x * scaleFactor.x, y: part.scale.y * scaleFactor.y } : part.scale,
    opacity: opacity !== undefined ? clamp01(opacity) : part.opacity,
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

// 基準状態の変形（Part の position・rotation・scale・pivot・opacity）。不透明度を変えたパーツは、不透明度の
// バインディングのデフォルト値のキーも同じ値にする（I-026）
function baseTransformCommand(partIds: string[], change: TransformChange): Command {
  const ids = new Set(partIds);
  return modelCommand('パーツの変形', (model) => {
    let changed = false;
    const opacityChanged: string[] = [];
    const parts = model.parts.map((part) => {
      if (!ids.has(part.id)) return part;
      const next = applyChangeToPart(part, change);
      if (next !== part) changed = true;
      if (next.opacity !== part.opacity) opacityChanged.push(part.id);
      return next;
    });
    if (!changed) return model;
    let out: Model = { ...model, parts };
    for (const id of opacityChanged) out = withPartOpacity(out, id, out.parts.find((p) => p.id === id)!.opacity);
    return out;
  });
}

function hasKeyChange(change: TransformChange): boolean {
  return (
    change.dPosition !== undefined ||
    change.dRotation !== undefined ||
    change.scaleFactor !== undefined ||
    change.opacity !== undefined
  );
}

const baseOpacityOf = (model: Model, partId: string) => model.parts.find((p) => p.id === partId)?.opacity ?? 1;

function partSpec(model: Model, partId: string, params: ActiveParam[], editor: EditorState): KeySpec<TransformDelta> {
  const base = baseOpacityOf(model, partId);
  return {
    target: { type: 'part', id: partId, channel: 'transform' },
    params,
    easy: isEasy(editor),
    newBindingId: newId(),
    ops: transformOps,
    // 不透明度のバインディングでは、足すキー・格子の代用の opacity も絶対値で求める
    opsFor: (binding) => (binding?.controlsOpacity ? opacityOps(base) : transformOps),
  };
}

// いまのプレビューの値（編集中のパラメータもほかのパラメータも editorParamValues。無ければデフォルト値）
const previewValues = (editor: EditorState): ParamValues => editor.editorParamValues;

// 不透明度のバインディングにする。キーの opacity（使っていなかった値）をすべて基準の不透明度にし（見た目は変わらない）、
// デフォルト値のキーが無ければ足す
function toOpacityBinding(binding: Binding, params: ActiveParam[], base: number): Binding {
  const keys = binding.keys.map((k) => (Array.isArray(k.delta) ? k : { ...k, delta: { ...k.delta, opacity: base } }));
  const defaults = coordsOf(binding, params, 'default');
  if (keyIndexAt(binding, defaults) < 0) {
    const delta = sampleBinding(binding, defaults, defaults, transformOps);
    keys.push({ coords: defaults, delta: { ...delta, opacity: base }, source: 'auto', locked: false });
  }
  return { ...binding, keys, controlsOpacity: true };
}

// いまの値で、パーツ自身の不透明度を target にする（I-026）。このパラメータの組のバインディングを不透明度のバインディング
// にし、ほかの不透明度のバインディングの分を除いた値をキーに記録する（記録する値は 0..1 に収める）
function editOpacityKey(
  model: Model,
  spec: KeySpec<TransformDelta>,
  editor: EditorState,
  target: number,
): Model | 'needsKey' {
  const partId = spec.target.id;
  const base = baseOpacityOf(model, partId);
  let m = model;
  const existing = findBinding(m, spec.target, spec.params);
  if (existing && !existing.controlsOpacity) m = replaceBinding(m, toOpacityBinding(existing, spec.params, base));
  const binding = findBinding(m, spec.target, spec.params);
  const values = previewValues(editor);
  const others = rawPartOpacity(m, partId, values, binding?.id); // 基準 + ほかのバインディングの変化
  const atDefault = binding ? (bindingOpacity(m, binding, values)?.atDefault ?? base) : base;
  const value = clamp01(clamp01(target) - others + atDefault);
  const opacitySpec: KeySpec<TransformDelta> = { ...spec, opsFor: () => opacityOps(base) };
  const next = editKey(m, opacitySpec, (d) => ({ ...d, opacity: value }));
  if (next === 'needsKey') return 'needsKey';
  const made = findBinding(next, spec.target, spec.params);
  return made && !made.controlsOpacity ? replaceBinding(next, { ...made, controlsOpacity: true }) : next;
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
  const { dPivot: _pivot, opacity, ...keyChange } = change;
  const ids = [...new Set(partIds)].filter((id) => model.parts.some((p) => p.id === id));
  if (ids.length === 0 || !hasKeyChange(change)) return noop('パーツの変形');
  const moves = hasKeyChange(keyChange);

  // バインディングを作るときの id はここで決めておく（apply を純粋にする）
  const specs = ids.map((id) => partSpec(model, id, params, editor));
  const run = (m: Model): Model | 'needsKey' => {
    let out = m;
    for (const spec of specs) {
      if (moves) {
        const next = editKey(out, spec, (d) => applyChangeToDelta(d, keyChange));
        if (next === 'needsKey') return 'needsKey'; // 1つでもキーの無いパーツがあれば何も変えない
        out = next;
      }
      if (opacity !== undefined) {
        const next = editOpacityKey(out, spec, editor, opacity);
        if (next === 'needsKey') return 'needsKey';
        out = next;
      }
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
  const spec = partSpec(model, partId, params, editor);
  return modelCommand('キーの追加', (m) => addKey(m, spec));
}
