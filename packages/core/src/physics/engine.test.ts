import { describe, expect, it } from 'vitest';
import { createEmptyProject, standardParametersFor, type Physics, type Project } from '@app/schema';
import type { FrameContext, Layer, ParamValues } from '@app/contracts';
import { createParameterMixer } from '../mix';
import {
  createPhysicsEngine,
  physicsAxesOf,
  physicsStrengthFactor,
  PHYSICS_DEFAULT_INPUTS,
  PHYSICS_MAX_STEPS,
  PHYSICS_STEP,
  type PhysicsEngineWithState,
} from './engine';

// 髪のプリセット（カード50の表）の値。strength 0 で spring・damping はそのまま
function hair(over: Partial<Physics> = {}): Physics {
  return {
    id: 'ph-hair',
    partId: 'part-hair',
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
    ...over,
  };
}

// STEP2 までの標準パラメータ（揺れものの HairFront・HairSide・HairBack を含む）を持つプロジェクト
function projectWith(physics: Physics[]): Project {
  const p = createEmptyProject('物理');
  return { ...p, model: { ...p.model, parameters: standardParametersFor('step2').map((x) => ({ ...x })) }, physics };
}

function ctx(project: Project, mixedSoFar: ParamValues, dt: number, physicsActive = true, now = 0): FrameContext {
  return { now, dt, project, mixedSoFar, flags: { lipSyncWeight: 1, physicsActive } };
}

interface Sample {
  t: number; // 秒
  v: number;
}

// 最初のフレーム（dt 0。スタジオの実行部と同じ）のあと、frames（ミリ秒の列）の間隔で input(t 秒) を渡して out の値を記録する
function run(
  engine: PhysicsEngineWithState,
  project: Project,
  frames: number[],
  input: (t: number) => ParamValues,
  out = 'HairFront',
  start = 0,
): Sample[] {
  let ms = start;
  const samples: Sample[] = [];
  for (const dt of [0, ...frames]) {
    ms += dt;
    const layer = engine.produce(ctx(project, input(ms / 1000), dt, true, ms));
    samples.push({ t: ms / 1000, v: layer?.values[out] ?? Number.NaN });
  }
  return samples;
}

const every = (ms: number, totalMs: number): number[] => Array.from({ length: Math.round(totalMs / ms) }, () => ms);
const smooth = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
const values = (samples: Sample[]) => samples.map((s) => s.v);
const between = (samples: Sample[], from: number, to: number) => samples.filter((s) => s.t >= from && s.t < to);
const maxAbs = (samples: Sample[]) => Math.max(...samples.map((s) => Math.abs(s.v)));

// 0.1 秒に FaceAngleX を 0 → 30 に急に動かす
const jump = (t: number): ParamValues => ({ FaceAngleX: t >= 0.1 ? 30 : 0 });
// 符号が変わるところの数
const signChanges = (samples: Sample[]) => {
  let n = 0;
  let sign = 0;
  for (const { v } of samples) {
    const s = Math.abs(v) < 1e-6 ? 0 : Math.sign(v);
    if (s !== 0 && sign !== 0 && s !== sign) n++;
    if (s !== 0) sign = s;
  }
  return n;
};
// 揺れの山（絶対値が極大になるところ）の絶対値
const peaks = (samples: Sample[]) => {
  const out: number[] = [];
  for (let i = 1; i + 1 < samples.length; i++) {
    const [a, b, c] = [samples[i - 1]!.v, samples[i]!.v, samples[i + 1]!.v].map(Math.abs) as [number, number, number];
    if (b > a && b >= c && b > 1e-4) out.push(b);
  }
  return out;
};

