import { describe, expect, it, vi } from 'vitest';
import { createEmptyProject } from '@app/schema';
import { createAnimation } from './commands';
import { advanceTime, createAnimationEditorStore, selectedAnimation, selectedKeyframe } from './state';

describe('アニメーション画面の表示の状態', () => {
  it('変わったときだけ知らせる。reset で最初に戻す', () => {
    const store = createAnimationEditorStore();
    const listener = vi.fn();
    store.subscribe(listener);
    store.set({ time: 0 });
    expect(listener).not.toHaveBeenCalled();
    store.set({ time: 1, playback: 'loop' });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.get()).toMatchObject({ time: 1, playback: 'loop' });
    store.reset();
    expect(store.get()).toEqual({ animationId: null, time: 0, playback: 'stopped', selectedKey: null });
  });

  it('選んでいるアニメーションが無くなったら一覧の先頭、空なら null', () => {
    const a = createAnimation('A', 'a');
    const b = createAnimation('B', 'b');
    const project = { ...createEmptyProject('テスト'), animations: [a, b] };
    const state = { animationId: 'b', time: 0, playback: 'stopped' as const, selectedKey: null };
    expect(selectedAnimation(project, state)).toBe(b);
    expect(selectedAnimation(project, { ...state, animationId: 'gone' })).toBe(a);
    expect(selectedAnimation({ ...project, animations: [] }, state)).toBeNull();
  });

  it('選んだキーフレームは、今のアニメーションにあるときだけ', () => {
    const a = {
      ...createAnimation('A', 'a'),
      tracks: [{ parameterId: 'FaceAngleX', keyframes: [{ time: 0.5, value: 1, curve: 'linear' as const }] }],
    };
    const state = { animationId: 'a', time: 0, playback: 'stopped' as const, selectedKey: null };
    expect(selectedKeyframe(a, { ...state, selectedKey: { parameterId: 'FaceAngleX', time: 0.5 } })).toEqual({
      parameterId: 'FaceAngleX',
      time: 0.5,
    });
    expect(selectedKeyframe(a, { ...state, selectedKey: { parameterId: 'FaceAngleX', time: 1 } })).toBeNull();
    expect(selectedKeyframe(null, { ...state, selectedKey: { parameterId: 'FaceAngleX', time: 0.5 } })).toBeNull();
  });

  it('再生: 時刻を進め、ループでなければ終わりで止まる。ループなら先頭から続ける', () => {
    expect(advanceTime(0.5, 0.25, 2, false)).toEqual({ time: 0.75, ended: false });
    expect(advanceTime(1.9, 0.25, 2, false)).toEqual({ time: 2, ended: true });
    const looped = advanceTime(1.9, 0.25, 2, true);
    expect(looped.ended).toBe(false);
    expect(looped.time).toBeCloseTo(0.15, 9);
    expect(advanceTime(0, 1, 0, true)).toEqual({ time: 0, ended: true });
  });
});
