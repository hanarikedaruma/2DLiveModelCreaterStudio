// アニメーションの登録の設定（カード46）。再生速度・ループ・影響範囲・遷移・再開始。
// どれも新しい Animation を返す（変わらなければ同じ参照）
import { PARAMETER_GROUP_IDS, type Animation, type Parameter, type ParameterGroupId } from '@app/schema';
import { presetOf } from '../../shell/api';

export type Transition = Animation['transition'];
export type TransitionPreset = Transition['preset'];
export type TransitionPresetName = Exclude<TransitionPreset, 'custom'>;
export type BlendValues = { blendIn: number; blendOut: number };

// 遷移のプリセット（秒）。自動と自然は同じ値
export const TRANSITION_PRESETS: Record<TransitionPresetName, BlendValues> = {
  auto: { blendIn: 0.35, blendOut: 0.4 },
  quick: { blendIn: 0.15, blendOut: 0.2 },
  natural: { blendIn: 0.35, blendOut: 0.4 },
  slow: { blendIn: 0.7, blendOut: 0.8 },
};

export const MIN_SPEED = 0.1;
export const MAX_SPEED = 10;
export const MAX_BLEND = 10; // 秒

export function createTransition(): Transition {
  return {
    preset: 'auto',
    ...TRANSITION_PRESETS.auto,
    curve: 'smooth',
    blendMode: 'override',
    keepLipSync: true,
    keepPhysics: true,
    returnToTracking: true,
  };
}

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

// 今の遷移がどのプリセットに当たるか。保存してある名前の値と一致すればその名前（自動と自然を区別する）、
// 違えば値の一致するプリセット、どれとも違えば 'custom'
export function currentTransitionPreset(transition: Transition): TransitionPreset {
  const values = { blendIn: transition.blendIn, blendOut: transition.blendOut };
  const named = transition.preset === 'custom' ? undefined : TRANSITION_PRESETS[transition.preset];
  if (named && presetOf(values, { [transition.preset]: named }) !== 'custom') return transition.preset;
  return presetOf(values, TRANSITION_PRESETS) as TransitionPreset;
}

function withTransition(animation: Animation, transition: Transition): Animation {
  const t = animation.transition;
  const same = (Object.keys(transition) as (keyof Transition)[]).every((k) => Object.is(t[k], transition[k]));
  return same ? animation : { ...animation, transition };
}

// プリセットを選ぶ（blendIn・blendOut をその値にする。ほかの項目はそのまま）
export function applyTransitionPreset(animation: Animation, preset: TransitionPresetName): Animation {
  return withTransition(animation, { ...animation.transition, preset, ...TRANSITION_PRESETS[preset] });
}

// 詳細で blendIn・blendOut を変える（0..MAX_BLEND 秒）。プリセットの名前は値から決め直す
export function setBlend(animation: Animation, patch: Partial<BlendValues>): Animation {
  const valid = (v: number | undefined): v is number => typeof v === 'number' && Number.isFinite(v);
  const t = animation.transition;
  const next: Transition = {
    ...t,
    blendIn: valid(patch.blendIn) ? clamp(patch.blendIn, 0, MAX_BLEND) : t.blendIn,
    blendOut: valid(patch.blendOut) ? clamp(patch.blendOut, 0, MAX_BLEND) : t.blendOut,
  };
  return withTransition(animation, { ...next, preset: currentTransitionPreset(next) });
}

export type TransitionOptions = Pick<
  Transition,
  'curve' | 'blendMode' | 'keepLipSync' | 'keepPhysics' | 'returnToTracking' | 'startFromCurrent'
>;

// カーブ・合成方法・リップシンクを維持・物理演算を維持・トラッキングに戻る
export function setTransitionOptions(animation: Animation, patch: Partial<TransitionOptions>): Animation {
  return withTransition(animation, { ...animation.transition, ...patch });
}

export function setSpeed(animation: Animation, speed: number): Animation {
  if (!Number.isFinite(speed)) return animation;
  const s = clamp(speed, MIN_SPEED, MAX_SPEED);
  return s === animation.speed ? animation : { ...animation, speed: s };
}

export function setLoop(animation: Animation, loop: boolean): Animation {
  return loop === animation.loop ? animation : { ...animation, loop };
}

export function setRestart(animation: Animation, restart: Animation['restart']): Animation {
  return restart === animation.restart ? animation : { ...animation, restart };
}

// グループの順（PARAMETER_GROUPS の順）にそろえ、重なりを除く
function normalizeGroups(groups: readonly ParameterGroupId[]): ParameterGroupId[] {
  return PARAMETER_GROUP_IDS.filter((id) => groups.includes(id));
}

// 影響範囲。空なら自動（トラックのあるグループ）
export function setAffectedGroups(animation: Animation, groups: readonly ParameterGroupId[]): Animation {
  const next = normalizeGroups(groups);
  const cur = animation.affectedGroups;
  if (next.length === cur.length && next.every((g, i) => g === cur[i])) return animation;
  return { ...animation, affectedGroups: next };
}

// 自動のときの影響範囲: キーフレームのあるトラックのパラメータのグループ（グループの順）
export function autoAffectedGroups(animation: Animation, parameters: readonly Parameter[]): ParameterGroupId[] {
  const groups = new Set<ParameterGroupId>();
  for (const track of animation.tracks) {
    if (track.keyframes.length === 0) continue;
    const p = parameters.find((x) => x.id === track.parameterId);
    if (p) groups.add(p.groupId);
  }
  return normalizeGroups([...groups]);
}

// 実際に影響するグループ（affectedGroups が空なら自動）
export function effectiveAffectedGroups(animation: Animation, parameters: readonly Parameter[]): ParameterGroupId[] {
  return animation.affectedGroups.length > 0
    ? normalizeGroups(animation.affectedGroups)
    : autoAffectedGroups(animation, parameters);
}
