import { describe, expect, it } from 'vitest';
import { createEmptyProject, ensureStandardParameters, type Animation, type Physics } from '@app/schema';
import type { AnimationPlayer, FrameContext, ParamValues } from '@app/contracts';
import { createParameterMixer } from '../mix';
import { createAnimationPlayer } from './player';
import { createPhysicsEngine } from '../physics/engine';

function clip(id = 'a', patch: Partial<Animation['transition']> = {}, values = [20, 30]): Animation {
  return {
    id,
    name: id,
    duration: 2,
    speed: 1,
    loop: false,
    periodic: false,
    restart: 'restart',
    affectedGroups: [],
    tracks: [
      {
        parameterId: 'FaceAngleX',
        keyframes: [
          { time: 0, value: values[0]!, curve: 'linear' },
          { time: 1, value: values[1]!, curve: 'linear' },
        ],
      },
    ],
    transition: {
      preset: 'custom',
      blendIn: 0,
      blendOut: 0.5,
      curve: 'linear',
      blendMode: 'override',
      keepLipSync: true,
      keepPhysics: true,
      returnToTracking: true,
      startFromCurrent: true,
      ...patch,
    },
  };
}
function project(animations: Animation[]) {
  const p = createEmptyProject('I-060');
  return { ...p, model: ensureStandardParameters(p.model, 'step2'), animations };
}
const mixer = createParameterMixer();
function frame(
  player: AnimationPlayer,
  p: ReturnType<typeof project>,
  now: number,
  base: ParamValues = {},
  extra: Partial<FrameContext> = {},
) {
  const mixedSoFar = mixer.mix(p.model.parameters, [{ id: 'tracking', weight: 1, values: base }]);
  const ctx: FrameContext = {
    now,
    dt: 16,
    project: p,
    mixedSoFar,
    flags: { lipSyncWeight: 1, physicsActive: true },
    ...extra,
  };
  const layers = player.produce(ctx);
  return {
    out: mixer.mix(p.model.parameters, [
      { id: 'tracking', weight: 1, values: base },
      ...(Array.isArray(layers) ? layers : layers ? [layers] : []),
    ]),
    ctx,
  };
}
describe('現在の姿勢へ変化量を重ねる（I-060）', () => {
  it('先頭の値が20でも開始姿勢12を保ち、以後は記録した差だけを重ねる。キーの無い軸は動かさない', () => {
    const player = createAnimationPlayer(),
      p = project([clip()]),
      raw = JSON.stringify(p);
    frame(player, p, 0, { FaceAngleX: 12, FaceAngleY: 7 });
    player.play('a', 100);
    expect(frame(player, p, 100, { FaceAngleX: 12, FaceAngleY: 7 }).out).toMatchObject({
      FaceAngleX: 12,
      FaceAngleY: 7,
    });
    expect(frame(player, p, 600, { FaceAngleX: -10, FaceAngleY: 8 }).out).toMatchObject({
      FaceAngleX: 17,
      FaceAngleY: 8,
    });
    expect(JSON.stringify(p)).toBe(raw);
  });
  it('始まりの秒数は変化量に掛かり、再生速度とパラメータの範囲を守る', () => {
    const a = clip('a', { blendIn: 1 }),
      p = project([a]),
      player = createAnimationPlayer();
    frame(player, p, 0, { FaceAngleX: 12 });
    player.play('a', 0);
    expect(frame(player, p, 500, { FaceAngleX: 12 }).out.FaceAngleX).toBeCloseTo(14.5);
    const fast = createAnimationPlayer();
    a.speed = 2;
    frame(fast, p, 0, { FaceAngleX: 28 });
    fast.play('a', 0);
    expect(frame(fast, p, 500, { FaceAngleX: 28 }).out.FaceAngleX).toBe(30);
  });
  it('途中の切替でも前の表示姿勢を引き継ぎ、前のフェードと二重に混ぜない', () => {
    const old = clip('old', { startFromCurrent: false }, [20, 20]),
      next = clip('next', {}, [-10, 0]),
      p = project([old, next]),
      player = createAnimationPlayer();
    player.play('old', 0);
    expect(frame(player, p, 100, { FaceAngleX: 0 }).out.FaceAngleX).toBe(20);
    player.play('next', 100);
    expect(frame(player, p, 100, { FaceAngleX: 0 }).out.FaceAngleX).toBe(20);
    expect(frame(player, p, 350, { FaceAngleX: 0 }).out.FaceAngleX).toBeCloseTo(22.5);
    player.play('next', 350);
    expect(frame(player, p, 350, { FaceAngleX: 0 }).out.FaceAngleX).toBeCloseTo(22.5);
  });
  it('トラッキングに加算では、開始の姿勢と以後のカメラの変化を保つ', () => {
    const player = createAnimationPlayer(),
      p = project([clip('a', { blendMode: 'addToTracking' })]);
    frame(player, p, 0, { FaceAngleX: 12 });
    player.play('a', 0);
    expect(frame(player, p, 0, { FaceAngleX: 12 }).out.FaceAngleX).toBe(12);
    expect(frame(player, p, 500, { FaceAngleX: 14 }).out.FaceAngleX).toBe(19);
  });
  it('停止の瞬間は飛ばず、最新の入力へ戻る。別作品には開始姿勢を持ち越さない', () => {
    const player = createAnimationPlayer(),
      p = project([clip()]);
    frame(player, p, 0, { FaceAngleX: 12 });
    player.play('a', 0);
    const before = frame(player, p, 500, { FaceAngleX: 12 }).out.FaceAngleX;
    player.stop('a', 500);
    expect(frame(player, p, 500, { FaceAngleX: 12 }).out.FaceAngleX).toBe(before);
    expect(frame(player, p, 1000, { FaceAngleX: -4 }).out.FaceAngleX).toBe(-4);
    const second = { ...p, id: 'second' };
    player.play('a', 1100);
    expect(frame(player, second, 1100, { FaceAngleX: 3 }).out.FaceAngleX).toBe(3);
  });
  it('ループで変化量が蓄積せず、再開始を無視する設定を守る', () => {
    const a = clip();
    a.loop = true;
    a.duration = 1;
    a.tracks[0]!.keyframes = [
      { time: 0, value: 20, curve: 'smooth' },
      { time: 0.5, value: 30, curve: 'smooth' },
      { time: 1, value: 20, curve: 'linear' },
    ];
    a.restart = 'ignore';
    const player = createAnimationPlayer(),
      p = project([a]);
    frame(player, p, 0, { FaceAngleX: 12 });
    player.play('a', 0);
    expect(frame(player, p, 250, { FaceAngleX: 12 }).out.FaceAngleX).toBe(17);
    player.play('a', 250);
    expect(frame(player, p, 375, { FaceAngleX: 12 }).out.FaceAngleX).toBeCloseTo(20.4375);
    expect(frame(player, p, 1000, { FaceAngleX: 12 }).out.FaceAngleX).toBe(12);
    expect(frame(player, p, 2000, { FaceAngleX: 12 }).out.FaceAngleX).toBe(12);
  });
  it('維持OFFのリップシンクと、手動の物理トラックには前フレームの実際の差を引き継ぐ', () => {
    const a = clip('a', { keepLipSync: false, keepPhysics: false });
    a.tracks = [
      {
        parameterId: 'HairFront',
        keyframes: [
          { time: 0, value: 0.8, curve: 'linear' },
          { time: 1, value: 1, curve: 'linear' },
        ],
      },
    ];
    const p = project([a]);
    p.physics = [{ outputParameterId: 'HairFront' } as Physics];
    const player = createAnimationPlayer();
    player.play('a', 0);
    const r = frame(
      player,
      p,
      0,
      {},
      {
        previousAnimationPose: {
          projectId: p.id,
          values: { HairFront: 0.1, MouthOpen: 0.2 },
          physicsOffsets: { HairFront: 0.2 },
          lipSyncOffsets: { MouthOpen: 0.5 },
        },
      },
    );
    expect(r.out.HairFront).toBeCloseTo(0.3);
    expect(r.out.MouthOpen).toBeCloseTo(0.7);
    expect(r.ctx.flags).toMatchObject({
      lipSyncWeight: 0,
      physicsActive: false,
      freezePhysics: true,
      manualPhysicsParameterIds: ['HairFront'],
    });
  });
  it('削除された再生を時刻が戻っても安全に除く', () => {
    const player = createAnimationPlayer(),
      p = project([clip()]);
    player.play('a', 100);
    frame(player, p, 100, { FaceAngleX: 12 });
    expect(() => frame(player, { ...p, animations: [] }, 0)).not.toThrow();
    expect(player.playing()).toEqual([]);
  });
});
describe('実験再生の物理停止', () => {
  it('直前の出力を保持し、手動トラック・削除・別作品・resetには持ち越さない', () => {
    const p = project([]);
    p.physics = [
      {
        id: 'hair',
        partId: 'part',
        preset: 'hair',
        strength: 0,
        direction: 'horizontal',
        length: 120,
        spring: 30,
        damping: 4,
        gravity: 0.5,
        inertia: 1,
        range: 1,
        inputs: [],
        outputParameterId: 'HairFront',
      },
    ];
    const engine = createPhysicsEngine(),
      ctx = (now: number, active = true): FrameContext => ({
        now,
        dt: 16,
        project: p,
        mixedSoFar: { FaceAngleX: now > 100 ? 30 : 0 },
        flags: { lipSyncWeight: 1, physicsActive: active, freezePhysics: !active },
      });
    let layer;
    for (let now = 0; now <= 500; now += 16) layer = engine.produce(ctx(now));
    expect(Math.abs(layer!.values.HairFront!)).toBeGreaterThan(0.01);
    expect(engine.produce(ctx(1000, false))!.values).toEqual(layer!.values);
    const legacy = ctx(1020, false);
    legacy.flags.freezePhysics = false;
    expect(engine.produce(legacy)).toBeNull();
    expect(engine.produce(ctx(1040, false))).toBeNull();
    for (let now = 1050; now <= 1500; now += 16) layer = engine.produce(ctx(now));
    expect(Math.abs(layer!.values.HairFront!)).toBeGreaterThan(0.01);
    const manual = ctx(1100, false);
    manual.flags.manualPhysicsParameterIds = ['HairFront'];
    expect(engine.produce(manual)).toBeNull();
    expect(engine.produce(ctx(1150, false))).toBeNull();
    expect(engine.produce({ ...ctx(1200, false), project: { ...p, id: 'another' } })).toBeNull();
    engine.reset();
    expect(engine.produce(ctx(1300, false))).toBeNull();
  });
});
