// 不透明度のキー（カード34）。パラメータの編集中に、選んだパーツの「この値での不透明度」を読み書きする。
// 見せる値は 基準状態の不透明度（Part.opacity）× このキーの倍率（TransformDelta.opacity）。
// キーは keyEditor.transformEdit の opacityFactor で記録する。デフォルト値（基準状態）では Part.opacity を変える
import type { Binding, Model, ParameterKey, Part, Project } from '@app/schema';
import type { Command, EditorState, KeyEditor } from '@app/contracts';
import { patchPart } from '@app/core';
import { activeParameters, valueOf } from '../parameters/marks';

export const OPACITY_LABEL = '不透明度の変更';

// opacityFactor は掛け算なので、0 にするとキーでは上げられなくなる。
// 0 の代わりにこれを記録する（見た目は消える。表示は 0）
export const OPACITY_FLOOR = 0.001;

const NEAR = 1e-6;
const near = (a: number, b: number) => Math.abs(a - b) <= NEAR;
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

interface EditingParam {
  id: string;
  value: number;
  default: number;
}

// 編集中のパラメータ（モデルにあるものだけ。最大2つ。値は min..max に丸める）。KeyEditor と同じ選び方
function editingParams(model: Model, editor: EditorState): EditingParam[] {
  return activeParameters(model, editor).map((p) => ({ id: p.id, value: valueOf(p, editor), default: p.default }));
}

// 編集中でない、またはすべてデフォルト値（基準状態）
export function isBaseState(model: Model, editor: EditorState): boolean {
  return editingParams(model, editor).every((p) => near(p.value, p.default));
}

// そのパーツの transform のバインディング（編集中のパラメータの組と同じもの）と、現在値のキー
function findKey(model: Model, editor: EditorState, partId: string): { binding?: Binding; key?: ParameterKey } {
  const params = editingParams(model, editor);
  const ids = params.map((p) => p.id);
  const binding = model.bindings.find(
    (b) =>
      b.channel === 'transform' &&
      b.target.type === 'part' &&
      b.target.id === partId &&
      b.parameterIds.length === ids.length &&
      ids.every((id) => b.parameterIds.includes(id)),
  );
  if (!binding) return {};
  const coords = binding.parameterIds.map((id) => params.find((p) => p.id === id)?.value ?? 0);
  const key = binding.keys.find(
    (k) => k.coords.length === coords.length && k.coords.every((c, i) => near(c, coords[i]!)),
  );
  return { binding, key };
}

const multiplierOf = (key: ParameterKey): number => (Array.isArray(key.delta) ? 1 : key.delta.opacity);
const partOf = (model: Model, partId: string): Part | undefined => model.parts.find((p) => p.id === partId);

export interface OpacityAtValue {
  base: boolean; // デフォルト値（基準状態）
  value: number; // 見せる値（0..1）
  needsKey: boolean; // バインディングはあるが、この値にキーが無い（変えるとキーを足すか確かめる）
  blocked: 'baseZero' | 'keyZero' | null; // 0 からは倍率で上げられない
}

// いまの値での、そのパーツの不透明度。キーの無い値は、キーを足したときの値（前後のキーからの補間）を見せる
export function opacityAt(keyEditor: KeyEditor, project: Project, editor: EditorState, partId: string): OpacityAtValue {
  const model = project.model;
  const part = partOf(model, partId);
  const baseOpacity = part?.opacity ?? 1;
  if (isBaseState(model, editor)) return { base: true, value: clamp01(baseOpacity), needsKey: false, blocked: null };

  const found = findKey(model, editor, partId);
  let multiplier = 1;
  if (found.key) multiplier = multiplierOf(found.key);
  else if (found.binding) {
    const added = findKey(
      keyEditor.addKeyAtCurrentValue(project, editor, { partId }).apply(project).model,
      editor,
      partId,
    );
    if (added.key) multiplier = multiplierOf(added.key);
  }
  const blocked = baseOpacity <= 0 ? 'baseZero' : multiplier <= 0 ? 'keyZero' : null;
  return {
    base: false,
    value: clamp01(baseOpacity * multiplier),
    needsKey: found.binding !== undefined && found.key === undefined,
    blocked,
  };
}

function sequence(label: string, commands: Command[]): Command | null {
  if (commands.length === 0) return null;
  return { label, apply: (q) => commands.reduce((acc, c) => c.apply(acc), q) };
}

// 選んだパーツすべてを、いまの値で不透明度 target にするコマンド（1回の Undo）。
// キーはパーツごとに今の倍率からの opacityFactor で記録する。キーの無い値なら 'needsKey'。変わらなければ null
export function opacityCommand(
  keyEditor: KeyEditor,
  project: Project,
  editor: EditorState,
  partIds: string[],
  target: number,
): Command | 'needsKey' | null {
  const goal = Math.max(OPACITY_FLOOR, Math.min(1, target));
  const ids = [...new Set(partIds)].filter((id) => partOf(project.model, id));

  if (isBaseState(project.model, editor)) {
    // 基準状態は Part.opacity を直接変える（Transform の Opacity と同じ。0 からでも上げられる）
    const commands = ids
      .filter((id) => !near(partOf(project.model, id)!.opacity, goal))
      .map((id) => patchPart(OPACITY_LABEL, id, { opacity: goal }));
    return sequence(OPACITY_LABEL, commands);
  }

  let p = project;
  const commands: Command[] = [];
  for (const id of ids) {
    const { binding, key } = findKey(p.model, editor, id);
    if (binding && !key) return 'needsKey';
    const baseOpacity = partOf(p.model, id)!.opacity;
    const multiplier = key ? multiplierOf(key) : 1;
    if (baseOpacity <= 0 || multiplier <= 0) continue; // 0 からは倍率で上げられない
    const factor = goal / baseOpacity / multiplier;
    if (near(factor, 1)) continue;
    const command = keyEditor.transformEdit(p, editor, [id], { opacityFactor: factor });
    if (command === 'needsKey') return 'needsKey';
    commands.push(command);
    p = command.apply(p);
  }
  return sequence(OPACITY_LABEL, commands);
}

// 選んだパーツすべてに、いまの値のキーを足す（見た目は変わらない）
export function addKeysCommand(
  keyEditor: KeyEditor,
  project: Project,
  editor: EditorState,
  partIds: string[],
): Command {
  let p = project;
  const commands: Command[] = [];
  for (const partId of partIds) {
    const add = keyEditor.addKeyAtCurrentValue(p, editor, { partId });
    commands.push(add);
    p = add.apply(p);
  }
  return sequence('キーの追加', commands) ?? { label: 'キーの追加', apply: (q) => q };
}