describe('createPhysicsEngine: 基本', () => {
  it('id は physics。物理の項目が無ければ null', () => {
    const engine = createPhysicsEngine();
    expect(engine.id).toBe('physics');
    expect(engine.produce(ctx(projectWith([]), {}, 16))).toBeNull();
  });

  it('止まっているときは出力パラメータに 0 を override・weight 1 で出す（項目ごとに1つのレイヤーにまとめる）', () => {
    const engine = createPhysicsEngine();
    const project = projectWith([hair(), hair({ id: 'ph-side', outputParameterId: 'HairSide', direction: 'both' })]);
    const layer = engine.produce(ctx(project, { FaceAngleX: 10 }, 0));
    expect(layer).toEqual({
      id: 'physics',
      weight: 1,
      values: { HairFront: 0, HairSide: 0 },
      blend: { HairFront: 'override', HairSide: 'override' },
    });
    expect(engine.produce(ctx(project, { FaceAngleX: 10 }, 16))!.values).toEqual({ HairFront: 0, HairSide: 0 });
  });

  it('出力パラメータがプロジェクトに無い項目は出さない（ほかの項目は出す）', () => {
    const engine = createPhysicsEngine();
    const project = projectWith([hair({ id: 'ph-x', outputParameterId: 'Sway_none' }), hair()]);
    expect(engine.produce(ctx(project, {}, 0))!.values).toEqual({ HairFront: 0 });
    expect(engine.pendulums('ph-x')).toBeNull();
    const only = projectWith([hair({ id: 'ph-x', outputParameterId: 'Sway_none' })]);
    expect(engine.produce(ctx(only, {}, 16))).toBeNull();
  });

  it('物理のレイヤーは、それまでのレイヤーの揺れパラメータの値を上書きする（合成）', () => {
    const engine = createPhysicsEngine();
    const project = projectWith([hair()]);
    run(engine, project, every(1000 / 60, 200), jump);
    const layer = engine.produce(ctx(project, { FaceAngleX: 30 }, 1000 / 60))!;
    const value = layer.values.HairFront!;
    expect(Math.abs(value)).toBeGreaterThan(0.1);
    const mixed = createParameterMixer().mix(project.model.parameters, [
      { id: 'animation', weight: 1, values: { HairFront: 0.9 } },
      layer,
    ]);
    expect(mixed.HairFront).toBeCloseTo(value, 12);
  });
});

