import { describe, expect, it } from 'vitest';
import { STANDARD_PARAMETERS, type Animation } from '@app/schema';
import { createAnimation } from './commands';
import {
  applyTransitionPreset,
  autoAffectedGroups,
  currentTransitionPreset,
  effectiveAffectedGroups,
  setAffectedGroups,
  setBlend,
  setLoop,
  setRestart,
  setSpeed,
  setTransitionOptions,
  TRANSITION_PRESETS,
} from './settings';

const base = (): Animation => createAnimation('テスト', 'a1');

describe('遷移のプリセット', () => {
  it('auto と natural は 0.35・0.40、quick は 0.15・0.20、slow は 0.7・0.8（秒）', () => {
    expect(TRANSITION_PRESETS).toEqual({
      auto: { blendIn: 0.35, blendOut: 0.4 },
      quick: { blendIn: 0.15, blendOut: 0.2 },
      natural: { blendIn: 0.35, blendOut: 0.4 },
      slow: { blendIn: 0.7, blendOut: 0.8 },
    });
  });

  it('新しいアニメーションの既定は 自動・なめらか・上書き・どれも維持・トラッキングに戻る', () => {
    expect(base().transition).toEqual({
      preset: 'auto',
      blendIn: 0.35,
      blendOut: 0.4,
      curve: 'smooth',
      blendMode: 'override',
      keepLipSync: true,
      keepPhysics: true,
      returnToTracking: true,
    });
  });

  it('プリセットを選ぶと blendIn・blendOut がその値になり、ほかの項目はそのまま', () => {
    const a = setTransitionOptions(base(), { curve: 'linear', keepPhysics: false });
    const slow = applyTransitionPreset(a, 'slow');
    expect(slow.transition).toMatchObject({ preset: 'slow', blendIn: 0.7, blendOut: 0.8, curve: 'linear' });
    expect(slow.transition.keepPhysics).toBe(false);
    expect(applyTransitionPreset(slow, 'slow')).toBe(slow);
    // 自然は自動と同じ値でも、名前は自然として残る
    const natural = applyTransitionPreset(slow, 'natural');
    expect(natural.transition).toMatchObject({ preset: 'natural', blendIn: 0.35, blendOut: 0.4 });
    expect(currentTransitionPreset(natural.transition)).toBe('natural');
  });

  it('詳細で数値を変えると、どのプリセットとも違えば custom、一致すればその名前に戻る', () => {
    const custom = setBlend(base(), { blendIn: 0.5 });
    expect(custom.transition).toMatchObject({ preset: 'custom', blendIn: 0.5, blendOut: 0.4 });
    const quick = setBlend(setBlend(custom, { blendIn: 0.15 }), { blendOut: 0.2 });
    expect(quick.transition.preset).toBe('quick');
    // 範囲の外は端にし、数でないものは無視する
    expect(setBlend(base(), { blendIn: -1 }).transition.blendIn).toBe(0);
    const a = base();
    expect(setBlend(a, { blendOut: Number.NaN })).toBe(a);
  });

  it('保存してある名前の値と食い違っていれば、値から決め直す', () => {
    const t = { ...base().transition, preset: 'slow' as const };
    expect(currentTransitionPreset(t)).toBe('auto');
    expect(currentTransitionPreset({ ...t, blendIn: 0.9 })).toBe('custom');
  });

  it('カーブ・合成方法・リップシンク / 物理演算の維持・トラッキングに戻る', () => {
    const a = setTransitionOptions(base(), {
      curve: 'linear',
      blendMode: 'addToTracking',
      keepLipSync: false,
      keepPhysics: false,
      returnToTracking: false,
    });
    expect(a.transition).toMatchObject({
      preset: 'auto',
      curve: 'linear',
      blendMode: 'addToTracking',
      keepLipSync: false,
      keepPhysics: false,
      returnToTracking: false,
    });
    expect(setTransitionOptions(a, { curve: 'linear' })).toBe(a);
  });
});

describe('再生の設定', () => {
  it('再生速度は 0.1〜10 倍に収める。ループ・再開始', () => {
    expect(setSpeed(base(), 1.5).speed).toBe(1.5);
    expect(setSpeed(base(), 0).speed).toBe(0.1);
    expect(setSpeed(base(), 99).speed).toBe(10);
    const a = base();
    expect(setSpeed(a, 1)).toBe(a);
    expect(setSpeed(a, Number.NaN)).toBe(a);
    expect(setLoop(a, true).loop).toBe(true);
    expect(setLoop(a, false)).toBe(a);
    expect(setRestart(a, 'ignore').restart).toBe('ignore');
    expect(setRestart(a, 'restart')).toBe(a);
  });
});

describe('影響範囲', () => {
  const tracks: Animation['tracks'] = [
    { parameterId: 'MouthOpen', keyframes: [{ time: 0, value: 1, curve: 'linear' }] },
    { parameterId: 'FaceAngleX', keyframes: [{ time: 0, value: 10, curve: 'linear' }] },
    { parameterId: 'EyeOpenL', keyframes: [] },
    { parameterId: 'Unknown', keyframes: [{ time: 0, value: 1, curve: 'linear' }] },
  ];

  it('自動はキーフレームのあるトラックのグループ（グループの順）', () => {
    const a = { ...base(), tracks };
    expect(autoAffectedGroups(a, STANDARD_PARAMETERS)).toEqual(['face', 'mouth']);
    expect(effectiveAffectedGroups(a, STANDARD_PARAMETERS)).toEqual(['face', 'mouth']);
  });

  it('グループを選ぶと順にそろえて重なりを除く。選んだものが実際の影響範囲になり、空にすると自動', () => {
    const a = setAffectedGroups({ ...base(), tracks }, ['body', 'face', 'body']);
    expect(a.affectedGroups).toEqual(['face', 'body']);
    expect(effectiveAffectedGroups(a, STANDARD_PARAMETERS)).toEqual(['face', 'body']);
    expect(setAffectedGroups(a, ['face', 'body'])).toBe(a);
    expect(effectiveAffectedGroups(setAffectedGroups(a, []), STANDARD_PARAMETERS)).toEqual(['face', 'mouth']);
  });
});
