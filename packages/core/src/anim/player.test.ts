import { describe, expect, it } from 'vitest';
import {
  createEmptyProject,
  ensureStandardParameters,
  type Animation,
  type Parameter,
  type Project,
} from '@app/schema';
import type { AnimationPlayer, Layer, ParamValues } from '@app/contracts';
import { createParameterMixer } from '../mix';
import {
  animationAddsToTracking,
  animationAffectedParameters,
  animationValuesAt,
  createAnimationPlayer,
  evaluateAnimationTrack,
  type AnimationKeyframe,
} from './player';

const mixer = createParameterMixer();

// STEP2 の標準パラメータを持つプロジェクト
function project(animations: Animation[], extra: Parameter[] = []): Project {
  const p = createEmptyProject('テスト');
  const model = ensureStandardParameters(p.model, 'step2');
  return { ...p, model: { ...model, parameters: [...model.parameters, ...extra] }, animations };
}

type Key = [time: number, value: number, curve?: AnimationKeyframe['curve']];

function keys(list: Key[]): AnimationKeyframe[] {
  return list.map(([time, value, curve = 'linear']) => ({ time, value, curve }));
}

function track(parameterId: string, list: Key[]): Animation['tracks'][number] {
  return { parameterId, keyframes: keys(list) };
}

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
    tracks: [],
    affectedGroups: [],
    restart: 'restart',
    ...rest,
    transition: {
      preset: 'custom',
      blendIn: 0.4,
      blendOut: 0.4,
      curve: 'linear',
      blendMode: 'override',
      keepLipSync: true,
      keepPhysics: true,
      returnToTracking: true,
      ...transition,
    },
  };
}

// トラッキングのレイヤー（tracking の値）の上にアニメーションのレイヤーを合成する
function frame(player: AnimationPlayer, p: Project, now: number, tracking: ParamValues = {}) {
  const flags = { lipSyncWeight: 1, physicsActive: true };
  const trackingLayer: Layer = { id: 'tracking', weight: 1, values: tracking };
  const mixedSoFar = mixer.mix(p.model.parameters, [trackingLayer]);
  const produced = player.produce({ now, dt: 16, project: p, mixedSoFar, flags });
  const layers = produced === null ? [] : Array.isArray(produced) ? produced : [produced];
  const out = mixer.mix(p.model.parameters, [trackingLayer, ...layers]);
  return { layers, out, flags };
}

describe('evaluateAnimationTrack', () => {
  it('線形: 間は直線で、最初より前は最初の値、最後より後は最後の値', () => {
    const k = keys([
      [0.5, 0],
      [1.5, 10],
    ]);
    expect(evaluateAnimationTrack(k, 0)).toBe(0);
    expect(evaluateAnimationTrack(k, 0.75)).toBeCloseTo(2.5, 12);
    expect(evaluateAnimationTrack(k, 1)).toBeCloseTo(5, 12);
    expect(evaluateAnimationTrack(k, 2)).toBe(10);
  });

  it('なめらか: 前後のキーフレームの間を smoothstep', () => {
    const k = keys([
      [0, 0, 'smooth'],
      [1, 10],
    ]);
    expect(evaluateAnimationTrack(k, 0.25)).toBeCloseTo(1.5625, 12);
    expect(evaluateAnimationTrack(k, 0.5)).toBeCloseTo(5, 12);
    expect(evaluateAnimationTrack(k, 0.75)).toBeCloseTo(8.4375, 12);
  });

  it('一定: 次のキーフレームまで前の値のまま', () => {
    const k = keys([
      [0, 0, 'step'],
      [1, 10],
    ]);
    expect(evaluateAnimationTrack(k, 0.99)).toBe(0);
    expect(evaluateAnimationTrack(k, 1)).toBe(10);
  });

  it('キーフレームの curve は、そこから次のキーフレームまでの区間に使う', () => {
    const k = keys([
      [0, 0, 'linear'],
      [1, 10, 'step'],
      [2, 0, 'smooth'],
      [3, 10],
    ]);
    expect(evaluateAnimationTrack(k, 0.5)).toBeCloseTo(5, 12);
    expect(evaluateAnimationTrack(k, 1.5)).toBe(10);
    expect(evaluateAnimationTrack(k, 2.25)).toBeCloseTo(1.5625, 12);
  });

  it('時刻の順に並んでいなくても時刻の順に補間する。キーフレームが無ければ null', () => {
    const k = keys([
      [1, 10],
      [0, 0],
    ]);
    expect(evaluateAnimationTrack(k, 0.5)).toBeCloseTo(5, 12);
    expect(k[0]!.time).toBe(1); // 元の配列は変えない
    expect(evaluateAnimationTrack([], 0.5)).toBeNull();
  });
});

