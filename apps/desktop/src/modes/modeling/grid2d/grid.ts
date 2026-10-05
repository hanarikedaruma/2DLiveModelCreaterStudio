// 2パラメータの格子（方向グリッドと組み合わせの補正）の計算。マスの選び方、マスの状態、[自動に戻す] のコマンド。
// 補正は2パラメータのバインディング（KeyEditor が作る。軸のキーは差分 0）のキーで持つ。
// キーの無いマスは、各パラメータの1パラメータのバインディングの差分の和で動く（評価のカード06 の代用と同じ）
import type { Binding, Model, Parameter, ParameterKey, TransformDelta, Vec2 } from '@app/schema';
import type { Command, EditorState } from '@app/contracts';
import { modelCommand } from '@app/core';
import { valueOf } from '../parameters/marks';

// パラメータの値・キー位置を同じとみなす幅（KeyEditor と同じ）
const EPS = 1e-6;
export const near = (a: number, b: number): boolean => Math.abs(a - b) <= EPS;

// a は横（列）、b は縦（行）のパラメータ
export interface ParameterPair {
  a: string;
  b: string;
}
export interface GridCell {
  a: number;
  b: number;
}

// center = 両方デフォルト値（基準状態）、axis = 片方だけデフォルト値（1パラメータの編集）、combined = 組み合わせ（補正）
export type CellKind = 'center' | 'axis' | 'combined';
// auto = 補正のキーが無い（差分の和で動く）、corrected = 補正のキーがある
export type CellStatus = 'auto' | 'corrected';

// ---- 方向グリッド（FaceAngleX × FaceAngleY の 3×3） ----

export const DIRECTION_PAIR: ParameterPair = { a: 'FaceAngleX', b: 'FaceAngleY' };
export const DIRECTION_STEPS = [-30, 0, 30] as const;

// −30 / デフォルト値 / 30 を範囲に丸めたもの（昇順・重なりなし）
export function directionValues(parameter: Parameter): number[] {
  const clamp = (v: number) => Math.min(parameter.max, Math.max(parameter.min, v));
  return uniqueSorted([clamp(DIRECTION_STEPS[0]), parameter.default, clamp(DIRECTION_STEPS[2])]);
}

// ---- 組み合わせの補正の格子 ----

function uniqueSorted(values: number[]): number[] {
  const out: number[] = [];
  for (const v of [...values].sort((x, y) => x - y)) {
    if (out.length === 0 || !near(out[out.length - 1]!, v)) out.push(v);
  }
  return out;
}

// そのパラメータのキー位置（どのバインディングのものも）とデフォルト値。範囲の中だけ、昇順
export function keyPositions(model: Model, parameter: Parameter): number[] {
  const values = model.bindings.flatMap((binding) => {
    const axis = binding.parameterIds.indexOf(parameter.id);
    return axis < 0 ? [] : binding.keys.flatMap((key) => (key.coords[axis] === undefined ? [] : [key.coords[axis]!]));
  });
  return uniqueSorted([parameter.default, ...values]).filter(
    (v) => v >= parameter.min - EPS && v <= parameter.max + EPS,
  );
}

// 組のパラメータ（どちらかがモデルに無いか、同じなら null）
export function pairParameters(model: Model, pair: ParameterPair): [Parameter, Parameter] | null {
  if (pair.a === pair.b) return null;
  const pa = model.parameters.find((p) => p.id === pair.a);
  const pb = model.parameters.find((p) => p.id === pair.b);
  return pa && pb ? [pa, pb] : null;
}

// 編集中のパラメータが2つ（モデルにある別々のもの）ならその組
export function activePair(model: Model, editor: EditorState): ParameterPair | null {
  const [a, b] = editor.activeParameterIds;
  return a !== undefined && b !== undefined && pairParameters(model, { a, b }) ? { a, b } : null;
}

// 組を選んでいないときの組。顔の向き、それが無ければ先頭の2つ
export function defaultPair(model: Model): ParameterPair | null {
  if (pairParameters(model, DIRECTION_PAIR)) return DIRECTION_PAIR;
  const [p, q] = model.parameters;
  return p && q ? { a: p.id, b: q.id } : null;
}

// ---- マスの種類と選び方 ----

export function cellKind(pa: Parameter, pb: Parameter, cell: GridCell): CellKind {
  const aDefault = near(cell.a, pa.default);
  const bDefault = near(cell.b, pb.default);
  if (aDefault && bDefault) return 'center';
  return aDefault || bDefault ? 'axis' : 'combined';
}

// マスを押したときの EditorState の変更。組み合わせと中央は2パラメータ、上下左右は値の動く方だけの1パラメータ
export function cellPatch(
  pa: Parameter,
  pb: Parameter,
  cell: GridCell,
): Pick<EditorState, 'activeParameterIds' | 'editorParamValues'> {
  if (cellKind(pa, pb, cell) === 'axis') {
    const [p, v] = near(cell.a, pa.default) ? [pb, cell.b] : [pa, cell.a];
    return { activeParameterIds: [p.id], editorParamValues: { [p.id]: v } };
  }
  return { activeParameterIds: [pa.id, pb.id], editorParamValues: { [pa.id]: cell.a, [pb.id]: cell.b } };
}

const sameIds = (ids: string[], expected: string[]) =>
  ids.length === expected.length && expected.every((id) => ids.includes(id));

// そのマスがいまの編集中の状態か（押したときの状態と同じか）
export function isCurrentCell(pa: Parameter, pb: Parameter, cell: GridCell, editor: EditorState): boolean {
  const patch = cellPatch(pa, pb, cell);
  if (!sameIds(editor.activeParameterIds, patch.activeParameterIds)) return false;
  return near(valueOf(pa, editor), cell.a) && near(valueOf(pb, editor), cell.b);
}

