// [間を生成]・[奥行きで作り直す]・[すべて再補間]・生成方式・キーのロック。
// keyGenerator の結果をモデルに入れ、操作ごとに1つの transaction（1回の Undo）にする
import type { Binding, Model } from '@app/schema';
import type { Command, KeyGenerator, ProjectStore } from '@app/contracts';
import { modelCommand } from '@app/core';

export const DEPTH_PARAMETERS = ['FaceAngleX', 'FaceAngleY'] as const;
export type DepthParameterId = (typeof DEPTH_PARAMETERS)[number];

export function isDepthParameter(id: string): id is DepthParameterId {
  return (DEPTH_PARAMETERS as readonly string[]).includes(id);
}

// どれかのパラメータを使うバインディング
export function bindingsUsing(model: Model, parameterIds: string[]): Binding[] {
  return model.bindings.filter((b) => b.parameterIds.some((id) => parameterIds.includes(id)));
}

// 1つのバインディングを fn の結果に置き換える。バインディングが無いか、変わらなければ何もしない
export function bindingCommand(
  label: string,
  bindingId: string,
  fn: (binding: Binding, model: Model) => Binding,
): Command {
  return modelCommand(label, (model) => {
    const index = model.bindings.findIndex((b) => b.id === bindingId);
    const binding = model.bindings[index];
    if (!binding) return model;
    const next = fn(binding, model);
    if (next === binding) return model;
    const bindings = model.bindings.slice();
    bindings[index] = next;
    return { ...model, bindings };
  });
}

// 1つのバインディングに linear を掛ける。変わらなければ何もしない
export function linearCommand(generator: KeyGenerator, bindingId: string): Command {
  return bindingCommand('間を生成', bindingId, (binding) => generator.linear(binding));
}

// 中間生成は方式を変更しない。方式の変更は applyGeneration で明示的に行う。
function between(generator: KeyGenerator, binding: Binding, model: Model): Binding {
  if (binding.generation === 'linear') return generator.linear(binding);
  return generator.regenerate(binding, model);
}

// 作り直したバインディングを入れる（同じ id は置き換え、新しいものは末尾に足す）。何も変わらなければ同じモデル
export function mergeBindings(model: Model, rebuilt: Binding[]): Model {
  const byId = new Map(rebuilt.map((b) => [b.id, b]));
  let changed = false;
  const bindings = model.bindings.map((b) => {
    const next = byId.get(b.id);
    if (!next) return b;
    byId.delete(b.id);
    if (next !== b) changed = true;
    return next;
  });
  const added = [...byId.values()];
  if (!changed && added.length === 0) return model;
  return { ...model, bindings: [...bindings, ...added] };
}

export function depthCommand(generator: KeyGenerator, parameterId: DepthParameterId): Command {
  return modelCommand('奥行きで作り直す', (model) => mergeBindings(model, generator.depthParallax(model, parameterId)));
}

// パラメータを使う全バインディングに fn を掛け、1回の Undo にする。掛けたバインディングの数を返す
function eachBinding(
  store: ProjectStore,
  label: string,
  parameterIds: string[],
  fn: (binding: Binding, model: Model) => Binding,
): number {
  const ids = bindingsUsing(store.get().model, parameterIds).map((b) => b.id);
  if (ids.length === 0) return 0;
  store.transaction(label, (dispatch) => {
    for (const id of ids) dispatch(bindingCommand(label, id, fn));
  });
  return ids.length;
}

// 編集中のパラメータを使う全バインディングの間を生成する。掛けたバインディングの数を返す
export function generateBetween(store: ProjectStore, generator: KeyGenerator, parameterIds: string[]): number {
  return eachBinding(store, '間を生成', parameterIds, (b, m) => between(generator, b, m));
}

export function rebuildDepth(store: ProjectStore, generator: KeyGenerator, parameterIds: DepthParameterId[]): void {
  store.transaction('奥行きで作り直す', (dispatch) => {
    for (const id of parameterIds) dispatch(depthCommand(generator, id));
  });
}

// ---- 再補間（カード31） ----

// 編集中のパラメータを使う全バインディングを、それぞれの方式で作り直す（ロックしたキーは残る）。
// range があれば、その値の範囲（両端を含む）の中の中間キーだけ。掛けたバインディングの数を返す
export function regenerateKeys(
  store: ProjectStore,
  generator: KeyGenerator,
  parameterIds: string[],
  range?: [number, number],
): number {
  const label = range ? '選択範囲だけ再補間' : 'すべて再補間';
  return eachBinding(store, label, parameterIds, (b, m) => generator.regenerate(b, m, range));
}