describe('影響範囲と値', () => {
  const p = project([]);
  const ids = (list: Parameter[]) => list.map((x) => x.id);

  it('affectedGroups が空なら、キーフレームのあるトラックのグループ（キーフレームの無いトラックは数えない）', () => {
    const a = animation('a', { tracks: [track('FaceAngleX', [[0, 5]]), track('MouthOpen', [])] });
    expect(ids(animationAffectedParameters(a, p.model.parameters))).toEqual(['FaceAngleX', 'FaceAngleY', 'FaceAngleZ']);
  });

  it('affectedGroups があれば、そのグループのパラメータだけ（外のグループのトラックは使わない）', () => {
    const a = animation('a', {
      tracks: [track('FaceAngleX', [[0, 5]]), track('EyeOpenL', [[0, 0.2]])],
      affectedGroups: ['eye'],
    });
    expect(ids(animationAffectedParameters(a, p.model.parameters))).toEqual([
      'EyeOpenL',
      'EyeOpenR',
      'EyeBallX',
      'EyeBallY',
      'EyeSmileL',
      'EyeSmileR',
    ]);
    const values = animationValuesAt(a, p.model.parameters, 0);
    expect(values).toEqual({ EyeOpenL: 0.2, EyeOpenR: 1, EyeBallX: 0, EyeBallY: 0, EyeSmileL: 0, EyeSmileR: 0 });
  });

  it('値はトラックの補間値（範囲に丸める）。影響範囲の中でトラックの無いパラメータはデフォルト値', () => {
    const a = animation('a', {
      tracks: [
        track('FaceAngleX', [
          [0, 0],
          [1, 60],
        ]),
      ],
    });
    expect(animationValuesAt(a, p.model.parameters, 0.25)).toEqual({ FaceAngleX: 15, FaceAngleY: 0, FaceAngleZ: 0 });
    expect(animationValuesAt(a, p.model.parameters, 1).FaceAngleX).toBe(30);
  });

  it('addToTracking で add にするのは顔・体の角度（ユーザー定義は顔・体のグループ）', () => {
    const user = (groupId: Parameter['groupId']) => ({ id: 'U', groupId, standard: false });
    expect(animationAddsToTracking({ id: 'FaceAngleX', groupId: 'face', standard: true })).toBe(true);
    expect(animationAddsToTracking({ id: 'BodyAngleZ', groupId: 'body', standard: true })).toBe(true);
    expect(animationAddsToTracking({ id: 'Breath', groupId: 'body', standard: true })).toBe(false);
    expect(animationAddsToTracking({ id: 'EyeOpenL', groupId: 'eye', standard: true })).toBe(false);
    expect(animationAddsToTracking(user('face'))).toBe(true);
    expect(animationAddsToTracking(user('body'))).toBe(true);
    expect(animationAddsToTracking(user('mouth'))).toBe(false);
  });
});