// ---- 補正のキー ----

// その組の2パラメータのバインディング（parameterIds の順は問わない）
export function pairBindings(model: Model, pair: ParameterPair): Binding[] {
  return model.bindings.filter((b) => b.parameterIds.length === 2 && sameIds(b.parameterIds, [pair.a, pair.b]));
}

// バインディングの parameterIds の順に並べたマスの値
function coordsOf(binding: Binding, pair: ParameterPair, cell: GridCell): number[] {
  return binding.parameterIds.map((id) => (id === pair.a ? cell.a : cell.b));
}

const isAt = (key: ParameterKey, coords: number[]) =>
  key.coords.length === coords.length && key.coords.every((c, i) => near(c, coords[i]!));

// そのマスを手で直した補正キーの数。セットアップの自動補正は修正済みに数えない
export function correctionKeyCount(model: Model, pair: ParameterPair, cell: GridCell): number {
  let count = 0;
  for (const binding of pairBindings(model, pair)) {
    const coords = coordsOf(binding, pair, cell);
    count += binding.keys.filter((k) => k.source === 'manual' && isAt(k, coords)).length;
  }
  return count;
}

export function cellStatus(model: Model, pair: ParameterPair, cell: GridCell): CellStatus {
  return correctionKeyCount(model, pair, cell) > 0 ? 'corrected' : 'auto';
}

export function cellLockState(model: Model, pair: ParameterPair, cell: GridCell): { count: number; locked: boolean } {
  const keys = pairBindings(model, pair).flatMap((binding) =>
    binding.keys.filter((key) => isAt(key, coordsOf(binding, pair, cell))),
  );
  return { count: keys.length, locked: keys.some((key) => key.locked) };
}

export function lockCellCommand(pair: ParameterPair, cell: GridCell, locked: boolean): Command {
  return modelCommand(locked ? '補正キーをロック' : '補正キーのロックを解除', (model) => {
    const targets = new Set(pairBindings(model, pair));
    let changed = false;
    const bindings = model.bindings.map((binding) => {
      if (!targets.has(binding)) return binding;
      const coords = coordsOf(binding, pair, cell);
      let touched = false;
      const keys = binding.keys.map((key) => {
        if (!isAt(key, coords) || key.locked === locked) return key;
        changed = touched = true;
        return { ...key, locked };
      });
      return touched ? { ...binding, keys } : binding;
    });
    return changed ? { ...model, bindings } : model;
  });
}

const ZERO = 1e-9;

// opacity の「変化なし」は、不透明度のバインディングでは基準の不透明度、ほかは 1（I-026）
function isIdentityTransform(d: TransformDelta, opacity = 1): boolean {
  return (
    Math.abs(d.position.x) <= ZERO &&
    Math.abs(d.position.y) <= ZERO &&
    Math.abs(d.rotation) <= ZERO &&
    Math.abs(d.scale.x - 1) <= ZERO &&
    Math.abs(d.scale.y - 1) <= ZERO &&
    Math.abs(d.opacity - opacity) <= ZERO
  );
}

// 差分 0 のキー（transform は変化なし、頂点・制御点はすべて 0）。opacity は transform の不透明度の「変化なし」の値
export function isIdentityKey(key: ParameterKey, opacity = 1): boolean {
  if (Array.isArray(key.delta)) {
    return (key.delta as Vec2[]).every((p) => Math.abs(p.x) <= ZERO && Math.abs(p.y) <= ZERO);
  }
  return isIdentityTransform(key.delta, opacity);
}

// 残しておく意味のあるキーか（差分があるか、組み合わせのマスのキーで状態に出るもの）
function meaningful(model: Model, binding: Binding, key: ParameterKey): boolean {
  const base = binding.controlsOpacity ? (model.parts.find((p) => p.id === binding.target.id)?.opacity ?? 1) : 1;
  if (!isIdentityKey(key, base)) return true;
  return binding.parameterIds.every((id, i) => {
    const p = model.parameters.find((x) => x.id === id);
    return p !== undefined && !near(key.coords[i] ?? p.default, p.default);
  });
}

// そのマスの補正のキーを消す（ロックしたものも）。差分 0 の基準・軸のキーしか残らないバインディングは消す。
// keyValues は残す（ほかのマスの見た目を変えないため）。組み合わせのマスでないか、消すものが無ければモデルはそのまま
export function resetCell(model: Model, pair: ParameterPair, cell: GridCell): Model {
  const params = pairParameters(model, pair);
  if (!params || cellKind(params[0], params[1], cell) !== 'combined') return model;
  let changed = false;
  const bindings: Binding[] = [];
  for (const binding of model.bindings) {
    if (binding.parameterIds.length !== 2 || !sameIds(binding.parameterIds, [pair.a, pair.b])) {
      bindings.push(binding);
      continue;
    }
    const coords = coordsOf(binding, pair, cell);
    const keys = binding.keys.filter((k) => !isAt(k, coords));
    if (keys.length === binding.keys.length) {
      bindings.push(binding);
      continue;
    }
    changed = true;
    if (keys.some((k) => meaningful(model, binding, k))) bindings.push({ ...binding, keys });
  }
  return changed ? { ...model, bindings } : model;
}

export function resetCellCommand(pair: ParameterPair, cell: GridCell): Command {
  return modelCommand('自動に戻す', (model) => resetCell(model, pair, cell));
}
