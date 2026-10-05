// KeyEditor の共通部分。編集中のパラメータの解決、バインディングとキーの検索・作成、1つのバインディングの補間
import type { Binding, Channel, Model, ParameterKey, TransformDelta, Vec2 } from '@app/schema';
import type { EditorState } from '@app/contracts';

// パラメータの値・キー位置を同じとみなす幅
export const EPS = 1e-6;
export const near = (a: number, b: number): boolean => Math.abs(a - b) <= EPS;

export type Delta = TransformDelta | Vec2[];

// 差分の扱い方（transform と頂点・制御点で違う）
export interface DeltaOps<D extends Delta> {
  identity(): D;
  read(delta: ParameterKey['delta']): D; // キーの差分をこの形にそろえる
  lerp(a: D, b: D, t: number): D;
  combine(a: D, b: D): D; // 2つの差分を重ねる（位置・回転・点は加算、拡縮・不透明度は乗算）
  same(a: D, b: D): boolean;
}

// ---- 編集中のパラメータ ----

export interface ActiveParam {
  id: string;
  value: number; // min..max に丸めた現在値
  default: number;
}

// 編集中のパラメータと現在値。モデルに無い id と重複は除き、最大2つ
export function activeParams(model: Model, editor: EditorState): ActiveParam[] {
  const out: ActiveParam[] = [];
  for (const id of editor.activeParameterIds) {
    const p = model.parameters.find((x) => x.id === id);
    if (!p || out.some((a) => a.id === id)) continue;
    const raw = editor.editorParamValues[id] ?? p.default;
    out.push({ id, value: Math.min(p.max, Math.max(p.min, raw)), default: p.default });
    if (out.length === 2) break;
  }
  return out;
}

// 編集中のパラメータが無いか、すべてデフォルト値なら基準状態を編集する（デフォルト値のキーは差分 0 のまま）
export function isBaseState(params: ActiveParam[]): boolean {
  return params.every((p) => near(p.value, p.default));
}

// プレビュー中のパラメータ: キーを編集していない（編集中でない）のに、値がデフォルト値でないもの（I-028）。
// 表情づくりや母音・揺れの確かめ、パラメータパネルのプレビューで残る。値は min..max に丸め、モデルに無いものと
// 数でないものは数えない
export function previewParameters(model: Model, editor: EditorState): Model['parameters'] {
  const editing = new Set(activeParams(model, editor).map((p) => p.id));
  return model.parameters.filter((p) => {
    if (editing.has(p.id)) return false;
    const raw = editor.editorParamValues[p.id];
    if (raw === undefined || !Number.isFinite(raw)) return false;
    return !near(Math.min(p.max, Math.max(p.min, raw)), p.default);
  });
}

// プレビュー中のパラメータがある。このまま基準状態やキーを変えると、見えている形と違うものを編集してしまう
// （I-029・I-046。I-028 で、編集中のパラメータがあるときも、ほかの値がデフォルト値でなければ同じにした）
export function isPreviewOffBase(model: Model, editor: EditorState): boolean {
  return previewParameters(model, editor).length > 0;
}

// 各軸の既存のキー位置を組み合わせたマス。1軸の編集や格子の間では自動でキーを追加しない
export function isCombinationGridPoint(model: Model, params: ActiveParam[]): boolean {
  return (
    params.length === 2 &&
    params.every(
      (p) =>
        !near(p.value, p.default) &&
        model.bindings.some((b) => {
          const axis = b.parameterIds.indexOf(p.id);
          return axis >= 0 && b.keys.some((k) => k.coords[axis] !== undefined && near(k.coords[axis]!, p.value));
        }),
    )
  );
}

export function isEasy(editor: EditorState): boolean {
  return editor.uiLevel.modeling === 'easy';
}

// ---- バインディングとキー ----

export interface BindingTarget {
  type: Binding['target']['type'];
  id: string;
  channel: Channel;
}

function sameParameterSet(binding: Binding, ids: string[]): boolean {
  return binding.parameterIds.length === ids.length && ids.every((id) => binding.parameterIds.includes(id));
}

// 同じ対象・チャンネル・パラメータの組（順は問わない）のバインディング
export function findBinding(model: Model, target: BindingTarget, params: ActiveParam[]): Binding | undefined {
  const ids = params.map((p) => p.id);
  return model.bindings.find(
    (b) =>
      b.channel === target.channel &&
      b.target.type === target.type &&
      b.target.id === target.id &&
      sameParameterSet(b, ids),
  );
}

// バインディングの parameterIds の順に並べた現在値（またはデフォルト値）
export function coordsOf(binding: Binding, params: ActiveParam[], which: 'value' | 'default'): number[] {
  return binding.parameterIds.map((id) => params.find((p) => p.id === id)?.[which] ?? 0);
}