describe('createAnimationPlayer: 開始と終了の遷移', () => {
  // 顔を正面（0）に戻すアニメーション
  const front = (transition: Partial<Animation['transition']> = {}) =>
    animation('front', { duration: 2, tracks: [track('FaceAngleX', [[0, 0]])], transition });

  it('id は animation。何も再生していなければ何も出さない', () => {
    const player = createAnimationPlayer();
    expect(player.id).toBe('animation');
    expect(player.playing()).toEqual([]);
    expect(frame(player, project([front()]), 0, { FaceAngleX: 18 }).layers).toEqual([]);
  });

  it('開始は現在の値から始まる（+18 → 0 へ smoothstep でなめらかに）', () => {
    const player = createAnimationPlayer();
    const p = project([front({ curve: 'smooth' })]);
    const tracking = { FaceAngleX: 18 };
    player.play('front', 1000);
    expect(player.playing()).toEqual(['front']);
    const start = frame(player, p, 1000, tracking);
    expect(start.out.FaceAngleX).toBe(18);
    expect(frame(player, p, 1100, tracking).out.FaceAngleX).toBeCloseTo(18 * (1 - 0.15625), 9);
    const half = frame(player, p, 1200, tracking);
    expect(half.out.FaceAngleX).toBeCloseTo(9, 9);
    expect(half.layers).toEqual([
      {
        id: 'animation',
        weight: 0.5,
        values: { FaceAngleX: 0, FaceAngleY: 0, FaceAngleZ: 0 },
        blend: { FaceAngleX: 'override', FaceAngleY: 'override', FaceAngleZ: 'override' },
      },
    ]);
    expect(frame(player, p, 1300, tracking).out.FaceAngleX).toBeCloseTo(18 * (1 - 0.84375), 9);
    expect(frame(player, p, 1400, tracking).out.FaceAngleX).toBe(0);

    // 途中は飛ばずに減っていき、始めと終わりはゆっくり
    const player2 = createAnimationPlayer();
    player2.play('front', 0);
    const samples = Array.from({ length: 21 }, (_, i) => frame(player2, p, i * 20, tracking).out.FaceAngleX!);
    for (let i = 1; i < samples.length; i++) expect(samples[i]!).toBeLessThanOrEqual(samples[i - 1]!);
    expect(samples[0]! - samples[1]!).toBeLessThan(samples[10]! - samples[11]!);
    expect(samples[19]! - samples[20]!).toBeLessThan(samples[10]! - samples[11]!);
  });

  it('開始の遷移の途中は、そのときのトラッキングの値から混ざる', () => {
    const player = createAnimationPlayer();
    const p = project([front()]);
    player.play('front', 0);
    expect(frame(player, p, 0, { FaceAngleX: 18 }).out.FaceAngleX).toBe(18);
    expect(frame(player, p, 200, { FaceAngleX: 10 }).out.FaceAngleX).toBeCloseTo(5, 9);
  });

  it('終わりの時刻から blendOut 秒で、トラッキングの最新の値へ戻る', () => {
    const player = createAnimationPlayer();
    const p = project([front({ blendIn: 0, blendOut: 0.5 })]);
    player.play('front', 0);
    expect(frame(player, p, 0, { FaceAngleX: 18 }).out.FaceAngleX).toBe(0);
    expect(frame(player, p, 1990, { FaceAngleX: 18 }).out.FaceAngleX).toBe(0);
    expect(player.playing()).toEqual(['front']);
    // 終わりの時刻（2 秒）から下げ始め、再生中の一覧からは外れる
    expect(frame(player, p, 2000, { FaceAngleX: 18 }).out.FaceAngleX).toBe(0);
    expect(player.playing()).toEqual([]);
    // 戻る途中もトラッキングは動いている
    expect(frame(player, p, 2250, { FaceAngleX: 12 }).out.FaceAngleX).toBeCloseTo(6, 9);
    expect(player.playing()).toEqual([]);
    const end = frame(player, p, 2500, { FaceAngleX: 14 });
    expect(end.out.FaceAngleX).toBe(14);
    expect(end.layers).toEqual([]);
    expect(frame(player, p, 3000, { FaceAngleX: -7 }).out.FaceAngleX).toBe(-7);
  });

  it('stop でその時点から blendOut 秒で戻る。playing() は呼んだ直後から外れる', () => {
    const player = createAnimationPlayer();
    const p = project([front({ blendIn: 0 })]);
    player.play('front', 0);
    frame(player, p, 0, { FaceAngleX: 20 });
    player.stop('front', 500);
    expect(player.playing()).toEqual([]);
    expect(frame(player, p, 500, { FaceAngleX: 20 }).out.FaceAngleX).toBe(0);
    expect(frame(player, p, 700, { FaceAngleX: 20 }).out.FaceAngleX).toBeCloseTo(10, 9);
    expect(frame(player, p, 900, { FaceAngleX: 20 }).out.FaceAngleX).toBe(20);
  });

  it('開始の遷移の途中で stop すると、その時点の重みから下げる（値が飛ばない）', () => {
    const player = createAnimationPlayer();
    const p = project([front()]);
    const tracking = { FaceAngleX: 20 };
    player.play('front', 0);
    expect(frame(player, p, 200, tracking).out.FaceAngleX).toBeCloseTo(10, 9);
    player.stop('front', 200);
    expect(frame(player, p, 200, tracking).out.FaceAngleX).toBeCloseTo(10, 9);
    expect(frame(player, p, 400, tracking).out.FaceAngleX).toBeCloseTo(15, 9);
    expect(frame(player, p, 600, tracking).out.FaceAngleX).toBe(20);
  });

  it('stopAll で再生中のものをすべて戻す', () => {
    const player = createAnimationPlayer();
    const p = project([front({ blendIn: 0, blendOut: 0 })]);
    player.play('front', 0);
    frame(player, p, 0);
    player.stopAll(100);
    expect(player.playing()).toEqual([]);
    expect(frame(player, p, 100, { FaceAngleX: 9 }).out.FaceAngleX).toBe(9);
  });

  it('ループはアニメーションの時刻を繰り返し、終わらない。speed で速さが変わる', () => {
    const ramp = [
      track('FaceAngleX', [
        [0, 0],
        [1, 10],
      ]),
    ];
    const loop = animation('loop', { loop: true, tracks: ramp, transition: { blendIn: 0 } });
    const fast = animation('fast', { speed: 2, tracks: ramp, transition: { blendIn: 0, blendOut: 0.4 } });
    const p = project([loop, fast]);
    const player = createAnimationPlayer();
    player.play('loop', 0);
    expect(frame(player, p, 1500).out.FaceAngleX).toBeCloseTo(5, 9);
    expect(frame(player, p, 10250).out.FaceAngleX).toBeCloseTo(2.5, 9);
    expect(player.playing()).toEqual(['loop']);

    const player2 = createAnimationPlayer();
    player2.play('fast', 0);
    expect(frame(player2, p, 250).out.FaceAngleX).toBeCloseTo(5, 9);
    // 2倍の速さなので 0.5 秒で終わりの時刻に着き、そこから下げる
    expect(frame(player2, p, 700).out.FaceAngleX).toBeCloseTo(5, 9);
    expect(player2.playing()).toEqual([]);
    expect(frame(player2, p, 900).layers).toEqual([]);
  });
});

