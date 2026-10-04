// アニメーション画面の表示の文言と並び（カード46）
import { PARAMETER_GROUPS, type Model, type Parameter, type ParameterGroup, type ParameterGroupId } from '@app/schema';
import type { KeyCurve } from './keyframes';
import type { TransitionPresetName } from './settings';

export const CURVE_CHOICES: readonly { id: KeyCurve; label: string }[] = [
  { id: 'linear', label: '線形' },
  { id: 'smooth', label: 'なめらか' },
  { id: 'step', label: '一定' },
];

export const PRESET_CHOICES: readonly { id: TransitionPresetName; label: string }[] = [
  { id: 'auto', label: '自動' },
  { id: 'quick', label: 'すばやく' },
  { id: 'natural', label: '自然' },
  { id: 'slow', label: 'ゆっくり' },
];

// モデルのグループの順に、パラメータをまとめる。グループの一覧に無いグループのパラメータは末尾にまとめる
export function parameterGroupsOf(model: Model): { group: ParameterGroup; parameters: Parameter[] }[] {
  const groups = [...model.parameterGroups];
  for (const p of model.parameters) {
    if (groups.some((g) => g.id === p.groupId)) continue;
    groups.push(PARAMETER_GROUPS.find((g) => g.id === p.groupId) ?? { id: p.groupId, name: p.groupId });
  }
  return groups
    .map((group) => ({ group, parameters: model.parameters.filter((p) => p.groupId === group.id) }))
    .filter((g) => g.parameters.length > 0);
}

// グループの表示名を「・」でつなぐ
export function groupNames(model: Model, ids: readonly ParameterGroupId[]): string {
  return ids
    .map(
      (id) =>
        model.parameterGroups.find((g) => g.id === id)?.name ?? PARAMETER_GROUPS.find((g) => g.id === id)?.name ?? id,
    )
    .join('・');
}

const tidy = (s: string) => (s === '-0' || /^-0\.0+$/.test(s) ? s.slice(1) : s);

const wide = (p: Pick<Parameter, 'min' | 'max'>) => Math.abs(p.max - p.min) >= 10;

// 幅が10以上のパラメータ（顔の角度など）は整数、ほかは小数2桁
export function formatValue(p: Pick<Parameter, 'min' | 'max'>, v: number): string {
  return tidy(wide(p) ? String(Math.round(v)) : v.toFixed(2));
}

// スライダーの刻み。表示に合わせて、幅が10以上なら 1、ほかは幅の 1/100
export function sliderStep(p: Pick<Parameter, 'min' | 'max'>): number {
  return wide(p) ? 1 : Math.abs(p.max - p.min) / 100;
}

// 秒（0.01 秒まで。末尾の 0 は付けない: 0・0.5・1.57）
export function formatTime(t: number): string {
  return tidy(String(Number(t.toFixed(2))));
}

// タイムラインの目盛りの間隔（秒）。長さに対して10本くらいまで
export function rulerStep(duration: number): number {
  for (const step of [0.1, 0.25, 0.5, 1, 2, 5, 10, 30, 60]) if (duration / step <= 10) return step;
  return 120;
}

// 再生中の時刻の表示（桁がずれないように小数2桁）
export function formatClock(t: number): string {
  return tidy(t.toFixed(2));
}
