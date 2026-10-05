// ユーザー定義パラメータ（カード34）の入力の確認と、追加・編集・削除のコマンド。どれも1回の Undo
import {
  PARAMETER_GROUPS,
  type Model,
  type Parameter,
  type ParameterGroup,
  type ParameterGroupId,
  type Project,
} from '@app/schema';
import type { Command } from '@app/contracts';

export type ParamFields = Pick<Parameter, 'name' | 'groupId' | 'min' | 'max' | 'default'>;

// 入力欄の値（数も文字のまま持つ）
export interface ParamForm {
  name: string;
  min: string;
  max: string;
  defaultValue: string;
  groupId: ParameterGroupId;
}

export const NEW_PARAM_FORM: ParamForm = { name: '', min: '0', max: '1', defaultValue: '0', groupId: 'other' };

export function userParameters(model: Model): Parameter[] {
  return model.parameters.filter((p) => !p.standard);
}

export function formOf(p: Parameter): ParamForm {
  return { name: p.name, min: String(p.min), max: String(p.max), defaultValue: String(p.default), groupId: p.groupId };
}

// そのパラメータを使うバインディングのキー位置の範囲（キーが無ければ null）
export function keyRange(model: Model, parameterId: string): { min: number; max: number } | null {
  let min = Infinity;
  let max = -Infinity;
  for (const b of model.bindings) {
    const axis = b.parameterIds.indexOf(parameterId);
    if (axis < 0) continue;
    for (const k of b.keys) {
      const v = k.coords[axis];
      if (v === undefined) continue;
      min = Math.min(min, v);
      max = Math.max(max, v);
    }
  }
  return min <= max ? { min, max } : null;
}

const toNumber = (text: string) => (text.trim() === '' ? NaN : Number(text.trim()));

export type FormCheck = { ok: true; fields: ParamFields } | { ok: false; message: string };

// 入力を確かめる。editingId は編集するパラメータ（追加なら null）
export function checkForm(model: Model, form: ParamForm, editingId: string | null): FormCheck {
  const fail = (message: string): FormCheck => ({ ok: false, message });
  const name = form.name.trim();
  if (name === '') return fail('名前を入れる');
  if (model.parameters.some((p) => p.id !== editingId && p.name === name)) return fail('同じ名前のパラメータがある');
  const min = toNumber(form.min);
  const max = toNumber(form.max);
  const defaultValue = toNumber(form.defaultValue);
  if (![min, max, defaultValue].every(Number.isFinite)) return fail('最小・最大・デフォルト値は数で入れる');
  if (!(min < max)) return fail('最大は最小より大きくする');
  if (defaultValue < min || defaultValue > max) return fail('デフォルト値は最小〜最大の間にする');

  const current = editingId ? model.parameters.find((p) => p.id === editingId) : undefined;
  const keys = current ? keyRange(model, current.id) : null;
  if (current && keys) {
    // キーはデフォルト値からの差分なので、デフォルト値は動かせない。範囲はキーのある値を含むこと
    if (defaultValue !== current.default) return fail('キーがあるので、デフォルト値は変えられない');
    if (min > keys.min || max < keys.max) return fail(`キーのある値（${keys.min}〜${keys.max}）が入る範囲にする`);
  }
  return { ok: true, fields: { name, groupId: form.groupId, min, max, default: defaultValue } };
}

// グループの一覧に無ければ足す（PARAMETER_GROUPS の名前で）
function withGroup(groups: ParameterGroup[], groupId: ParameterGroupId): ParameterGroup[] {
  if (groups.some((g) => g.id === groupId)) return groups;
  const def = PARAMETER_GROUPS.find((g) => g.id === groupId) ?? { id: groupId, name: groupId };
  return [...groups, { ...def }];
}

// id は呼ぶ側で newId() を渡す（apply を純粋にするため）
export function addParameterCommand(id: string, fields: ParamFields): Command {
  return {
    label: 'パラメータの追加',
    apply(project) {
      const { model } = project;
      if (model.parameters.some((p) => p.id === id)) return project;
      const parameter: Parameter = { id, ...fields, standard: false };
      return {
        ...project,
        model: {
          ...model,
          parameters: [...model.parameters, parameter],
          parameterGroups: withGroup(model.parameterGroups, fields.groupId),
        },
      };
    },
  };
}