describe('createAnimationPlayer: 割り込み・再開始・保持', () => {
  const left = animation('left', { duration: 5, tracks: [track('FaceAngleX', [[0, 20]])] });
  const right = animation('right', { duration: 5, tracks: [track('FaceAngleX', [[0, -20]])] });

  it('割り込み: 古いものは blendOut で下げ、新しいものは blendIn で上げる（同時に2つのレイヤー）', () => {
    const p = project([left, right]);
    const player = createAnimationPlayer();
    player.play('left', 0);
    expect(frame(player, p, 1000).out.FaceAngleX).toBe(20);
    player.play('right', 1000);
    expect(player.playing()).toEqual(['right']);
    const at = frame(player, p, 1000);
    expect(at.out.FaceAngleX).toBe(20);
    expect(at.layers.map((l) => [l.values.FaceAngleX, l.weight])).toEqual([[20, 1]]); // 新しいものは重み 0
    const mid = frame(player, p, 1200);
    expect(mid.layers.map((l) => [l.values.FaceAngleX, l.weight])).toEqual([
      [20, 0.5],
      [-20, 0.5],
    ]);
    // 古いものを混ぜた結果（10）から、新しいものが混ざる
    expect(mid.out.FaceAngleX).toBeCloseTo(-5, 9);
    const done = frame(player, p, 1400);
    expect(done.layers.map((l) => [l.values.FaceAngleX, l.weight])).toEqual([[-20, 1]]);
    expect(done.out.FaceAngleX).toBe(-20);
  });

  it('遷移の途中で始めても、その時点の合成結果から混ざる（値が飛ばない）', () => {
    const p = project([left, right]);
    const player = createAnimationPlayer();
    player.play('left', 0);
    const before = frame(player, p, 200, { FaceAngleX: 0 }).out.FaceAngleX!;
    expect(before).toBeCloseTo(10, 9);
    player.play('right', 200);
    expect(frame(player, p, 200, { FaceAngleX: 0 }).out.FaceAngleX).toBeCloseTo(before, 9);
    // 古いものは 0.5 から下げ（0.375）、新しいものは 0 から上げる（0.25）
    const next = frame(player, p, 300, { FaceAngleX: 0 });
    expect(next.layers.map((l) => l.weight)).toEqual([0.375, 0.25]);
    expect(next.out.FaceAngleX).toBeCloseTo(7.5 + (-20 - 7.5) * 0.25, 9);
  });

  const ramp = (restart: Animation['restart']) =>
    animation('ramp', {
      restart,
      tracks: [
        track('FaceAngleX', [
          [0, 0],
          [1, 10],
        ]),
      ],
      transition: { blendIn: 0.2, blendOut: 0.2 },
    });

  it('再開始（restart）: 再生中のものは下げ、最初から上げ直す', () => {
    const p = project([ramp('restart')]);
    const player = createAnimationPlayer();
    player.play('ramp', 0);
    expect(frame(player, p, 500).out.FaceAngleX).toBeCloseTo(5, 9);
    player.play('ramp', 500);
    expect(player.playing()).toEqual(['ramp']);
    expect(frame(player, p, 500).out.FaceAngleX).toBeCloseTo(5, 9);
    const mid = frame(player, p, 600);
    expect(mid.layers.map((l) => [l.values.FaceAngleX, l.weight])).toEqual([
      [6, 0.5],
      [1, 0.5],
    ]);
    expect(mid.out.FaceAngleX).toBeCloseTo(2, 9);
    expect(frame(player, p, 700).out.FaceAngleX).toBeCloseTo(2, 9); // 最初からの 0.2 秒目
    expect(frame(player, p, 1500).out.FaceAngleX).toBeCloseTo(10, 9);
  });

  it('再開始（ignore）: 再生中のものをもう一度始めても何もしない', () => {
    const p = project([ramp('ignore')]);
    const player = createAnimationPlayer();
    player.play('ramp', 0);
    frame(player, p, 500);
    player.play('ramp', 500);
    expect(player.playing()).toEqual(['ramp']);
    const next = frame(player, p, 600);
    expect(next.layers.map((l) => [l.values.FaceAngleX, l.weight])).toEqual([[6, 1]]);
    // 終わって戻ったあとなら、また最初から始まる
    frame(player, p, 1200);
    expect(player.playing()).toEqual([]);
    player.play('ramp', 1300);
    expect(frame(player, p, 1400).layers.map((l) => [l.values.FaceAngleX, l.weight])).toEqual([[1, 0.5]]);
  });

  const hold = animation('hold', {
    tracks: [
      track('FaceAngleX', [
        [0, 0],
        [1, 10],
      ]),
    ],
    transition: { blendIn: 0, returnToTracking: false },
  });

  it('保持（returnToTracking false）: 終わりで重み 1 のまま最後の値を保ち、stop で戻る', () => {
    const p = project([hold]);
    const player = createAnimationPlayer();
    player.play('hold', 0);
    expect(frame(player, p, 1000, { FaceAngleX: 4 }).out.FaceAngleX).toBe(10);
    const later = frame(player, p, 60_000, { FaceAngleX: 4 });
    expect(later.layers.map((l) => [l.values.FaceAngleX, l.weight])).toEqual([[10, 1]]);
    expect(player.playing()).toEqual(['hold']);
    player.stop('hold', 60_000);
    expect(frame(player, p, 60_200, { FaceAngleX: 4 }).out.FaceAngleX).toBeCloseTo(7, 9);
    expect(frame(player, p, 60_400, { FaceAngleX: 4 }).out.FaceAngleX).toBe(4);
    expect(player.playing()).toEqual([]);
  });

  it('保持は別のアニメーションの開始でも解除する（下げながら新しいものを上げる）', () => {
    const p = project([hold, right]);
    const player = createAnimationPlayer();
    player.play('hold', 0);
    frame(player, p, 5000);
    player.play('right', 5000);
    const mid = frame(player, p, 5200);
    expect(mid.layers.map((l) => [l.values.FaceAngleX, l.weight])).toEqual([
      [10, 0.5],
      [-20, 0.5],
    ]);
    expect(frame(player, p, 5400).layers.map((l) => [l.values.FaceAngleX, l.weight])).toEqual([[-20, 1]]);
    expect(player.playing()).toEqual(['right']);
  });
});

