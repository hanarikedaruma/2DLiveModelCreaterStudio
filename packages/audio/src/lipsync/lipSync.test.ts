import { describe, expect, it } from 'vitest';
import { createEmptyProject } from '@app/schema';
import type { AudioLevel, FrameContext } from '@app/contracts';
import { createLevelMeter } from '../source/level';
import {
  LIP_SYNC_ATTACK_MS,
  LIP_SYNC_RELEASE_MS,
  createLipSyncProducer,
  mouthOpenFromLevel,
  smoothMouthOpen,
} from './lipSync';

const SAMPLE_RATE = 48000;

function ctx(lipSyncWeight = 1): FrameContext {
  return {
    now: 0,
    dt: 16,
    project: createEmptyProject('テスト'),
    mixedSoFar: {},
    flags: { lipSyncWeight, physicsActive: true },
  };
}

// 合成した音声のバッファ。区間ごとに実効値（dBFS、null は無音）と長さ（ミリ秒）を決めた 1kHz の正弦波
function synth(segments: { db: number | null; ms: number }[]): Float32Array {
  const total = segments.reduce((n, s) => n + Math.round((s.ms * SAMPLE_RATE) / 1000), 0);
  const out = new Float32Array(total);
  let i = 0;
  for (const s of segments) {
    const frames = Math.round((s.ms * SAMPLE_RATE) / 1000);
    const amplitude = s.db === null ? 0 : Math.SQRT2 * 10 ** (s.db / 20);
    for (let k = 0; k < frames; k++, i++) out[i] = amplitude * Math.sin((2 * Math.PI * 1000 * i) / SAMPLE_RATE);
  }
  return out;
}

// バッファを AudioWorklet と同じ 128 サンプルずつ音量の計算に通し、10ms ごとの音量を update に渡す。
// 音量を渡すたびの MouthOpen を返す
function run(producer: ReturnType<typeof createLipSyncProducer>, buffer: Float32Array, t0 = 0): number[] {
  const opens: number[] = [];
  const meter = createLevelMeter({
    sampleRate: SAMPLE_RATE,
    onLevel: (rmsDb, endFrame) => {
      producer.update({ time: t0 + (endFrame / SAMPLE_RATE) * 1000, rmsDb });
      opens.push(producer.produce(ctx()).values.MouthOpen!);
    },
  });
  for (let start = 0; start < buffer.length; start += 128) {
    meter.push(buffer.subarray(start, Math.min(buffer.length, start + 128)), start);
  }
  return opens;
}

// ならしきった値（十分に長く同じ音量を続けたあと）
const settled = (opens: number[]) => opens[opens.length - 1]!;

describe('mouthOpenFromLevel（音量 → 開き）', () => {
  it('しきい値以下は 0。そこから +30dB で 1 になる線形の写像', () => {
    expect(mouthOpenFromLevel(-60, -50, 'standard')).toBe(0);
    expect(mouthOpenFromLevel(-50, -50, 'standard')).toBe(0);
    expect(mouthOpenFromLevel(-35, -50, 'standard')).toBeCloseTo(0.5, 10);
    expect(mouthOpenFromLevel(-20, -50, 'standard')).toBeCloseTo(1, 10);
    expect(mouthOpenFromLevel(-5, -50, 'standard')).toBe(1); // 1 で止める
    expect(mouthOpenFromLevel(-30, -40, 'standard')).toBeCloseTo(1 / 3, 10); // しきい値を変えると写像もずれる
  });

  it('強さの倍率（控えめ 0.7・標準 1.0・大きめ 1.3）を掛けて 0..1 に丸める', () => {
    expect(mouthOpenFromLevel(-35, -50, 'low')).toBeCloseTo(0.35, 10);
    expect(mouthOpenFromLevel(-35, -50, 'high')).toBeCloseTo(0.65, 10);
    expect(mouthOpenFromLevel(-20, -50, 'low')).toBeCloseTo(0.7, 10); // 控えめは最大でも 0.7
    expect(mouthOpenFromLevel(-26, -50, 'high')).toBe(1); // 0.8 × 1.3 = 1.04 → 1
  });

  it('数でない音量・-Infinity は 0', () => {
    expect(mouthOpenFromLevel(Number.NaN, -50, 'standard')).toBe(0);
    expect(mouthOpenFromLevel(Number.NEGATIVE_INFINITY, -50, 'standard')).toBe(0);
  });
});

