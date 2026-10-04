import { describe, expect, it } from 'vitest';
import {
  createEmptyProject,
  ensureStandardParameters,
  validateProject,
  type Animation,
  type Project,
} from '@app/schema';
import type { AnimationPlayer, FrameContext, Layer, LayerProducer, ParamValues, PeriodicPlayer } from '@app/contracts';
import { createParameterMixer } from '../mix';
import { createAnimationPlayer, type AnimationKeyframe } from './player';
import {
  createPeriodicPlayer,
  createStandardBreathAnimation,
  hasBreathAnimation,
  PERIODIC_FADE_SECONDS,
  STANDARD_BREATH_ANIMATION_ID,
  withStandardBreathAnimation,
} from './periodic';

const mixer = createParameterMixer();

// STEP2 の標準パラメータを持つプロジェクト
function project(animations: Animation[]): Project {
  const p = createEmptyProject('テスト');
  return { ...p, model: ensureStandardParameters(p.model, 'step2'), animations };
}

type Key = [time: number, value: number, curve?: AnimationKeyframe['curve']];

function track(parameterId: string, list: Key[]): Animation['tracks'][number] {
  return { parameterId, keyframes: list.map(([time, value, curve = 'linear']) => ({ time, value, curve })) };
}

function animation(id: string, patch: Partial<Animation> = {}): Animation {
  return {
    id,
    name: id,
    duration: 1,
    speed: 1,
    loop: false,
    periodic: true,
    tracks: [],
    affectedGroups: [],
    restart: 'restart',
    transition: {
      preset: 'custom',
      blendIn: 0,
      blendOut: 0,
      curve: 'linear',
      blendMode: 'override',
      keepLipSync: true,
      keepPhysics: true,
      returnToTracking: true,
    },
    ...patch,
  };
}

// FaceAngleX をいつも 10 にする（フェードだけを見る）
const steady = (id = 'steady', value = 10) => animation(id, { tracks: [track('FaceAngleX', [[0, value]])] });
// FaceAngleX を 0 → 5 → 0（線形、2 秒で1周）
const sway = (id = 'sway') =>
  animation(id, {
    duration: 2,
    tracks: [
      track('FaceAngleX', [
        [0, 0],
        [1, 5],
        [2, 0],
      ]),
    ],
  });

function ctx(p: Project, now: number, mixedSoFar: ParamValues = {}): FrameContext {
  return { now, dt: 16, project: p, mixedSoFar, flags: { lipSyncWeight: 1, physicsActive: true } };
}

function layerOf(player: PeriodicPlayer, p: Project, now: number): Layer | null {
  const out = player.produce(ctx(p, now));
  expect(Array.isArray(out)).toBe(false);
  return out as Layer | null;
}

// 出さないとき（null）は 0
const valueOf = (player: PeriodicPlayer, p: Project, now: number, id = 'FaceAngleX') =>
  layerOf(player, p, now)?.values[id] ?? 0;

// スタジオの1フレームと同じ順（LAYER_ORDER）に producer を呼び、mixedSoFar を更新しながら合成する
function frame(producers: LayerProducer[], p: Project, now: number) {
  const flags = { lipSyncWeight: 1, physicsActive: true };
  const layers: Layer[] = [];
  let mixedSoFar = mixer.mix(p.model.parameters, []);
  const seen: Record<string, FrameContext['flags']> = {};
  for (const producer of producers) {
    seen[producer.id] = { ...flags };
    const r = producer.produce({ now, dt: 16, project: p, mixedSoFar, flags });
    layers.push(...(r === null ? [] : Array.isArray(r) ? r : [r]));
    mixedSoFar = mixer.mix(p.model.parameters, layers);
  }
  return { params: mixedSoFar, seen };
}

function trackingProducer(values: () => ParamValues): LayerProducer {
  return { id: 'tracking', produce: () => ({ id: 'tracking', weight: 1, values: values() }) };
}