describe('createAnimationPlayer: 影響範囲と合成方法', () => {
  it('影響範囲の外のパラメータには作用しない（トラックがあっても）', () => {
    const a = animation('a', {
      tracks: [track('FaceAngleX', [[0, 25]]), track('MouthOpen', [[0, 1]])],
      affectedGroups: ['face'],
      transition: { blendIn: 0 },
    });
    const p = project([a]);
    const player = createAnimationPlayer();
    player.play('a', 0);
    const tracking = { FaceAngleX: -5, MouthOpen: 0.3, EyeOpenL: 0.4, BodyAngleX: 3 };
    const { layers, out } = frame(player, p, 100, tracking);
    expect(Object.keys(layers[0]!.values)).toEqual(['FaceAngleX', 'FaceAngleY', 'FaceAngleZ']);
    expect(out).toMatchObject({ FaceAngleX: 25, MouthOpen: 0.3, EyeOpenL: 0.4, BodyAngleX: 3 });
  });

  it('自動（affectedGroups が空）ならトラックのあるグループ。グループの中のトラックの無いパラメータはデフォルト値', () => {
    const a = animation('a', { tracks: [track('EyeOpenL', [[0, 0]])], transition: { blendIn: 0 } });
    const p = project([a]);
    const player = createAnimationPlayer();
    player.play('a', 0);
    const tracking = { EyeOpenL: 0.9, EyeOpenR: 0.5, EyeBallX: 0.6, FaceAngleY: 8, MouthOpen: 0.2 };
    const { out } = frame(player, p, 100, tracking);
    expect(out).toMatchObject({ EyeOpenL: 0, EyeOpenR: 1, EyeBallX: 0, FaceAngleY: 8, MouthOpen: 0.2 });
  });

  it('addToTracking: 顔・体の角度は add（トラックの値 − デフォルト値）、ほかは override', () => {
    const headTilt: Parameter = {
      id: 'HeadTilt',
      name: '頭の傾き',
      groupId: 'face',
      min: -10,
      max: 10,
      default: 2,
      standard: false,
    };
    const a = animation('a', {
      tracks: [track('FaceAngleX', [[0, 5]]), track('HeadTilt', [[0, 5]]), track('EyeSmileL', [[0, 1]])],
      transition: { blendMode: 'addToTracking' },
    });
    const p = project([a], [headTilt]);
    const player = createAnimationPlayer();
    player.play('a', 0);
    const tracking = { FaceAngleX: 10, FaceAngleY: 7, EyeSmileL: 0.2 };
    const half = frame(player, p, 200, tracking);
    expect(half.layers[0]!.blend).toMatchObject({
      FaceAngleX: 'add',
      FaceAngleY: 'add',
      HeadTilt: 'add',
      EyeSmileL: 'override',
    });
    expect(half.layers[0]!.values).toMatchObject({ FaceAngleX: 5, FaceAngleY: 0, HeadTilt: 3, EyeSmileL: 1 });
    expect(half.out.FaceAngleX).toBeCloseTo(12.5, 9);
    const full = frame(player, p, 400, tracking);
    expect(full.out).toMatchObject({ FaceAngleX: 15, FaceAngleY: 7, HeadTilt: 5, EyeSmileL: 1 });
  });
});

