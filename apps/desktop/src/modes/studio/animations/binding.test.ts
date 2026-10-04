import { describe, expect, it, vi } from 'vitest';
import { createEmptyProject, ensureStandardParameters, type Animation, type Project } from '@app/schema';
import { FakeAnimationPlayer, type FrameContext, type LayerProducer, type Services } from '@app/contracts';
import { createAnimationPlayer, createParameterMixer } from '@app/core';
import { createFakeServices } from '../../../services';
import { createStudioRuntime } from '../runtime';
import { createAnimationBinding, isHotkeyAnimationEvent } from './binding';

function animation(
  id: string,
  patch: Partial<Omit<Animation, 'transition'>> & { transition?: Partial<Animation['transition']> } = {},
): Animation {
  const { transition, ...rest } = patch;
  return {
    id,
    name: id,
    duration: 1,
    speed: 1,
    loop: false,
    periodic: false,
    tracks: [{ parameterId: 'FaceAngleX', keyframes: [{ time: 0, value: 0, curve: 'linear' }] }],
    affectedGroups: [],
    restart: 'restart',
    ...rest,
    transition: {
      preset: 'custom',
      blendIn: 0.4,
      blendOut: 0.4,
      curve: 'smooth',
      blendMode: 'override',
      keepLipSync: false,
      keepPhysics: false,
      returnToTracking: true,
      ...transition,
    },
  };
}

function step2Project(animations: Animation[]): Project {
  const p = createEmptyProject('テスト');
  return { ...p, model: ensureStandardParameters(p.model, 'step2'), animations };
}

function ctx(project: Project, now = 0): FrameContext {
  return { now, dt: 16, project, mixedSoFar: {}, flags: { lipSyncWeight: 1, physicsActive: true } };
}