describe('createPeriodicPlayer: 値', () => {
  it('標準の呼吸: Breath を 0 → 1 → 0、4 秒で1周、なめらか。差分を add・weight 1 のレイヤー1つで返す', () => {
    const p = project([createStandardBreathAnimation()]);
    const player = createPeriodicPlayer();
    expect(player.id).toBe('periodic');
    player.setActive([STANDARD_BREATH_ANIMATION_ID]);
    expect(layerOf(player, p, 0)).toBeNull(); // ここから始まる（フェードが終わる 0.5 秒から後で見る）
    expect(valueOf(player, p, 500, 'Breath')).toBeCloseTo(0.15625, 12); // 0.5 秒の位置: smoothstep(0.25)
    const layer = layerOf(player, p, 1000)!;
    expect(layer).toEqual({ id: 'periodic', weight: 1, values: { Breath: 0.5 }, blend: { Breath: 'add' } });
    expect(valueOf(player, p, 2000, 'Breath')).toBe(1);
    expect(valueOf(player, p, 3000, 'Breath')).toBeCloseTo(0.5, 12);
    expect(valueOf(player, p, 4000, 'Breath')).toBe(0); // 1周して戻る
    expect(valueOf(player, p, 5000, 'Breath')).toBeCloseTo(0.5, 12);
    expect(valueOf(player, p, 42000, 'Breath')).toBe(1); // 何周しても同じ形
  });

  it('値はトラックの補間値からデフォルト値を引いた差分。値の範囲に丸めてから引き、トラックの無いパラメータは出さない', () => {
    const p = project([
      animation('a', {
        tracks: [
          track('EyeOpenL', [[0, 0.25]]), // デフォルト値 1 → 差分 −0.75
          track('FaceAngleX', [[0, 50]]), // 範囲 ±30 → 30
          track('Unknown', [[0, 1]]), // プロジェクトに無いパラメータ
          track('MouthOpen', []), // キーフレームが無い
        ],
      }),
    ]);
    const player = createPeriodicPlayer();
    player.setActive(['a']);
    layerOf(player, p, 0);
    expect(layerOf(player, p, 500)).toEqual({
      id: 'periodic',
      weight: 1,
      values: { EyeOpenL: -0.75, FaceAngleX: 30 },
      blend: { EyeOpenL: 'add', FaceAngleX: 'add' },
    });
  });

  it('同じパラメータを動かす周期アニメーションは足し合わせる', () => {
    const p = project([steady('a', 10), steady('b', 4), animation('c', { tracks: [track('Breath', [[0, 1]])] })]);
    const player = createPeriodicPlayer();
    player.setActive(['a', 'b', 'c']);
    layerOf(player, p, 0);
    expect(layerOf(player, p, 500)!.values).toEqual({ FaceAngleX: 14, Breath: 1 });
  });

  it('影響範囲（affectedGroups）の外のトラックは使わない', () => {
    const p = project([
      animation('a', {
        tracks: [track('FaceAngleX', [[0, 10]]), track('Breath', [[0, 1]])],
        affectedGroups: ['body'],
      }),
    ]);
    const player = createPeriodicPlayer();
    player.setActive(['a']);
    layerOf(player, p, 0);
    expect(layerOf(player, p, 500)!.values).toEqual({ Breath: 1 });
  });

  it('いつもループする（loop が false でも）。再生速度を掛け、長さ 0 なら最初の値のまま', () => {
    const fast = { ...sway('fast'), speed: 2, loop: false };
    const zero = animation('zero', {
      duration: 0,
      tracks: [
        track('Breath', [
          [0, 0.3],
          [1, 1],
        ]),
      ],
    });
    const p = project([fast, zero]);
    const player = createPeriodicPlayer();
    player.setActive(['fast', 'zero']);
    layerOf(player, p, 0);
    expect(valueOf(player, p, 500)).toBe(5); // 2 倍の速さで 1 秒の位置
    expect(valueOf(player, p, 1000)).toBe(0); // 2 秒の長さを 1 秒で1周
    expect(valueOf(player, p, 1250)).toBeCloseTo(2.5, 12);
    expect(valueOf(player, p, 10500)).toBe(5);
    expect(valueOf(player, p, 1250, 'Breath')).toBeCloseTo(0.3, 12);
  });
});