describe('createAnimationPlayer: flags', () => {
  const mouth = (keep: { keepLipSync?: boolean; keepPhysics?: boolean }, id = 'talk') =>
    animation(id, { tracks: [track('MouthOpen', [[0, 1]])], transition: { blendOut: 0.4, ...keep } });

  it('keepLipSync が false の再生中は lipSyncWeight を (1 − w)', () => {
    const p = project([mouth({ keepLipSync: false })]);
    const player = createAnimationPlayer();
    player.play('talk', 0);
    expect(frame(player, p, 0).flags.lipSyncWeight).toBe(1);
    expect(frame(player, p, 100).flags.lipSyncWeight).toBeCloseTo(0.75, 9);
    expect(frame(player, p, 400).flags.lipSyncWeight).toBe(0);
    expect(frame(player, p, 1200).flags.lipSyncWeight).toBeCloseTo(0.5, 9); // 終わりの時刻から戻る途中
    expect(frame(player, p, 1400).flags).toEqual({ lipSyncWeight: 1, physicsActive: true });
  });

  it('keepPhysics が false の再生中（戻る途中も）は physicsActive を false', () => {
    const p = project([mouth({ keepPhysics: false })]);
    const player = createAnimationPlayer();
    player.play('talk', 0);
    expect(frame(player, p, 0).flags).toEqual({ lipSyncWeight: 1, physicsActive: false });
    expect(frame(player, p, 1200).flags.physicsActive).toBe(false);
    expect(frame(player, p, 1400).flags.physicsActive).toBe(true);
  });

  it('keepLipSync・keepPhysics が true なら flags を変えない', () => {
    const p = project([mouth({ keepLipSync: true, keepPhysics: true })]);
    const player = createAnimationPlayer();
    player.play('talk', 0);
    expect(frame(player, p, 500).flags).toEqual({ lipSyncWeight: 1, physicsActive: true });
  });

  it('割り込みで2つ重なっている間は、それぞれの (1 − w) の積', () => {
    const p = project([mouth({ keepLipSync: false }, 'a'), mouth({ keepLipSync: false }, 'b')]);
    const player = createAnimationPlayer();
    player.play('a', 0);
    frame(player, p, 400);
    player.play('b', 400);
    expect(frame(player, p, 600).flags.lipSyncWeight).toBeCloseTo(0.5 * 0.5, 9);
  });
});