// ---- 生成方式（カード31） ----

export type GenerationChoice = 'linear' | 'rotate' | 'surface' | 'ease';
export const GENERATION_CHOICES: { id: GenerationChoice; label: string; hint: string }[] = [
  { id: 'linear', label: '線形', hint: 'キーの間をまっすぐ補間する' },
  { id: 'rotate', label: '回転', hint: '頂点・制御点をピボットを中心とした円弧に沿って補間する' },
  { id: 'surface', label: '曲面', hint: '顔の向きのワープを球面に沿って作り直す（ロックしたキーは残る）' },
  { id: 'ease', label: 'なめらか', hint: 'キーの近くで変化がゆるやかになるように補間する' },
];

// 1パラメータのバインディングの方式。depth は線形として扱う。無ければ null、ばらばらなら 'mixed'
export function generationOf(model: Model, parameterIds: string[]): GenerationChoice | 'mixed' | null {
  const list = bindingsUsing(model, parameterIds)
    .filter((b) => b.parameterIds.length === 1)
    .map((b): GenerationChoice => (b.generation === 'depth' ? 'linear' : b.generation));
  const first = list[0];
  if (first === undefined) return null;
  return list.every((g) => g === first) ? first : 'mixed';
}

function generate(generator: KeyGenerator, choice: GenerationChoice, binding: Binding, model: Model): Binding {
  switch (choice) {
    case 'linear':
      return generator.linear(binding);
    case 'rotate':
      return generator.rotate(binding, model);
    case 'surface':
      return generator.surface(binding, model);
    case 'ease':
      return generator.ease(binding);
  }
}

// 編集中のパラメータを使う全バインディングを、選んだ方式で作り直す。変わったバインディングの数を返す
export function applyGeneration(
  store: ProjectStore,
  generator: KeyGenerator,
  parameterIds: string[],
  choice: GenerationChoice,
): number {
  const before = store.get().model.bindings;
  eachBinding(store, '生成方式を変える', parameterIds, (b, m) => generate(generator, choice, b, m));
  const after = store.get().model.bindings;
  return after.filter((b, i) => b !== before[i]).length;
}

// ---- キーのロック（カード31） ----

const NEAR = 1e-6;

const ordered = (range: [number, number]): [number, number] => (range[0] <= range[1] ? range : [range[1], range[0]]);

// パラメータを使うバインディングのうち、そのパラメータの値が range（両端を含む）の中のキーの locked を変える。
// 何も変わらなければ同じモデル
export function setKeysLocked(model: Model, parameterId: string, range: [number, number], locked: boolean): Model {
  const [lo, hi] = ordered(range);
  let changed = false;
  const bindings = model.bindings.map((b) => {
    const axis = b.parameterIds.indexOf(parameterId);
    if (axis < 0 || b.parameterIds.length !== 1) return b;
    let touched = false;
    const keys = b.keys.map((k) => {
      const v = k.coords[axis];
      if (v === undefined || v < lo - NEAR || v > hi + NEAR || k.locked === locked) return k;
      touched = true;
      return { ...k, locked };
    });
    if (!touched) return b;
    changed = true;
    return { ...b, keys };
  });
  return changed ? { ...model, bindings } : model;
}

// その値にロックされたキーがあるか（印が ■ になる）
export function isLockedAt(model: Model, parameterId: string, value: number): boolean {
  return model.bindings.some((b) => {
    const axis = b.parameterIds.indexOf(parameterId);
    return (
      b.parameterIds.length === 1 &&
      axis >= 0 &&
      b.keys.some((k) => k.locked && Math.abs((k.coords[axis] ?? Infinity) - value) <= NEAR)
    );
  });
}

// 範囲のキーをまとめてロック / ロック解除する（1回の Undo）
export function lockRange(store: ProjectStore, parameterId: string, range: [number, number], locked: boolean): void {
  const label = locked ? '選択範囲をロック' : '選択範囲のロックを解除';
  store.dispatch(modelCommand(label, (model) => setKeysLocked(model, parameterId, range, locked)));
}

// 印の右クリック。その値にロックされたキーがあればロックを解除し、無ければロックする
export function toggleLockAt(store: ProjectStore, parameterId: string, value: number): void {
  const locked = !isLockedAt(store.get().model, parameterId, value);
  const label = locked ? 'キーをロック' : 'キーのロックを解除';
  store.dispatch(modelCommand(label, (model) => setKeysLocked(model, parameterId, [value, value], locked)));
}