describe('createPeriodicPlayer: 選ばれたもの', () => {
  it('periodic が true のものだけを使う。無い id は無視する。何も無ければ null', () => {
    const p = project([steady('a'), { ...steady('b'), periodic: false }]);
    const player = createPeriodicPlayer();
    expect(layerOf(player, p, 0)).toBeNull();
    player.setActive(['b', 'missing']);
    layerOf(player, p, 0);
    expect(layerOf(player, p, 1000)).toBeNull();
    player.setActive(['b', 'a', 'a']);
    layerOf(player, p, 1000);
    expect(valueOf(player, p, 2000)).toBe(10);
  });

  it('setActive は次の produce の時刻から反映する。setActive に渡した配列を後で変えても影響しない', () => {
    const p = project([steady('a')]);
    const player = createPeriodicPlayer();
    const ids = ['a'];
    player.setActive(ids);
    ids.length = 0;
    expect(layerOf(player, p, 5000)).toBeNull(); // 5000 から上げ始める
    expect(valueOf(player, p, 5250)).toBeCloseTo(5, 12);
    expect(valueOf(player, p, 5500)).toBe(10);
  });

  it('periodic を外すと下げ、戻すと上げる。プロジェクトから消すとすぐ外す', () => {
    const a = steady('a');
    const player = createPeriodicPlayer();
    player.setActive(['a']);
    layerOf(player, project([a]), 0);
    expect(valueOf(player, project([a]), 500)).toBe(10);
    const off = project([{ ...a, periodic: false }]);
    expect(valueOf(player, off, 1000)).toBe(10); // ここから下げる
    expect(valueOf(player, off, 1250)).toBeCloseTo(5, 12);
    expect(layerOf(player, off, 1500)).toBeNull();
    expect(valueOf(player, project([a]), 2000)).toBe(0); // 戻すとまた上げる
    expect(valueOf(player, project([a]), 2500)).toBe(10);
    expect(layerOf(player, project([]), 2600)).toBeNull(); // 消えた
    expect(valueOf(player, project([a]), 2700)).toBe(0); // 戻すと最初から
  });

  it('シーンの切り替え（選び直し）: 両方にあるものは止めずに続け、外れたものは下げ、加わったものは上げる', () => {
    const breath = animation('breath', {
      duration: 4,
      tracks: [
        track('Breath', [
          [0, 0, 'smooth'],
          [2, 1, 'smooth'],
          [4, 0, 'smooth'],
        ]),
      ],
    });
    const p = project([breath, steady('a', 10), steady('b', -6)]);
    const player = createPeriodicPlayer();
    player.setActive(['breath', 'a']);
    layerOf(player, p, 0);
    expect(layerOf(player, p, 1000)!.values).toEqual({ Breath: 0.5, FaceAngleX: 10 });

    player.setActive(['b', 'breath']);
    expect(layerOf(player, p, 1000)!.values).toEqual({ Breath: 0.5, FaceAngleX: 10 }); // b は 0 から
    const mid = layerOf(player, p, 1250)!.values;
    expect(mid.FaceAngleX).toBeCloseTo(10 * 0.5 - 6 * 0.5, 12); // a は半分まで下がり、b は半分まで上がる
    expect(mid.Breath).toBeCloseTo(0.68359375, 12); // 呼吸はそのまま続く（1.25 秒の位置: smoothstep(0.625)）
    expect(layerOf(player, p, 2000)!.values).toEqual({ Breath: 1, FaceAngleX: -6 });
  });
});

