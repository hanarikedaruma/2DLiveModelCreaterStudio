// テスト用の道具。プロジェクトの組み立てと、見た目の比較に使う参照の評価
// （評価のカード06 の規則を素直に書いたもの。本物の評価器はまだ無いので、ここで代わりに使う）
import {
  createEmptyProject,
  type Binding,
  type Model,
  type Part,
  type Project,
  type TransformDelta,
} from '@app/schema';
import type { EditorState } from '@app/contracts';
import { defaultEditorState } from '@app/core';

export function part(id: string, patch: Partial<Part> = {}): Part {
  return {
    id,
    name: id,
    kind: 'image',
    standardType: null,
    assetId: null,
    meshId: null,
    parentId: null,
    position: { x: 0, y: 0 },
    rotation: 0,
    scale: { x: 1, y: 1 },
    pivot: { x: 50, y: 50 },
    opacity: 1,
    blendMode: 'normal',
    depth: 0,
    mask: null,
    physicsId: null,
    visible: true,
    locked: false,
    ...patch,
  };
}

export function projectWith(patch: Partial<Model> = {}): Project {
  const project = createEmptyProject('テスト');
  return { ...project, model: { ...project.model, ...patch } };
}

export function editorAt(values: Record<string, number>, patch: Partial<EditorState> = {}): EditorState {
  return {
    ...defaultEditorState(),
    activeParameterIds: Object.keys(values),
    editorParamValues: values,
    ...patch,
  };
}

export const DETAIL: Partial<EditorState> = { uiLevel: { modeling: 'detail', animation: 'easy', studio: 'easy' } };

export function delta(patch: Partial<TransformDelta> = {}): TransformDelta {
  return { position: { x: 0, y: 0 }, rotation: 0, scale: { x: 1, y: 1 }, opacity: 1, ...patch };
}

// 入れ子のオブジェクトまで凍らせる（コマンドが入力を書き換えないことを確かめる）
export function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value)) deepFreeze(v);
  }
  return value;
}

// ---- 参照の評価 ----

type Num = number[]; // 差分を数の並びにしたもの（transform は [x, y, 回転, sx, sy, 不透明度]、点は [x0, y0, x1, y1, ...]）

function flatten(binding: Binding, d: Binding['keys'][number]['delta'], n: number): Num {
  if (binding.channel === 'transform') {
    const t = d as TransformDelta;
    return [t.position.x, t.position.y, t.rotation, t.scale.x, t.scale.y, t.opacity];
  }
  const points = d as { x: number; y: number }[];
  const out: Num = [];
  for (let i = 0; i < n; i++) out.push(points[i]?.x ?? 0, points[i]?.y ?? 0);
  return out;
}

function identity(binding: Binding, n: number): Num {
  return binding.channel === 'transform' ? [0, 0, 0, 1, 1, 1] : new Array<number>(n * 2).fill(0);
}

// 位置・回転・点は加算、拡縮・不透明度は乗算
function compose(binding: Binding, a: Num, b: Num): Num {
  const multiply = (i: number) => binding.channel === 'transform' && i >= 3;
  return a.map((v, i) => (multiply(i) ? v * b[i]! : v + b[i]!));
}

function mix(a: Num, b: Num, t: number): Num {
  return a.map((v, i) => v + (b[i]! - v) * t);
}

function bracket(values: number[], v: number): [number, number, number] {
  if (v <= values[0]!) return [0, 0, 0];
  const last = values.length - 1;
  if (v >= values[last]!) return [last, last, 0];
  let i = 0;
  while (values[i + 1]! < v) i++;
  return [i, i + 1, (v - values[i]!) / (values[i + 1]! - values[i]!)];
}

export function referenceBinding(model: Model, binding: Binding, values: Record<string, number>, n = 0): Num {
  const coords = binding.parameterIds.map((id) => {
    const p = model.parameters.find((x) => x.id === id)!;
    return Math.min(p.max, Math.max(p.min, values[id] ?? p.default));
  });
  const key = (c: number[]) =>
    binding.keys.find((k) => k.coords.length === c.length && k.coords.every((v, i) => Math.abs(v - c[i]!) < 1e-9));
  if (binding.parameterIds.length === 1) {
    const keys = [...binding.keys].sort((a, b) => a.coords[0]! - b.coords[0]!);
    if (keys.length === 0) return identity(binding, n);
    const [i, j, t] = bracket(
      keys.map((k) => k.coords[0]!),
      coords[0]!,
    );
    return mix(flatten(binding, keys[i]!.delta, n), flatten(binding, keys[j]!.delta, n), t);
  }
  const defaults = binding.parameterIds.map((id) => model.parameters.find((x) => x.id === id)!.default);
  const at = (x: number, y: number): Num => {
    const k = key([x, y]);
    if (k) return flatten(binding, k.delta, n);
    // 格子にキーが無いときは (x, y0) + (x0, y)
    const kx = key([x, defaults[1]!]);
    const ky = key([defaults[0]!, y]);
    return compose(
      binding,
      kx ? flatten(binding, kx.delta, n) : identity(binding, n),
      ky ? flatten(binding, ky.delta, n) : identity(binding, n),
    );
  };
  const xs = binding.keyValues[0]!;
  const ys = binding.keyValues[1]!;
  const [x0, x1, tx] = bracket(xs, coords[0]!);
  const [y0, y1, ty] = bracket(ys, coords[1]!);
  const low = mix(at(xs[x0]!, ys[y0]!), at(xs[x1]!, ys[y0]!), tx);
  const high = mix(at(xs[x0]!, ys[y1]!), at(xs[x1]!, ys[y1]!), tx);
  return mix(low, high, ty);
}

// 対象・チャンネルのすべてのバインディングを合成した差分
export function referenceTarget(
  model: Model,
  target: { type: Binding['target']['type']; id: string },
  values: Record<string, number>,
  n = 0,
): Num {
  let out: Num | null = null;
  for (const b of model.bindings) {
    if (b.target.type !== target.type || b.target.id !== target.id) continue;
    const d = referenceBinding(model, b, values, n);
    out = out ? compose(b, out, d) : d;
  }
  return out ?? (target.type === 'part' ? [0, 0, 0, 1, 1, 1] : new Array<number>(n * 2).fill(0));
}

// 値の組み合わせ（各パラメータの値の並びの直積）
export function samples(axes: Record<string, number[]>): Record<string, number>[] {
  let out: Record<string, number>[] = [{}];
  for (const [id, values] of Object.entries(axes)) {
    out = out.flatMap((o) => values.map((v) => ({ ...o, [id]: v })));
  }
  return out;
}

export function range(from: number, to: number, step: number): number[] {
  const out: number[] = [];
  for (let v = from; v <= to + 1e-9; v += step) out.push(Math.round(v * 1e6) / 1e6);
  return out;
}

// 2つの差分の並びが（誤差の範囲で）同じか
export function expectSameLook(before: Num[], after: Num[]): void {
  if (before.length !== after.length) throw new Error('サンプルの数が違う');
  before.forEach((b, i) => {
    const a = after[i]!;
    b.forEach((v, j) => {
      if (Math.abs(v - a[j]!) > 1e-9) throw new Error(`サンプル ${i} の成分 ${j} が違う: ${v} → ${a[j]}`);
    });
  });
}