export function keyIndexAt(binding: Binding, coords: number[]): number {
  return binding.keys.findIndex(
    (k) => k.coords.length === coords.length && k.coords.every((c, i) => near(c, coords[i]!)),
  );
}

function keyAt(binding: Binding, coords: number[]): ParameterKey | undefined {
  return binding.keys[keyIndexAt(binding, coords)];
}

// 昇順を保って値を足す。すでにあれば同じ配列
export function withKeyValue(values: number[], value: number): number[] {
  if (values.some((v) => near(v, value))) return values;
  return [...values, value].sort((a, b) => a - b);
}

function withKeyValues(keyValues: number[][], coords: number[]): number[][] {
  const next = keyValues.map((values, i) => {
    const c = coords[i];
    return c === undefined ? values : withKeyValue(values, c);
  });
  return next.every((v, i) => v === keyValues[i]) ? keyValues : next;
}

function compareCoords(a: ParameterKey, b: ParameterKey): number {
  for (let i = 0; i < a.coords.length; i++) {
    const d = (a.coords[i] ?? 0) - (b.coords[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

export function replaceBinding(model: Model, binding: Binding): Model {
  return { ...model, bindings: model.bindings.map((b) => (b.id === binding.id ? binding : b)) };
}

// 新しいバインディング（keyValues は [デフォルト値, 現在値] の昇順。デフォルト値のキーは差分 0）
function createBinding<D extends Delta>(
  id: string,
  target: BindingTarget,
  params: ActiveParam[],
  ops: DeltaOps<D>,
  current: ParameterKey,
): Binding {
  return {
    id,
    target: { type: target.type, id: target.id },
    channel: target.channel,
    parameterIds: params.map((p) => p.id),
    keyValues: params.map((p) => withKeyValue([p.default], p.value)),
    keys: [{ coords: params.map((p) => p.default), delta: ops.identity(), source: 'auto', locked: false }, current],
    generation: 'linear',
    divisions: null,
  };
}

export interface KeySpec<D extends Delta> {
  target: BindingTarget;
  params: ActiveParam[]; // 基準状態でないこと
  easy: boolean;
  newBindingId: string; // バインディングを作るときの id（apply を純粋にするため先に決めておく）
  ops: DeltaOps<D>;
  // バインディングごとに差分の扱い方を変えるとき（不透明度のバインディング。I-026）。無ければ ops。
  // binding は見つかったバインディング（作るときは undefined）
  opsFor?: (binding: Binding | undefined) => DeltaOps<D>;
}

const opsOf = <D extends Delta>(spec: KeySpec<D>, binding: Binding | undefined): DeltaOps<D> =>
  spec.opsFor ? spec.opsFor(binding) : spec.ops;

// 現在値のキーの差分を edit で変える。格子上の組み合わせは補間したキーをその場で足す
export function editKey<D extends Delta>(model: Model, spec: KeySpec<D>, edit: (d: D) => D): Model | 'needsKey' {
  const { target, params, easy } = spec;
  const binding = findBinding(model, target, params);
  const ops = opsOf(spec, binding);
  if (!binding) {
    const current: ParameterKey = {
      coords: params.map((p) => p.value),
      delta: edit(ops.identity()),
      source: 'manual',
      locked: easy,
    };
    return { ...model, bindings: [...model.bindings, createBinding(spec.newBindingId, target, params, ops, current)] };
  }
  const coords = coordsOf(binding, params, 'value');
  const index = keyIndexAt(binding, coords);
  const key = binding.keys[index];
  if (!key) {
    if (!isCombinationGridPoint(model, params)) return 'needsKey';
    // addKey は格子の線が増えたときの補助キーも作るので、ほかのマスの見た目を保てる
    return editKey(addKey(model, spec), spec, edit);
  }
  const keys = binding.keys.slice();
  keys[index] = { ...key, delta: edit(ops.read(key.delta)), source: 'manual', locked: easy || key.locked };
  return replaceBinding(model, { ...binding, keyValues: withKeyValues(binding.keyValues, coords), keys });
}

// 現在値にキーを足す。差分は前後のキーから補間するので見た目は変わらない。すでにあれば何もしない
export function addKey<D extends Delta>(model: Model, spec: KeySpec<D>): Model {
  const { target, params, easy } = spec;
  const binding = findBinding(model, target, params);
  const ops = opsOf(spec, binding);
  if (!binding) {
    // バインディングが無い = 差分 0 なので、差分 0 のキーで作る
    const current: ParameterKey = {
      coords: params.map((p) => p.value),
      delta: ops.identity(),
      source: 'manual',
      locked: easy,
    };
    return { ...model, bindings: [...model.bindings, createBinding(spec.newBindingId, target, params, ops, current)] };
  }
  const coords = coordsOf(binding, params, 'value');
  if (keyIndexAt(binding, coords) >= 0) return model;
  const defaults = coordsOf(binding, params, 'default');

  const keyValues = withKeyValues(binding.keyValues, coords);
  const added: ParameterKey[] = [
    { coords, delta: sampleBinding(binding, coords, defaults, ops), source: 'manual', locked: easy },
  ];
  if (binding.parameterIds.length === 2) {
    added.push(...supportKeys(binding, keyValues, coords, defaults, added, ops));
  }
  const keys = [...binding.keys, ...added].sort(compareCoords);
  return replaceBinding(model, { ...binding, keyValues, keys });
}

// 2パラメータで格子の線が増えたとき、増えた格子の点のうち、代用（各軸の差分の和）では元の補間と
// 値が変わる点にもキーを足す（source 'auto'）。こうすると格子全体で見た目が変わらない
function supportKeys<D extends Delta>(
  old: Binding,
  keyValues: number[][],
  current: number[],
  defaults: number[],
  added: ParameterKey[],
  ops: DeltaOps<D>,
): ParameterKey[] {
  const [oldXs = [], oldYs = []] = old.keyValues;
  const [xs = [], ys = []] = keyValues;
  const onOldGrid = (x: number, y: number) => oldXs.some((v) => near(v, x)) && oldYs.some((v) => near(v, y));
  const points: number[][] = [];
  for (const x of xs) for (const y of ys) if (!onOldGrid(x, y)) points.push([x, y]);
  // 代用はデフォルト値の軸の上の点を使うので、軸の上の点を先に決める
  const onAxis = (p: number[]) => near(p[0]!, defaults[0]!) || near(p[1]!, defaults[1]!);
  points.sort((a, b) => Number(onAxis(b)) - Number(onAxis(a)));

  const out: ParameterKey[] = [];
  for (const p of points) {
    if (near(p[0]!, current[0]!) && near(p[1]!, current[1]!)) continue;
    const working: Binding = { ...old, keyValues, keys: [...old.keys, ...added, ...out] };
    if (keyAt(working, p)) continue;
    const before = sampleBinding(old, p, defaults, ops);
    const substitute = gridValue(working, p[0]!, p[1]!, defaults, ops);
    if (!ops.same(before, substitute)) out.push({ coords: p, delta: before, source: 'auto', locked: false });
  }
  return out;
}

// ---- 1つのバインディングの補間（評価のカード06 と同じ規則） ----

interface Cell {
  i0: number;
  i1: number;
  t: number;
}

// 昇順の値の中で v をはさむ2つ（範囲外は端）
function cellOf(values: number[], v: number): Cell {
  const last = values.length - 1;
  if (last <= 0 || v <= values[0]!) return { i0: 0, i1: 0, t: 0 };
  if (v >= values[last]!) return { i0: last, i1: last, t: 0 };
  for (let i = 0; i < last; i++) {
    const a = values[i]!;
    const b = values[i + 1]!;
    if (v >= a && v <= b) return { i0: i, i1: i + 1, t: b > a ? (v - a) / (b - a) : 0 };
  }
  return { i0: last, i1: last, t: 0 };
}

// 格子の点の差分。キーが無ければ (x, y0) と (x0, y) の差分を重ねて代用する（どちらも無ければ 0）
function gridValue<D extends Delta>(binding: Binding, x: number, y: number, defaults: number[], ops: DeltaOps<D>): D {
  const key = keyAt(binding, [x, y]);
  if (key) return ops.read(key.delta);
  const ax = keyAt(binding, [x, defaults[1]!]);
  const ay = keyAt(binding, [defaults[0]!, y]);
  return ops.combine(ax ? ops.read(ax.delta) : ops.identity(), ay ? ops.read(ay.delta) : ops.identity());
}

// バインディング1つの coords での差分。1パラメータはキーの間の線形補間、2パラメータは格子の双線形補間
export function sampleBinding<D extends Delta>(
  binding: Binding,
  coords: number[],
  defaults: number[],
  ops: DeltaOps<D>,
): D {
  if (binding.parameterIds.length === 1) {
    const keys = binding.keys.filter((k) => k.coords.length === 1).sort(compareCoords);
    if (keys.length === 0) return ops.identity();
    const values = keys.map((k) => k.coords[0]!);
    const { i0, i1, t } = cellOf(values, coords[0] ?? 0);
    return ops.lerp(ops.read(keys[i0]!.delta), ops.read(keys[i1]!.delta), t);
  }
  const [xs = [], ys = []] = binding.keyValues;
  if (xs.length === 0 || ys.length === 0) return ops.identity();
  const cx = cellOf(xs, coords[0] ?? 0);
  const cy = cellOf(ys, coords[1] ?? 0);
  const at = (i: number, j: number) => gridValue(binding, xs[i]!, ys[j]!, defaults, ops);
  const low = ops.lerp(at(cx.i0, cy.i0), at(cx.i1, cy.i0), cx.t);
  const high = ops.lerp(at(cx.i0, cy.i1), at(cx.i1, cy.i1), cx.t);
  return ops.lerp(low, high, cy.t);
}