describe('createPeriodicPlayer: フェード', () => {
  it(`開始は ${PERIODIC_FADE_SECONDS} 秒で 0 → 1 になめらかに上がる`, () => {
    const p = project([steady('a')]);
    const player = createPeriodicPlayer();
    player.setActive(['a']);
    const samples = [0, 50, 125, 250, 375, 450, 500, 800].map((t) => valueOf(player, p, 1000 + t));
    expect(samples[0]).toBe(0);
    expect(samples[2]).toBeCloseTo(10 * 0.15625, 12); // smoothstep(0.25)
    expect(samples[3]).toBeCloseTo(5, 12);
    expect(samples[4]).toBeCloseTo(10 * 0.84375, 12);
    expect(samples[6]).toBe(10);
    expect(samples[7]).toBe(10);
    for (let i = 1; i < samples.length; i++) expect(samples[i]!).toBeGreaterThanOrEqual(samples[i - 1]!);
    // 始めと終わりはゆっくり（なめらか）
    expect(samples[1]! - samples[0]!).toBeLessThan(samples[3]! - samples[2]!);
    expect(samples[6]! - samples[5]!).toBeLessThan(samples[3]! - samples[2]!);
  });

  it(`停止は ${PERIODIC_FADE_SECONDS} 秒で 1 → 0 になめらかに下がり、下がりきったら出さない`, () => {
    const p = project([steady('a')]);
    const player = createPeriodicPlayer();
    player.setActive(['a']);
    layerOf(player, p, 0);
    expect(valueOf(player, p, 1000)).toBe(10);
    player.setActive([]);
    expect(valueOf(player, p, 2000)).toBe(10); // ここから下げる
    expect(valueOf(player, p, 2125)).toBeCloseTo(10 * 0.84375, 12);
    expect(valueOf(player, p, 2250)).toBeCloseTo(5, 12);
    expect(valueOf(player, p, 2375)).toBeCloseTo(10 * 0.15625, 12);
    expect(layerOf(player, p, 2500)).toBeNull();
    expect(layerOf(player, p, 4000)).toBeNull();
  });

  it('フェードの途中で戻すと、そのときの強さから逆向きに進む（値が飛ばない）。ループの位置も続ける', () => {
    const p = project([sway()]);
    const player = createPeriodicPlayer();
    player.setActive(['sway']);
    layerOf(player, p, 0);
    // sway の 0.25 秒の値は 1.25、強さ 0.5（250ms）で 0.625
    expect(valueOf(player, p, 250)).toBeCloseTo(0.625, 12);
    player.setActive([]);
    expect(valueOf(player, p, 250)).toBeCloseTo(0.625, 12); // 飛ばない
    // 375ms: 強さ 0.25 → smoothstep 0.15625。sway は 0.375 秒の位置（1.875）
    expect(valueOf(player, p, 375)).toBeCloseTo(1.875 * 0.15625, 12);
    player.setActive(['sway']);
    expect(valueOf(player, p, 375)).toBeCloseTo(1.875 * 0.15625, 12);
    // 500ms: 強さ 0.25 → 0.5。sway は最初からではなく 0.5 秒の位置（2.5）
    expect(valueOf(player, p, 500)).toBeCloseTo(2.5 * 0.5, 12);
    expect(valueOf(player, p, 750)).toBe(3.75);
  });

  it('時刻が戻ったら、直前の強さとループの位置から、その時刻で続ける（値が飛ばない）', () => {
    const p = project([steady('a'), sway()]);
    const player = createPeriodicPlayer();
    player.setActive(['a']);
    layerOf(player, p, 10000);
    expect(valueOf(player, p, 10500)).toBe(10);
    expect(valueOf(player, p, 100)).toBe(10); // 上げ終わったまま
    player.setActive([]);
    layerOf(player, p, 5000); // ここから下げる
    expect(valueOf(player, p, 1000)).toBe(10); // 戻った時刻から下げ直す
    expect(valueOf(player, p, 1250)).toBeCloseTo(5, 12);

    const swaying = createPeriodicPlayer();
    swaying.setActive(['sway']);
    layerOf(swaying, p, 20000);
    expect(valueOf(swaying, p, 20750)).toBe(3.75); // 0.75 秒の位置
    expect(valueOf(swaying, p, 300)).toBe(3.75); // 戻っても同じ位置から
    expect(valueOf(swaying, p, 550)).toBe(5); // 1 秒の位置
  });
});