describe('smoothMouthOpen（ならし）', () => {
  it('開くときは時定数 30ms、閉じるときは 120ms で近づく', () => {
    expect(smoothMouthOpen(0, 1, LIP_SYNC_ATTACK_MS)).toBeCloseTo(1 - Math.exp(-1), 10);
    expect(smoothMouthOpen(1, 0, LIP_SYNC_RELEASE_MS)).toBeCloseTo(Math.exp(-1), 10);
    expect(smoothMouthOpen(1, 0, LIP_SYNC_ATTACK_MS)).toBeCloseTo(Math.exp(-30 / 120), 10);
  });

  it('経過 0・負・数でないときは変えない', () => {
    expect(smoothMouthOpen(0.4, 1, 0)).toBe(0.4);
    expect(smoothMouthOpen(0.4, 1, -10)).toBe(0.4);
    expect(smoothMouthOpen(0.4, 1, Number.NaN)).toBe(0.4);
  });
});

describe('createLipSyncProducer（合成した音声のバッファで）', () => {
  it('しきい値より小さい音・無音では口を開かない', () => {
    const producer = createLipSyncProducer();
    producer.configure({ mouthSource: 'max', strength: 'standard', silenceThresholdDb: -50 });
    const opens = run(
      producer,
      synth([
        { db: -55, ms: 300 },
        { db: null, ms: 200 },
      ]),
    );
    expect(opens).toHaveLength(50);
    expect(opens.every((v) => v === 0)).toBe(true);
  });

  it('しきい値を下げると、同じ音でも口が開く', () => {
    const producer = createLipSyncProducer();
    producer.configure({ mouthSource: 'max', strength: 'standard', silenceThresholdDb: -70 });
    expect(settled(run(producer, synth([{ db: -55, ms: 500 }])))).toBeCloseTo(0.5, 3); // -70 + 15dB
  });

  it('続けた音量に応じた開きに落ち着く（+15dB で 0.5、+30dB 以上で 1、強さで倍率）', () => {
    const cases = [
      { db: -35, strength: 'standard', open: 0.5 },
      { db: -20, strength: 'standard', open: 1 },
      { db: -10, strength: 'standard', open: 1 },
      { db: -35, strength: 'low', open: 0.35 },
      { db: -35, strength: 'high', open: 0.65 },
      { db: -20, strength: 'low', open: 0.7 },
    ] as const;
    for (const c of cases) {
      const producer = createLipSyncProducer();
      producer.configure({ mouthSource: 'max', strength: c.strength, silenceThresholdDb: -50 });
      expect(settled(run(producer, synth([{ db: c.db, ms: 500 }])))).toBeCloseTo(c.open, 3);
    }
  });

  it('立ち上がりは 30ms でならす（話し始めて 10ms で目標の 28%、30ms で 63%、90ms で 95%）', () => {
    const producer = createLipSyncProducer();
    producer.configure({ mouthSource: 'max', strength: 'standard', silenceThresholdDb: -50 });
    const opens = run(producer, synth([{ db: -20, ms: 200 }])); // 目標は 1
    expect(opens[0]).toBeCloseTo(1 - Math.exp(-10 / 30), 4);
    expect(opens[2]).toBeCloseTo(1 - Math.exp(-30 / 30), 4);
    expect(opens[8]).toBeCloseTo(1 - Math.exp(-90 / 30), 4);
    for (let i = 1; i < opens.length; i++) expect(opens[i]!).toBeGreaterThan(opens[i - 1]!); // 行き過ぎない
    expect(opens[opens.length - 1]!).toBeLessThanOrEqual(1);
  });

  it('戻りは 120ms でならす（黙って 120ms で開きの 37%、360ms で 5%）', () => {
    const producer = createLipSyncProducer();
    producer.configure({ mouthSource: 'max', strength: 'standard', silenceThresholdDb: -50 });
    const opens = run(
      producer,
      synth([
        { db: -20, ms: 500 },
        { db: null, ms: 400 },
      ]),
    );
    const peak = opens[49]!;
    expect(peak).toBeCloseTo(1, 4);
    expect(opens[50]).toBeCloseTo(peak * Math.exp(-10 / 120), 4);
    expect(opens[49 + 12]).toBeCloseTo(peak * Math.exp(-120 / 120), 4);
    expect(opens[49 + 36]).toBeCloseTo(peak * Math.exp(-360 / 120), 4);
    expect(opens[opens.length - 1]!).toBeLessThan(0.05);
  });

  it('話し声のように音節ごとに強弱をくり返すと、口も開いたり閉じたりする', () => {
    const producer = createLipSyncProducer();
    producer.configure({ mouthSource: 'max', strength: 'standard', silenceThresholdDb: -50 });
    const syllables = Array.from({ length: 4 }, () => [
      { db: -25, ms: 80 },
      { db: -45, ms: 70 },
    ]).flat();
    const opens = run(producer, synth(syllables));
    // 強い区間の終わりは大きく、弱い区間の終わりは小さい（毎回、上下する）
    for (let k = 0; k < 4; k++) {
      const loud = opens[k * 15 + 7]!;
      const quiet = opens[k * 15 + 14]!;
      expect(loud).toBeGreaterThan(0.75);
      expect(quiet).toBeLessThan(loud - 0.25);
    }
  });

  it('時刻が戻ったら経過 0 として数え直し、そのあとは普通にならす', () => {
    const producer = createLipSyncProducer();
    producer.configure({ mouthSource: 'max', strength: 'standard', silenceThresholdDb: -50 });
    const update = (time: number, rmsDb: number) => producer.update({ time, rmsDb } satisfies AudioLevel);
    update(1000, -20);
    const first = producer.mouthOpen();
    expect(first).toBeCloseTo(1 - Math.exp(-10 / 30), 10); // 最初の音量は 10ms 分とみなす
    update(500, -20); // 戻った
    expect(producer.mouthOpen()).toBe(first);
    update(510, -20);
    expect(producer.mouthOpen()).toBeGreaterThan(first);
    update(Number.NaN, -20); // 時刻が数でないときも 10ms 分
    expect(producer.mouthOpen()).toBeGreaterThan(first);
  });

  it('止めたあとの長い無音（-Infinity）で閉じる', () => {
    const producer = createLipSyncProducer();
    producer.configure({ mouthSource: 'max', strength: 'standard', silenceThresholdDb: -50 });
    run(producer, synth([{ db: -20, ms: 300 }]));
    producer.update({ time: 300 + 1000, rmsDb: Number.NEGATIVE_INFINITY });
    expect(producer.mouthOpen()).toBeLessThan(0.001);
  });
});

