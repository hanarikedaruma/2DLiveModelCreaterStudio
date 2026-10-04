// 物理のかんたん設定（カード50）の種類ごとのプリセットと、選んだ値がどのプリセットに当たるかの判定
import type { Physics } from '@app/schema';
import { presetOf } from '../../../shell/api';

export type PhysicsKind = Physics['preset'];
export type PhysicsPresetValues = Pick<Physics, 'spring' | 'damping' | 'gravity' | 'inertia' | 'range'>;

// 種類ごとの値（カードの表のとおり）
export const PHYSICS_PRESETS: Record<PhysicsKind, PhysicsPresetValues> = {
  hair: { spring: 30, damping: 4, gravity: 0.5, inertia: 1.0, range: 1.0 },
  cloth: { spring: 20, damping: 3, gravity: 0.8, inertia: 0.8, range: 0.8 },
  ribbon: { spring: 15, damping: 2, gravity: 0.6, inertia: 1.2, range: 1.2 },
  accessory: { spring: 40, damping: 5, gravity: 1.0, inertia: 0.6, range: 0.6 },
};

export const PHYSICS_KINDS: readonly { id: PhysicsKind; label: string }[] = [
  { id: 'hair', label: '髪' },
  { id: 'cloth', label: '布' },
  { id: 'ribbon', label: 'リボン' },
  { id: 'accessory', label: 'アクセサリ' },
];

export const PHYSICS_DIRECTIONS: readonly { id: Physics['direction']; label: string }[] = [
  { id: 'horizontal', label: '左右' },
  { id: 'vertical', label: '上下' },
  { id: 'both', label: '左右と上下' },
];

// 詳細で数値を出す項目（入力欄の範囲。spring・damping・range が負だと揺れないので 0 から）
export const PHYSICS_FIELDS: readonly {
  key: keyof PhysicsPresetValues;
  label: string;
  hint: string;
  min: number;
  max: number;
  step: number;
}[] = [
  { key: 'spring', label: 'spring', hint: '元へ戻る強さ', min: 0, max: 500, step: 1 },
  { key: 'damping', label: 'damping', hint: '揺れが収まる速さ', min: 0, max: 100, step: 0.5 },
  { key: 'gravity', label: 'gravity', hint: '下へ垂れる強さ', min: -10, max: 10, step: 0.1 },
  { key: 'inertia', label: 'inertia', hint: '動きに遅れてついてくる強さ', min: 0, max: 10, step: 0.1 },
  { key: 'range', label: 'range', hint: '揺れの最大（ラジアン）', min: 0, max: 3, step: 0.1 },
];

// かんたん設定の「揺れ方」の初期値（控えめ 0 〜 大きめ 1 の真ん中）
export const DEFAULT_STRENGTH = 0.5;

export function presetValuesOf(item: PhysicsPresetValues): PhysicsPresetValues {
  return {
    spring: item.spring,
    damping: item.damping,
    gravity: item.gravity,
    inertia: item.inertia,
    range: item.range,
  };
}

// 今の値が当たるプリセット。自分の種類のプリセットに一致すればその種類、ほかの種類に一致すればその種類、
// どれとも違えば 'custom'（詳細で個別に調整した）
export function physicsPresetState(item: Physics): PhysicsKind | 'custom' {
  const values = presetValuesOf(item);
  if (presetOf(values, { [item.preset]: PHYSICS_PRESETS[item.preset] }) !== 'custom') return item.preset;
  return presetOf(values, PHYSICS_PRESETS) as PhysicsKind | 'custom';
}

// 種類を選ぶ（spring・damping・gravity・inertia・range をその種類の値にする。揺れ方・方向・入力はそのまま）
export function applyPhysicsPreset(item: Physics, kind: PhysicsKind): Physics {
  const next: Physics = { ...item, preset: kind, ...PHYSICS_PRESETS[kind] };
  return physicsEqual(item, next) ? item : next;
}

export function clampStrength(v: number): number {
  return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : DEFAULT_STRENGTH;
}

function physicsEqual(a: Physics, b: Physics): boolean {
  return (Object.keys(b) as (keyof Physics)[]).every((k) => Object.is(a[k], b[k]));
}
