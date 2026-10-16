// スライダーのキーの印と吸い付き、編集中の値にキーがあるか
import { MAX_BINDING_PARAMETERS, type Model, type Parameter, type ParameterKey } from '@app/schema';
import type { EditorState } from '@app/contracts';
import { activeParams, isCombinationGridPoint } from '../../../services/keyEditor/common';

const NEAR = 1e-6;
export const near = (a: number, b: number) => Math.abs(a - b) <= NEAR;

// ● = manual・auto（key）、○ = generated、■ = locked
export type MarkKind = 'key' | 'generated' | 'locked';
export interface KeyMark {
  value: number;
  kind: MarkKind;
}

const RANK: Record<MarkKind, number> = { generated: 0, key: 1, locked: 2 };

export function markKind(key: ParameterKey): MarkKind {
  if (key.locked) return 'locked';
  return key.source === 'generated' ? 'generated' : 'key';
}

// そのパラメータを使うバインディングのキー位置。同じ値は locked > manual・auto > generated の順で1つにまとめる
export function keyMarksFor(model: Model, parameterId: string): KeyMark[] {
  let marks: KeyMark[] = [];
  for (const binding of model.bindings) {
    if (binding.parameterIds.length !== 1) continue;
    const axis = binding.parameterIds.indexOf(parameterId);
    if (axis < 0) continue;
    for (const key of binding.keys) {
      const value = key.coords[axis];
      if (value === undefined) continue;
      const kind = markKind(key);
      const same = marks.find((m) => near(m.value, value));
      if (!same) marks = [...marks, { value, kind }];
      else if (RANK[kind] > RANK[same.kind]) marks = marks.map((m) => (m === same ? { value: m.value, kind } : m));
    }
  }
  return [...marks].sort((a, b) => a.value - b.value);
}

// 範囲の 2% 以内でキーに吸い付く
export const SNAP_RATIO = 0.02;

export function snapToKey(value: number, keyValues: number[], range: number): number {
  let best = value;
  let bestDistance = SNAP_RATIO * range;
  for (const k of keyValues) {
    const d = Math.abs(k - value);
    if (d <= bestDistance) {
      best = k;
      bestDistance = d;
    }
  }
  return best;
}

// モデリング中のプレビュー値（無ければデフォルト値。min..max に丸める）
export function valueOf(parameter: Parameter, editor: EditorState): number {
  const raw = editor.editorParamValues[parameter.id] ?? parameter.default;
  return Math.min(parameter.max, Math.max(parameter.min, raw));
}

// 編集中のパラメータ（モデルにあるものだけ。最大2つ）
export function activeParameters(model: Model, editor: EditorState): Parameter[] {
  const out: Parameter[] = [];
  for (const id of editor.activeParameterIds) {
    const p = model.parameters.find((x) => x.id === id);
    if (p && !out.includes(p)) out.push(p);
  }
  return out.slice(0, MAX_BINDING_PARAMETERS);
}

// 編集中のパラメータの組と同じ組のバインディングに、現在値のキーがあるか。
// 既定値のキーは、その場で作って編集できるのでキーありとみなす（I-072）
export function hasKeyAtCurrentValue(model: Model, editor: EditorState): boolean {
  const params = activeParameters(model, editor);
  if (params.every((p) => near(valueOf(p, editor), p.default))) return true;
  const ids = params.map((p) => p.id);
  return model.bindings.some((binding) => {
    if (binding.parameterIds.length !== ids.length || !ids.every((id) => binding.parameterIds.includes(id))) {
      return false;
    }
    const coords = binding.parameterIds.map((id) =>
      valueOf(
        params.find((p) => p.id === id)!,
        editor,
      ),
    );
    return binding.keys.some((k) => k.coords.length === coords.length && k.coords.every((c, i) => near(c, coords[i]!)));
  });
}

// 補正キーの無い格子上の組み合わせは、単独のパラメータの合成で表示されている
export function isAutomaticCombination(model: Model, editor: EditorState): boolean {
  return !hasKeyAtCurrentValue(model, editor) && isCombinationGridPoint(model, activeParams(model, editor));
}