describe('createAnimationBinding', () => {
  it('つないでいなければ何も出さず、押してもホットキーでも何もしない', () => {
    const binding = createAnimationBinding();
    expect(binding.producer.id).toBe('animation');
    expect(binding.producer.produce(ctx(step2Project([])))).toBeNull();
    binding.toggle('wave', 0);
    binding.hotkey({ targetId: 'wave', phase: 'down', mode: 'hold' }, 0);
    expect(binding.playing()).toEqual([]);
    expect(binding.bound()).toBeNull();
  });

  it('押すと再生し、もう一度押すとやめる。変わるたびに知らせる（仮実装でも動く）', () => {
    const binding = createAnimationBinding();
    const player = new FakeAnimationPlayer();
    const play = vi.spyOn(player, 'play');
    const stop = vi.spyOn(player, 'stop');
    binding.bind(player);
    const listener = vi.fn();
    binding.subscribe(listener);

    binding.toggle('wave', 100);
    expect(play).toHaveBeenLastCalledWith('wave', 100);
    expect(binding.playing()).toEqual(['wave']);
    expect(listener).toHaveBeenCalledTimes(1);
    const snapshot = binding.playing();
    binding.producer.produce(ctx(step2Project([])));
    expect(binding.playing()).toBe(snapshot); // 変わらなければ同じ配列
    expect(listener).toHaveBeenCalledTimes(1);

    binding.toggle('wave', 200);
    expect(stop).toHaveBeenLastCalledWith('wave', 200);
    expect(binding.playing()).toEqual([]);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('ホットキー: toggle は押すたびに再生 / やめる（離したのは無視）、hold は押したら再生・離したらやめる', () => {
    const binding = createAnimationBinding();
    const player = new FakeAnimationPlayer();
    const play = vi.spyOn(player, 'play');
    const stop = vi.spyOn(player, 'stop');
    binding.bind(player);

    binding.hotkey({ targetId: 'wave', phase: 'down', mode: 'toggle' }, 10);
    expect(play).toHaveBeenLastCalledWith('wave', 10);
    expect(binding.playing()).toEqual(['wave']);
    binding.hotkey({ targetId: 'wave', phase: 'up', mode: 'toggle' }, 20);
    expect(stop).not.toHaveBeenCalled();
    binding.hotkey({ targetId: 'wave', phase: 'down', mode: 'toggle' }, 30);
    expect(stop).toHaveBeenLastCalledWith('wave', 30);
    expect(binding.playing()).toEqual([]);

    binding.hotkey({ targetId: 'nod', phase: 'down', mode: 'hold' }, 40);
    expect(play).toHaveBeenLastCalledWith('nod', 40);
    expect(binding.playing()).toEqual(['nod']);
    binding.hotkey({ targetId: 'nod', phase: 'up', mode: 'hold' }, 50);
    expect(stop).toHaveBeenLastCalledWith('nod', 50);
    expect(binding.playing()).toEqual([]);

    // 対象の無いホットキーは何もしない
    play.mockClear();
    binding.hotkey({ targetId: null, phase: 'down', mode: 'toggle' }, 60);
    expect(play).not.toHaveBeenCalled();
  });

  it('isHotkeyAnimationEvent: hotkey:animation の値の形を確かめる', () => {
    expect(isHotkeyAnimationEvent({ targetId: 'wave', phase: 'down', mode: 'toggle' })).toBe(true);
    expect(isHotkeyAnimationEvent({ targetId: null, phase: 'up', mode: 'hold' })).toBe(true);
    expect(isHotkeyAnimationEvent(null)).toBe(false);
    expect(isHotkeyAnimationEvent('wave')).toBe(false);
    expect(isHotkeyAnimationEvent({ targetId: 1, phase: 'down', mode: 'toggle' })).toBe(false);
    expect(isHotkeyAnimationEvent({ targetId: 'wave', phase: 'press', mode: 'toggle' })).toBe(false);
    expect(isHotkeyAnimationEvent({ targetId: 'wave', phase: 'down' })).toBe(false);
  });
});

describe('本物の AnimationPlayer と実行部', () => {
  function setup(animations: Animation[]) {
    const runtime = createStudioRuntime({ scheduler: { request: () => () => {} } });
    const player = createAnimationPlayer();
    const services: Services = { ...createFakeServices(), mixer: createParameterMixer(), animations: player };
    services.store.load(step2Project(animations));
    const binding = createAnimationBinding();
    binding.bind(player);
    runtime.registerLayerProducer(binding.producer);
    // トラッキングの代わり（顔 +18）と、後のレイヤーが受け取る flags を記録する producer
    let tracking = 18;
    runtime.registerLayerProducer({
      id: 'tracking',
      produce: () => ({ id: 'tracking', weight: 1, values: { FaceAngleX: tracking } }),
    });
    const flags: FrameContext['flags'][] = [];
    const lipSync: LayerProducer = {
      id: 'lipSync',
      produce(c) {
        flags.push({ ...c.flags });
        return null;
      },
    };
    runtime.registerLayerProducer(lipSync);
    runtime.attach(services);
    return {
      binding,
      flags,
      setTracking: (v: number) => (tracking = v),
      tick: (now: number) => runtime.tick(now)!.params,
    };
  }

  it('開始は現在の値から（+18 → 0 へなめらかに）、終わるとトラッキングの最新の値へ戻る。flags は後のレイヤーへ届く', () => {
    const { binding, flags, setTracking, tick } = setup([animation('front')]);
    const listener = vi.fn();
    binding.subscribe(listener);
    expect(tick(0).FaceAngleX).toBe(18);
    binding.toggle('front', 1000);
    expect(binding.playing()).toEqual(['front']);
    expect(tick(1000).FaceAngleX).toBe(18);
    expect(tick(1200).FaceAngleX).toBeCloseTo(9, 9);
    expect(flags.at(-1)).toEqual({ lipSyncWeight: 0.5, physicsActive: false });
    expect(tick(1400).FaceAngleX).toBe(0);
    expect(flags.at(-1)).toEqual({ lipSyncWeight: 0, physicsActive: false });

    // 1 秒で終わり、そこから blendOut で戻る。終わったら次のフレームでボタンの表示も戻る
    expect(listener).toHaveBeenCalledTimes(1);
    setTracking(10);
    expect(tick(2200).FaceAngleX).toBeCloseTo(5, 9);
    expect(binding.playing()).toEqual([]);
    expect(listener).toHaveBeenCalledTimes(2);
    setTracking(12);
    expect(tick(2400).FaceAngleX).toBe(12);
    expect(flags.at(-1)).toEqual({ lipSyncWeight: 1, physicsActive: true });
  });

  it('再生中に別のアニメーションを押すと切り替わり（割り込み）、ボタンの表示も移る', () => {
    const { binding, tick } = setup([
      animation('left', {
        duration: 5,
        tracks: [{ parameterId: 'FaceAngleX', keyframes: [{ time: 0, value: 20, curve: 'linear' }] }],
      }),
      animation('right', {
        duration: 5,
        tracks: [{ parameterId: 'FaceAngleX', keyframes: [{ time: 0, value: -20, curve: 'linear' }] }],
      }),
    ]);
    binding.toggle('left', 0);
    expect(tick(500).FaceAngleX).toBe(20);
    binding.toggle('right', 500);
    expect(binding.playing()).toEqual(['right']);
    expect(tick(500).FaceAngleX).toBe(20);
    // トラッキング 18 に古いもの（20）を 0.5 で混ぜた 19 から、新しいもの（−20）が 0.5 で混ざる
    expect(tick(700).FaceAngleX).toBeCloseTo(-0.5, 9);
    expect(tick(900).FaceAngleX).toBe(-20);
  });
});
