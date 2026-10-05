// 不透明度のキー（I-026）。パーツ自身の不透明度 = Part.opacity + Σ（不透明度のバインディング（controlsOpacity）の
// いまの値 − デフォルト値での値）を 0..1 に収めたもの。評価（evaluator）と同じ規則を、1つのパーツについて求める。
// 編集の画面と KeyEditor が「いま見えている不透明度」と、キーに記録する値を求めるのに使う
import type { Binding, Model, Parameter } from '@app/schema';
import type { ParamValues } from '@app/contracts';
import { parameterValue } from './evaluator';
import { prepareBinding, preparedOpacityAt, sameCoord } from './prepare';

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

function parametersOf(model: Model, binding: Binding): Parameter[] | null {
  const out: Parameter[] = [];
  for (const id of binding.parameterIds) {
    const p = model.parameters.find((x) => x.id === id);
    if (!p) return null;
    out.push(p);
  }
  return out;
}

// 不透明度のバインディングの、params での不透明度とデフォルト値での不透明度。不透明度のバインディングでなければ null
export function bindingOpacity(
  model: Model,
  binding: Binding,
  params: ParamValues,
): { value: number; atDefault: number } | null {
  if (!binding.controlsOpacity || binding.channel !== 'transform') return null;
  const ps = parametersOf(model, binding);
  if (!ps || ps.length === 0 || ps.length > 2) return null;
  const prep = prepareBinding(
    binding,
    ps.map((p) => p.default),
  );
  if (!prep.ok || prep.kind !== 'transform' || prep.values.length === 0 || prep.opacityAtDefault === null) return null;
  const x = parameterValue(ps[0]!, params);
  const y = ps[1] ? parameterValue(ps[1], params) : 0;
  return { value: preparedOpacityAt(prep, x, y), atDefault: prep.opacityAtDefault };
}

// パーツ自身の不透明度（0..1 に収める前）。except のバインディングの分は足さない
export function rawPartOpacity(model: Model, partId: string, params: ParamValues, except?: string): number {
  const part = model.parts.find((p) => p.id === partId);
  if (!part) return 1;
  let value = part.opacity;
  for (const binding of model.bindings) {
    if (binding.id === except || binding.target.type !== 'part' || binding.target.id !== partId) continue;
    const o = bindingOpacity(model, binding, params);
    if (o) value += o.value - o.atDefault;
  }
  return value;
}

// パーツ自身の不透明度（0..1。親は掛けない）
export function partOpacity(model: Model, partId: string, params: ParamValues): number {
  return clamp01(rawPartOpacity(model, partId, params));
}

// Part.opacity を opacity（0..1 に収める）にし、そのパーツの不透明度のバインディングのデフォルト値のキーも同じ値にする
// （デフォルト値のキーは基準の不透明度と同じ、という約束を保つ）。変わらなければ同じ model
export function withPartOpacity(model: Model, partId: string, opacity: number): Model {
  const value = clamp01(opacity);
  let changed = false;
  const parts = model.parts.map((p) => {
    if (p.id !== partId || p.opacity === value) return p;
    changed = true;
    return { ...p, opacity: value };
  });
  const bindings = model.bindings.map((b) => {
    if (!b.controlsOpacity || b.target.type !== 'part' || b.target.id !== partId) return b;
    const ps = parametersOf(model, b);
    if (!ps) return b;
    let touched = false;
    const keys = b.keys.map((k) => {
      const atDefault = k.coords.length === ps.length && k.coords.every((c, i) => sameCoord(c, ps[i]!.default));
      if (!atDefault || Array.isArray(k.delta) || k.delta.opacity === value) return k;
      touched = true;
      return { ...k, delta: { ...k.delta, opacity: value } };
    });
    if (!touched) return b;
    changed = true;
    return { ...b, keys };
  });
  return changed ? { ...model, parts, bindings } : model;
}