describe('createPhysicsEngine: 完了条件', () => {
  it('入力を急に動かすと揺れて、ゆっくり止まる', () => {
    const engine = createPhysicsEngine();
    const samples = run(engine, projectWith([hair()]), every(1000 / 60, 5000), jump);
    // 動かす前は 0
    expect(between(samples, 0, 0.1).every((s) => s.v === 0)).toBe(true);
    // 根元が + へ動くと、先は遅れて − へ振れる
    const first = between(samples, 0.1, 0.4);
    expect(Math.min(...values(first))).toBeLessThan(-0.4);
    expect(first.find((s) => s.v !== 0)!.v).toBeLessThan(0);
    // 行ったり来たりしながら、山が小さくなっていく
    const swing = between(samples, 0.1, 5);
    expect(signChanges(swing)).toBeGreaterThanOrEqual(3);
    const ps = peaks(swing);
    expect(ps.length).toBeGreaterThanOrEqual(3);
    for (let i = 1; i < ps.length; i++) expect(ps[i]!).toBeLessThan(ps[i - 1]!);
    // すぐには止まらない（1 秒あとも揺れが残る）が、やがて止まる
    expect(maxAbs(between(samples, 1.1, 1.8))).toBeGreaterThan(0.02);
    expect(maxAbs(between(samples, 4, 5))).toBeLessThan(0.005);
  });

  it('range で頭打ちになる（出力は −1..1 を超えず、強く動かすと ±1 に張りつく）', () => {
    // inertia 5 で強く振る。0.2 秒で右へ向け、0.2 秒で左へ大きく向ける
    const shake = (t: number): ParamValues => ({
      FaceAngleX: 30 * smooth((t - 0.1) / 0.2) - 60 * smooth((t - 1) / 0.2),
    });
    const frames = every(1000 / 60, 3000);
    const samples = run(createPhysicsEngine(), projectWith([hair({ inertia: 5 })]), frames, shake);
    expect(maxAbs(samples)).toBeLessThanOrEqual(1);
    expect(Math.min(...values(samples))).toBe(-1);
    expect(Math.max(...values(samples))).toBe(1);
    expect(samples.filter((s) => s.v === -1).length).toBeGreaterThan(3); // 何フレームか張りつく
    expect(samples.filter((s) => s.v === 1).length).toBeGreaterThan(3);

    // range を半分にすると、θ は ±0.5 で止まり、出力はやはり −1..1
    const half = createPhysicsEngine();
    const halfProject = projectWith([hair({ inertia: 5, range: 0.5 })]);
    let minTheta = 0;
    let maxTheta = 0;
    let ms = 0;
    for (const dt of [0, ...frames]) {
      ms += dt;
      const layer = half.produce(ctx(halfProject, shake(ms / 1000), dt));
      expect(Math.abs(layer!.values.HairFront!)).toBeLessThanOrEqual(1);
      const theta = half.pendulums('ph-hair')!.horizontal!.theta;
      minTheta = Math.min(minTheta, theta);
      maxTheta = Math.max(maxTheta, theta);
    }
    expect(minTheta).toBe(-0.5);
    expect(maxTheta).toBe(0.5);

    // range が揺れより大きければ頭打ちにならない
    const wide = run(createPhysicsEngine(), projectWith([hair({ inertia: 5, range: 10 })]), frames, shake);
    expect(maxAbs(wide)).toBeLessThan(1);
    expect(maxAbs(wide)).toBeGreaterThan(0.1);
  });

  describe('フレームの時間が変わっても結果がほぼ同じ', () => {
    const total = 3000;
    let seed = 7;
    const random = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    const jitter: number[] = [];
    for (let ms = 0; ms < total;) {
      const dt = 4 + random() * 46; // 4〜50 ミリ秒
      jitter.push(dt);
      ms += dt;
    }
    const cases: Record<string, number[]> = {
      '30fps': every(1000 / 30, total),
      '60fps': every(1000 / 60, total),
      '75fps': every(1000 / 75, total),
      '120fps': every(1000 / 120, total),
      '144fps': every(1000 / 144, total),
      '240fps': every(1000 / 240, total),
      'ばらばら（4〜50ms）': jitter,
    };
    const project = projectWith([hair({ strength: 0.5 })]);

    // 1ms ごとのフレームで計算した結果と、各フレームの時刻で比べた差の最大
    function maxDiff(input: (t: number) => ParamValues, frames: number[]) {
      const reference = run(createPhysicsEngine(), project, every(1, total), input);
      const at = (t: number) => {
        const i = Math.min(reference.length - 1, Math.max(1, Math.ceil(t * 1000 - 1e-6)));
        const a = reference[i - 1]!;
        const b = reference[i]!;
        return a.v + ((b.v - a.v) * (t - a.t)) / (b.t - a.t);
      };
      const samples = run(createPhysicsEngine(), project, frames, input);
      return {
        diff: Math.max(...samples.filter((s) => s.t <= total / 1000).map((s) => Math.abs(s.v - at(s.t)))),
        size: maxAbs(reference),
      };
    }

    // 頭を右へ向けて（0.3 秒）、左へ大きく向ける（0.3 秒）。体は顔の 0.3 倍で追従する
    const turn = (t: number): ParamValues => {
      const face = 20 * smooth((t - 0.2) / 0.3) - 40 * smooth((t - 1.2) / 0.3);
      return { FaceAngleX: face, BodyAngleX: face * 0.3 };
    };
    // 同じ動きを 30Hz のトラッキングで受け取る（次の値が来るまで前の値のまま）
    const tracked = (t: number) => turn(Math.floor(t * 30 + 1e-9) / 30);

    for (const [name, frames] of Object.entries(cases)) {
      it(`なめらかな入力: ${name}（差 0.02 未満）`, () => {
        const { diff, size } = maxDiff(turn, frames);
        expect(size).toBeGreaterThan(0.4); // 十分に揺れている
        expect(diff).toBeLessThan(0.02);
      });
      // 30fps はトラッキングの値が来るフレームでそのまま当たるので、1ms のフレーム（段差の値を次の値まで持つ）より
      // 半フレーム（約 17ms）ほど早く揺れる。その分だけ許す差を大きくする
      const limit = name === '30fps' ? 0.08 : 0.04;
      it(`30Hz のトラッキング: ${name}（差 ${limit} 未満）`, () => {
        const { diff, size } = maxDiff(tracked, frames);
        expect(size).toBeGreaterThan(0.4);
        expect(diff).toBeLessThan(limit);
      });
    }
  });

  it('physicsActive が false の間は出さず（null）、状態は保つ。戻ると続きから揺れる', () => {
    const project = projectWith([hair()]);
    const frame = 1000 / 60;
    const paused = createPhysicsEngine();
    const steady = createPhysicsEngine();
    // 根元が止まってから 0.6 秒（入力の速度のならしは収まり、揺れは残っている）
    run(paused, project, every(frame, 700), jump);
    run(steady, project, every(frame, 700), jump);
    const before = paused.pendulums('ph-hair');
    const { theta, omega } = before!.horizontal!;
    expect(Math.abs(theta) + Math.abs(omega)).toBeGreaterThan(0.1);

    // 止めている間は null。入力が動いても状態は変わらない
    for (let i = 0; i < 30; i++) {
      expect(paused.produce(ctx(project, { FaceAngleX: i % 2 ? -30 : 10 }, frame, false))).toBeNull();
    }
    expect(paused.pendulums('ph-hair')).toEqual(before);

    // 戻ると、止めていた時間が無かったときと同じに続く（止めている間の入力の変化は揺れにしない）
    let moved = 0;
    for (let i = 0; i < 60; i++) {
      const a = paused.produce(ctx(project, { FaceAngleX: -30 }, frame))!.values.HairFront!;
      const b = steady.produce(ctx(project, { FaceAngleX: 30 }, frame))!.values.HairFront!;
      expect(a).toBeCloseTo(b, 6);
      moved = Math.max(moved, Math.abs(a));
    }
    expect(moved).toBeGreaterThan(0.02);
  });
});