describe('createAnimationPlayer: そのほか', () => {
  const a = animation('a', { tracks: [track('FaceAngleX', [[0, 10]])], transition: { blendIn: 0 } });

  it('プロジェクトに無いアニメーションは再生しない（playing() からも外れる）', () => {
    const player = createAnimationPlayer();
    player.play('missing', 0);
    expect(player.playing()).toEqual(['missing']);
    expect(frame(player, project([a]), 0).layers).toEqual([]);
    expect(player.playing()).toEqual([]);
  });

  it('再生中にアニメーションが消されたら、すぐに出さなくなる', () => {
    const player = createAnimationPlayer();
    player.play('a', 0);
    expect(frame(player, project([a]), 100).out.FaceAngleX).toBe(10);
    expect(frame(player, project([]), 200).layers).toEqual([]);
    expect(player.playing()).toEqual([]);
  });

  it('時刻が戻ったら（呼んだ時刻より前の produce）、その時刻から数え直す', () => {
    const p = project([animation('b', { tracks: [track('FaceAngleX', [[0, 10]])] })]);
    const player = createAnimationPlayer();
    player.play('b', 5000);
    expect(frame(player, p, 1000).out.FaceAngleX).toBe(0);
    expect(frame(player, p, 1200).out.FaceAngleX).toBeCloseTo(5, 9);
  });
});