describe('createLipSyncProducer（レイヤー）', () => {
  function opened() {
    const producer = createLipSyncProducer();
    run(producer, synth([{ db: -35, ms: 500 }]));
    return producer;
  }

  it("id は 'lipSync'。音量が来る前は MouthOpen 0", () => {
    const producer = createLipSyncProducer();
    expect(producer.id).toBe('lipSync');
    expect(producer.produce(ctx())).toEqual({
      id: 'lipSync',
      weight: 1,
      values: { MouthOpen: 0 },
      blend: { MouthOpen: 'max' },
    });
  });

  it("mouthSource が 'max' なら blend max、'micOnly' なら override、'cameraOnly' なら weight 0", () => {
    const producer = opened(); // 既定は max・標準・-50dB
    expect(producer.produce(ctx())).toEqual({
      id: 'lipSync',
      weight: 1,
      values: { MouthOpen: expect.closeTo(0.5, 3) },
      blend: { MouthOpen: 'max' },
    });
    producer.configure({ mouthSource: 'micOnly', strength: 'standard', silenceThresholdDb: -50 });
    expect(producer.produce(ctx())).toMatchObject({ weight: 1, blend: { MouthOpen: 'override' } });
    producer.configure({ mouthSource: 'cameraOnly', strength: 'standard', silenceThresholdDb: -50 });
    expect(producer.produce(ctx()).weight).toBe(0);
  });

  it('weight に ctx.flags.lipSyncWeight を掛ける（0..1 に丸める）', () => {
    const producer = opened();
    expect(producer.produce(ctx(0.25)).weight).toBe(0.25);
    expect(producer.produce(ctx(0)).weight).toBe(0);
    expect(producer.produce(ctx(2)).weight).toBe(1);
    expect(producer.produce(ctx(Number.NaN)).weight).toBe(0);
    producer.configure({ mouthSource: 'micOnly', strength: 'standard', silenceThresholdDb: -50 });
    expect(producer.produce(ctx(0.5)).weight).toBe(0.5);
  });

  it('おかしな設定の値は前の値のまま', () => {
    const producer = createLipSyncProducer();
    producer.configure({ mouthSource: 'micOnly', strength: 'high', silenceThresholdDb: -60 });
    producer.configure({
      mouthSource: 'both' as never,
      strength: 'huge' as never,
      silenceThresholdDb: Number.NaN,
    });
    producer.update({ time: 0, rmsDb: -45 }); // -60 + 15dB → 0.5 × 1.3 = 0.65 が目標
    expect(producer.mouthOpen()).toBeCloseTo(0.65 * (1 - Math.exp(-10 / 30)), 10);
    expect(producer.produce(ctx()).blend).toEqual({ MouthOpen: 'override' });
  });
});