describe('createPhysicsEngine: 運動', () => {
  it('strength は spring・damping を弱める（1 で × 0.6、0.5 で × 0.8）。揺れが大きく長くなる', () => {
    expect(physicsStrengthFactor(0)).toBe(1);
    expect(physicsStrengthFactor(1)).toBeCloseTo(0.6, 12);
    expect(physicsStrengthFactor(0.5)).toBeCloseTo(0.8, 12);
    expect(physicsStrengthFactor(2)).toBeCloseTo(0.6, 12);
    expect(physicsStrengthFactor(-1)).toBe(1);
    expect(physicsStrengthFactor(Number.NaN)).toBe(1);

    const frames = every(1000 / 60, 3000);
    const sim = (p: Partial<Physics>) => values(run(createPhysicsEngine(), projectWith([hair(p)]), frames, jump));
    const strong = sim({ strength: 1 });
    const weak = sim({ strength: 0 });
    sim({ strength: 0, spring: 18, damping: 2.4 }).forEach((v, i) => expect(strong[i]).toBeCloseTo(v, 12));
    const mid = sim({ strength: 0.5 });
    sim({ strength: 0, spring: 24, damping: 3.2 }).forEach((v, i) => expect(mid[i]).toBeCloseTo(v, 12));

    const late = (vs: number[]) => Math.max(...vs.slice(90).map(Math.abs)); // 1.4 秒より後
    expect(late(strong)).toBeGreaterThan(late(weak) * 1.5);
  });

  it('入力が無い項目の既定: 左右は FaceAngleX 0.7・BodyAngleX 0.3、上下は FaceAngleY 0.7', () => {
    expect(PHYSICS_DEFAULT_INPUTS).toEqual({
      horizontal: [
        { parameterId: 'FaceAngleX', weight: 0.7 },
        { parameterId: 'BodyAngleX', weight: 0.3 },
      ],
      vertical: [{ parameterId: 'FaceAngleY', weight: 0.7 }],
    });
    const frames = every(1000 / 60, 2000);
    const step =
      (id: string, to: number) =>
      (t: number): ParamValues => ({ [id]: t >= 0.1 ? to : 0 });
    // gravity 0 なら運動は線形なので、入力の大きさに比例する。値はパラメータの範囲で −1..1 に直す
    //（FaceAngleX は ±30、BodyAngleX は ±10）
    const linear = projectWith([hair({ gravity: 0 })]);
    const face = values(run(createPhysicsEngine(), linear, frames, step('FaceAngleX', 15)));
    const body = values(run(createPhysicsEngine(), linear, frames, step('BodyAngleX', 5)));
    expect(Math.max(...face.map(Math.abs))).toBeGreaterThan(0.1);
    face.forEach((v, i) => expect(body[i]! * 0.7).toBeCloseTo(v * 0.3, 12));
    // 左右の振り子は FaceAngleY では揺れない
    expect(maxAbs(run(createPhysicsEngine(), linear, frames, step('FaceAngleY', 30)))).toBe(0);

    // 上下は FaceAngleY で揺れ、FaceAngleX では揺れない
    const vertical = projectWith([hair({ direction: 'vertical' })]);
    expect(maxAbs(run(createPhysicsEngine(), vertical, frames, step('FaceAngleY', 30)))).toBeGreaterThan(0.1);
    expect(maxAbs(run(createPhysicsEngine(), vertical, frames, step('FaceAngleX', 30)))).toBe(0);
  });

  it('入力を指定した項目は既定を使わない。値はパラメータの範囲で −1..1 に直して weight を掛ける', () => {
    const frames = every(1000 / 60, 2000);
    const step =
      (id: string, to: number) =>
      (t: number): ParamValues => ({ [id]: t >= 0.1 ? to : 0 });
    const mouth = projectWith([hair({ inputs: [{ parameterId: 'MouthOpen', weight: 0.25 }] })]);
    expect(maxAbs(run(createPhysicsEngine(), mouth, frames, step('FaceAngleX', 30)))).toBe(0);
    const byMouth = values(run(createPhysicsEngine(), mouth, frames, step('MouthOpen', 1))); // 0..1 → Δ2 × 0.25
    const face = projectWith([hair({ inputs: [{ parameterId: 'FaceAngleX', weight: 1 }] })]);
    const byFace = values(run(createPhysicsEngine(), face, frames, step('FaceAngleX', 15))); // ±30 → Δ0.5 × 1
    expect(Math.max(...byMouth.map(Math.abs))).toBeGreaterThan(0.1);
    byFace.forEach((v, i) => expect(byMouth[i]).toBeCloseTo(v, 12));

    // 知らないパラメータの入力は使わない
    const unknown = projectWith([hair({ inputs: [{ parameterId: 'NoSuchParam', weight: 1 }] })]);
    const samples = run(createPhysicsEngine(), unknown, frames, step('NoSuchParam', 100));
    expect(samples.every((s) => s.v === 0)).toBe(true);
  });

  it('both は左右と上下の2つの振り子を持ち、出力は左右を使う', () => {
    expect(physicsAxesOf('horizontal')).toEqual(['horizontal']);
    expect(physicsAxesOf('vertical')).toEqual(['vertical']);
    expect(physicsAxesOf('both')).toEqual(['horizontal', 'vertical']);
    const frames = every(1000 / 60, 2000);
    const both = projectWith([hair({ direction: 'both' })]);

    // 上下の入力で上下の振り子は揺れるが、出力は変わらない
    const engine = createPhysicsEngine();
    const nod = run(engine, both, every(1000 / 60, 300), (t) => ({ FaceAngleY: t >= 0.1 ? 30 : 0 }));
    expect(nod.every((s) => s.v === 0)).toBe(true);
    const state = engine.pendulums('ph-hair')!;
    expect(state.horizontal).toEqual({ theta: 0, omega: 0 });
    expect(Math.abs(state.vertical!.theta)).toBeGreaterThan(0.05);

    // 左右の入力では horizontal の項目と同じ出力
    const a = values(run(createPhysicsEngine(), both, frames, jump));
    const b = values(run(createPhysicsEngine(), projectWith([hair()]), frames, jump));
    expect(a).toEqual(b);

    // 向きを変えると、使わなくなった振り子は消える
    engine.produce(ctx(projectWith([hair()]), { FaceAngleY: 30 }, 16));
    expect(engine.pendulums('ph-hair')!.vertical).toBeNull();
  });

  it('固定の 1/120 秒で積分する（刻みに満たない時間は次のフレームに持ち越す）', () => {
    expect(PHYSICS_STEP).toBeCloseTo(1 / 120, 15);
    const engine = createPhysicsEngine();
    const project = projectWith([hair()]);
    run(engine, project, every(1000 / 60, 200), jump);
    const start = engine.pendulums('ph-hair')!;
    const halfStep = (PHYSICS_STEP * 1000) / 2;
    engine.produce(ctx(project, { FaceAngleX: 30 }, halfStep));
    expect(engine.pendulums('ph-hair')).toEqual(start); // まだ積分しない
    engine.produce(ctx(project, { FaceAngleX: 30 }, halfStep));
    expect(engine.pendulums('ph-hair')).not.toEqual(start); // 合わせて1刻みになったので1回進む
  });

  it(`1フレームの積分は最大 ${PHYSICS_MAX_STEPS} 回（長いフレームはその分だけ進める）`, () => {
    const project = projectWith([hair()]);
    const longFrames = createPhysicsEngine();
    const maxFrames = createPhysicsEngine();
    run(longFrames, project, every(1000 / 60, 200), jump);
    run(maxFrames, project, every(1000 / 60, 200), jump);
    const maxMs = PHYSICS_MAX_STEPS * PHYSICS_STEP * 1000;
    for (let i = 0; i < 10; i++) {
      const input = { FaceAngleX: i % 3 === 0 ? -20 : 30 };
      const a = longFrames.produce(ctx(project, input, 1000))!.values.HairFront!;
      const b = maxFrames.produce(ctx(project, input, maxMs))!.values.HairFront!;
      expect(a).toBeCloseTo(b, 12);
      expect(longFrames.pendulums('ph-hair')).toEqual(maxFrames.pendulums('ph-hair'));
    }
  });

  it('reset() で全部を止める（次のフレームは 0。入力の違いを揺れにしない）', () => {
    const engine = createPhysicsEngine();
    const project = projectWith([hair()]);
    run(engine, project, every(1000 / 60, 300), jump);
    expect(engine.pendulums('ph-hair')!.horizontal!.theta).not.toBe(0);
    engine.reset();
    expect(engine.pendulums('ph-hair')).toBeNull();
    const after = run(engine, project, every(1000 / 60, 500), () => ({ FaceAngleX: -30 }));
    expect(after.every((s) => s.v === 0)).toBe(true);
  });

  it('入力の定義を変えたフレームは、入力の値の飛びを揺れにしない', () => {
    const engine = createPhysicsEngine();
    const frames = every(1000 / 60, 500);
    run(engine, projectWith([hair()]), frames, () => ({ FaceAngleX: 30 }));
    const changed = projectWith([hair({ inputs: [{ parameterId: 'FaceAngleX', weight: 2 }] })]);
    const after = run(engine, changed, frames, () => ({ FaceAngleX: 30 }));
    expect(after.every((s) => s.v === 0)).toBe(true);
    // 変えたあとも入力の動きでは揺れる
    expect(maxAbs(run(engine, changed, frames, (t) => ({ FaceAngleX: t >= 0.1 ? 0 : 30 })))).toBeGreaterThan(0.1);
  });

  it('動いている途中から計算を始めても、始めたことを揺れにしない', () => {
    const engine = createPhysicsEngine();
    // 一定の速さで動き続ける入力（加速度 0）
    const samples = run(engine, projectWith([hair()]), every(1000 / 60, 1000), (t) => ({ FaceAngleX: -30 + 40 * t }));
    expect(maxAbs(samples)).toBeLessThan(1e-9);
  });

  it('項目が無くなったら状態を捨て、戻ったら止まった状態から始める', () => {
    const engine = createPhysicsEngine();
    const project = projectWith([hair()]);
    run(engine, project, every(1000 / 60, 300), jump);
    expect(engine.produce(ctx(projectWith([]), {}, 16))).toBeNull();
    expect(engine.pendulums('ph-hair')).toBeNull();
    expect(engine.produce(ctx(project, { FaceAngleX: 30 }, 16))!.values.HairFront).toBe(0);
  });

  it('おかしな値でも数で −1..1 を返す（range 0 以下は 0、spring・damping の負と極端な値でも発散しない）', () => {
    const frames = every(1000 / 60, 2000);
    const cases: Partial<Physics>[] = [
      { range: 0 },
      { range: -1 },
      { range: Number.POSITIVE_INFINITY },
      { spring: -50, damping: -10 },
      { spring: 1e7, damping: 1e7 },
      { gravity: -100, inertia: 50 },
      { spring: Number.NaN, damping: Number.NaN, gravity: Number.NaN, inertia: Number.NaN, strength: Number.NaN },
      { inputs: [{ parameterId: 'FaceAngleX', weight: Number.NaN }] },
    ];
    for (const c of cases) {
      const samples = run(createPhysicsEngine(), projectWith([hair(c)]), frames, (t) => ({
        FaceAngleX: t < 0.1 ? 0 : t < 1 ? 30 : -30,
      }));
      for (const s of samples) {
        expect(Number.isFinite(s.v), JSON.stringify(c)).toBe(true);
        expect(Math.abs(s.v)).toBeLessThanOrEqual(1);
      }
      if (!(c.range === undefined || c.range > 0) || c.range === Number.POSITIVE_INFINITY) {
        expect(samples.every((s) => s.v === 0)).toBe(true);
      }
    }
    // dt が数でない・負のフレームは時間を進めない
    const engine = createPhysicsEngine();
    const project = projectWith([hair()]);
    run(engine, project, every(1000 / 60, 200), jump);
    const start = engine.pendulums('ph-hair');
    engine.produce(ctx(project, { FaceAngleX: 30 }, Number.NaN));
    engine.produce(ctx(project, { FaceAngleX: 30 }, -16));
    expect(engine.pendulums('ph-hair')).toEqual(start);
  });

  it('produce の戻り値は配列ではなく1つのレイヤー', () => {
    const engine = createPhysicsEngine();
    const r: Layer | Layer[] | null = engine.produce(ctx(projectWith([hair()]), {}, 0));
    expect(Array.isArray(r)).toBe(false);
  });
});