// ユーザー定義パラメータの名前・グループ・範囲・デフォルト値を変える。標準パラメータは変えない
export function updateParameterCommand(id: string, fields: ParamFields): Command {
  return {
    label: 'パラメータの編集',
    apply(project) {
      const { model } = project;
      const index = model.parameters.findIndex((p) => p.id === id && !p.standard);
      const current = model.parameters[index];
      if (!current) return project;
      const next: Parameter = { ...current, ...fields };
      const same = (Object.keys(fields) as (keyof ParamFields)[]).every((k) => current[k] === next[k]);
      if (same) return project;
      const parameters = model.parameters.slice();
      parameters[index] = next;
      return {
        ...project,
        model: { ...model, parameters, parameterGroups: withGroup(model.parameterGroups, fields.groupId) },
      };
    },
  };
}

// そのパラメータを使っているもの（削除で一緒に消える数）
export interface ParameterUsage {
  bindings: number;
  trackingMappings: number;
  expressionEntries: number;
  hotkeys: number;
  animationTracks: number;
  physicsInputs: number;
}

export function parameterUsage(project: Project, id: string): ParameterUsage {
  const count = <T>(list: T[], used: (x: T) => boolean) => list.filter(used).length;
  return {
    bindings: count(project.model.bindings, (b) => b.parameterIds.includes(id)),
    trackingMappings: count(project.trackingMappings, (m) => m.parameterId === id),
    expressionEntries: project.expressions.reduce((n, e) => n + count(e.entries, (x) => x.parameterId === id), 0),
    hotkeys: count(project.studio.hotkeys, (h) => h.action === 'parameter' && h.targetId === id),
    animationTracks: project.animations.reduce((n, a) => n + count(a.tracks, (t) => t.parameterId === id), 0),
    physicsInputs: project.physics.reduce((n, ph) => n + count(ph.inputs, (x) => x.parameterId === id), 0),
  };
}

const USAGE_WORDS: [keyof ParameterUsage, string][] = [
  ['bindings', 'バインディング（キー）'],
  ['trackingMappings', 'トラッキングのマッピング'],
  ['expressionEntries', '表情の項目'],
  ['hotkeys', 'ホットキー'],
  ['animationTracks', 'アニメーションのトラック'],
  ['physicsInputs', '物理の入力'],
];

// 削除の確認の文
export function deleteMessage(parameter: Parameter, usage: ParameterUsage): string {
  const used = USAGE_WORDS.filter(([k]) => usage[k] > 0).map(([k, word]) => `${word} ${usage[k]} 個`);
  const head = `パラメータ「${parameter.name}」を削除しますか？`;
  return used.length > 0 ? `${head}使っている ${used.join('・')} も消えます。` : head;
}

// ユーザー定義パラメータと、それを使うバインディング・トラッキングのマッピング・表情の項目・ホットキー・
// アニメーションのトラック・物理の入力・母音の値を消す。標準パラメータは消さない
export function removeParameterCommand(id: string): Command {
  return {
    label: 'パラメータの削除',
    apply(project) {
      const { model } = project;
      if (!model.parameters.some((p) => p.id === id && !p.standard)) return project;
      const keep = <T extends { parameterId: string }>(list: T[]) => list.filter((x) => x.parameterId !== id);
      return {
        ...project,
        model: {
          ...model,
          parameters: model.parameters.filter((p) => p.id !== id),
          bindings: model.bindings.filter((b) => !b.parameterIds.includes(id)),
          lipSync: {
            ...model.lipSync,
            vowels: model.lipSync.vowels.map((v) => {
              if (!Object.hasOwn(v.values, id)) return v;
              const { [id]: _removed, ...values } = v.values;
              return { ...v, values };
            }),
          },
        },
        trackingMappings: keep(project.trackingMappings),
        trackingSetup: { ...project.trackingSetup, combine: keep(project.trackingSetup.combine) },
        expressions: project.expressions.map((e) =>
          e.entries.some((x) => x.parameterId === id) ? { ...e, entries: keep(e.entries) } : e,
        ),
        animations: project.animations.map((a) =>
          a.tracks.some((t) => t.parameterId === id) ? { ...a, tracks: keep(a.tracks) } : a,
        ),
        physics: project.physics.map((ph) =>
          ph.inputs.some((x) => x.parameterId === id) ? { ...ph, inputs: keep(ph.inputs) } : ph,
        ),
        studio: {
          ...project.studio,
          hotkeys: project.studio.hotkeys.filter((h) => !(h.action === 'parameter' && h.targetId === id)),
        },
      };
    },
  };
}
