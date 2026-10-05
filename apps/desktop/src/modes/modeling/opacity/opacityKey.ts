// 不透明度のキー（カード34・I-026）。パラメータの編集中に、選んだパーツの「いまの値での不透明度」を読み書きする。
// キーの不透明度は、その姿勢でのパーツ自身の不透明度（絶対値。親は掛けない）。見せる値は、不透明度のキーと
// 基準の不透明度（Part.opacity）から求めた、いま見えているパーツ自身の不透明度。書くのは keyEditor.transformEdit の
// opacity（デフォルト値では基準の不透明度、ほかの値ではそのパラメータの組のキー。0 からでも上げられる）
import type { Binding, Model, Project } from '@app/schema';
import type { Command, EditorState, KeyEditor } from '@app/contracts';
import { partOpacity } from '@app/core';
import { activeParameters, valueOf } from '../parameters/marks';

export const OPACITY_LABEL = '不透明度の変更';

const NEAR = 1e-6;
const near = (a: number, b: number) => Math.abs(a - b) <= NEAR;

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

// そのパーツの transform のバインディング（編集中のパラメータの組と同じもの）と、いまの値にキーがあるか
function findKey(model: Model, editor: EditorState, partId: string): { binding?: Binding; hasKey: boolean } {
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
  if (!binding) return { hasKey: false };
  const coords = binding.parameterIds.map((id) => params.find((p) => p.id === id)?.value ?? 0);
  const hasKey = binding.keys.some(
    (k) => k.coords.length === coords.length && k.coords.every((c, i) => near(c, coords[i]!)),
  );
  return { binding, hasKey };
}

export interface OpacityAtValue {
  base: boolean; // 基準の不透明度（Part.opacity）を変える（デフォルト値）
  value: number; // 見せる値（0..1）。いまの値でのパーツ自身の不透明度
  needsKey: boolean; // バインディングはあるが、この値にキーが無い（変えるとキーを足すか確かめる）
  others: boolean; // ほかのパラメータの不透明度のキーも、いまの見え方に効いている
}

// いまの値での、そのパーツ自身の不透明度
export function opacityAt(project: Project, editor: EditorState, partId: string): OpacityAtValue {
  const model = project.model;
  const base = isBaseState(model, editor);
  const found = findKey(model, editor, partId);
  const others = model.bindings.some(
    (b) => b.controlsOpacity === true && b.target.id === partId && b !== found.binding,
  );
  return {
    base,
    value: partOpacity(model, partId, editor.editorParamValues),
    needsKey: !base && found.binding !== undefined && !found.hasKey,
    others,
  };
}

// 選んだパーツすべてを、いまの値で不透明度 target にするコマンド（1回の Undo）。キーの無い値なら 'needsKey'。
// 変わらなければ null
export function opacityCommand(
  keyEditor: KeyEditor,
  project: Project,
  editor: EditorState,
  partIds: string[],
  target: number,
): Command | 'needsKey' | null {
  const goal = Math.max(0, Math.min(1, target));
  const ids = [...new Set(partIds)].filter((id) => project.model.parts.some((p) => p.id === id));
  let p = project;
  const commands: Command[] = [];
  for (const id of ids) {
    if (near(partOpacity(p.model, id, editor.editorParamValues), goal)) continue;
    const command = keyEditor.transformEdit(p, editor, [id], { opacity: goal });
    if (command === 'needsKey') return 'needsKey';
    commands.push(command);
    p = command.apply(p);
  }
  return sequence(OPACITY_LABEL, commands);
}

function sequence(label: string, commands: Command[]): Command | null {
  if (commands.length === 0) return null;
  return { label, apply: (q) => commands.reduce((acc, c) => c.apply(acc), q) };
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