describe('ほかのレイヤーとの合成', () => {
  it('加算で重なり、アニメーションの再生中も止まらない（ループの位置も続く）。flags には影響されない', () => {
    const turn = animation('turn', {
      duration: 1,
      periodic: false,
      tracks: [track('FaceAngleX', [[0, -20]])],
      transition: {
        preset: 'custom',
        blendIn: 0,
        blendOut: 0,
        curve: 'linear',
        blendMode: 'override',
        keepLipSync: false,
        keepPhysics: false,
        returnToTracking: true,
      },
    });
    const p = project([sway(), turn, createStandardBreathAnimation()]);
    const animations: AnimationPlayer = createAnimationPlayer();
    const periodic = createPeriodicPlayer();
    periodic.setActive(['sway', STANDARD_BREATH_ANIMATION_ID]);
    const producers = [trackingProducer(() => ({ FaceAngleX: 10, Breath: 0 })), animations, periodic];
    frame(producers, p, 0);

    // トラッキング 10 に sway（0.5 秒の位置で 2.5）を足す
    expect(frame(producers, p, 500).params.FaceAngleX).toBe(12.5);
    animations.play('turn', 500);
    const during = frame(producers, p, 1000);
    // アニメーションが −20 に上書きし、その上に sway（1 秒の位置で 5）と呼吸（0.5）が足される
    expect(during.params.FaceAngleX).toBe(-15);
    expect(during.params.Breath).toBeCloseTo(0.5, 12);
    expect(during.seen.periodic).toEqual({ lipSyncWeight: 0, physicsActive: false });
    expect(frame(producers, p, 1250).params.FaceAngleX).toBeCloseTo(-20 + 3.75, 12);
    // アニメーションが終わるとトラッキングに戻り、sway は同じ位置のまま続いている（1.75 秒の位置で 1.25）
    expect(frame(producers, p, 1750).params.FaceAngleX).toBeCloseTo(11.25, 12);
    expect(frame(producers, p, 2000).params.Breath).toBe(1);
  });

  it('合成した結果はパラメータの範囲に収まる', () => {
    const p = project([steady('a', 30)]);
    const periodic = createPeriodicPlayer();
    periodic.setActive(['a']);
    const producers = [trackingProducer(() => ({ FaceAngleX: 25 })), periodic];
    frame(producers, p, 0);
    expect(frame(producers, p, 500).params.FaceAngleX).toBe(30);
  });
});

describe('標準の呼吸', () => {
  it('createStandardBreathAnimation: 周期アニメーションの「呼吸」（4 秒、Breath 0 → 1 → 0、なめらか）', () => {
    const a = createStandardBreathAnimation();
    expect(a).toMatchObject({
      id: STANDARD_BREATH_ANIMATION_ID,
      name: '呼吸',
      duration: 4,
      speed: 1,
      loop: true,
      periodic: true,
      affectedGroups: [],
    });
    expect(a.tracks).toEqual([
      {
        parameterId: 'Breath',
        keyframes: [
          { time: 0, value: 0, curve: 'smooth' },
          { time: 2, value: 1, curve: 'smooth' },
          { time: 4, value: 0, curve: 'smooth' },
        ],
      },
    ]);
    expect(createStandardBreathAnimation()).not.toBe(a); // 毎回新しいもの
  });

  it('withStandardBreathAnimation: 無ければ末尾に足す（シーンは変えない）。あれば同じ参照', () => {
    const other = steady('a');
    const p = project([other]);
    const out = withStandardBreathAnimation(p);
    expect(out.animations.map((a) => a.id)).toEqual(['a', STANDARD_BREATH_ANIMATION_ID]);
    expect(out.studio).toBe(p.studio);
    expect(p.animations).toEqual([other]); // 入力は書き換えない
    expect(withStandardBreathAnimation(out)).toBe(out);
    expect(() => validateProject(out)).not.toThrow(); // 保存できる形
  });

  it('自分で作った呼吸（Breath のキーフレームを持つ周期アニメーション）があれば足さない', () => {
    const own = animation('own', { tracks: [track('Breath', [[0, 0]])] });
    expect(hasBreathAnimation(project([own]))).toBe(true);
    expect(withStandardBreathAnimation(project([own])).animations).toEqual([own]);
    // 標準の呼吸は、周期アニメーションでなくしても・名前を変えても標準の呼吸
    const renamed = { ...createStandardBreathAnimation(), name: 'すう', periodic: false };
    expect(hasBreathAnimation(project([renamed]))).toBe(true);
    // 周期アニメーションでないもの・キーフレームの無いものは数えない
    expect(hasBreathAnimation(project([{ ...own, id: 'x', periodic: false }]))).toBe(false);
    expect(hasBreathAnimation(project([animation('y', { tracks: [track('Breath', [])] })]))).toBe(false);
  });
});
