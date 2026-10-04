import { describe, expect, it } from 'vitest';
import { MIN_LEVEL_DB, createLevelMeter, levelDbOf, levelWindowFrames, rmsToDb } from './level';

// 実効値が db（dBFS）の正弦波。1kHz は 48kHz で 48 サンプルごとに繰り返すので、10ms（480）に周期がちょうど入る
function sine(db: number, frames: number, sampleRate = 48000, hz = 1000, startFrame = 0): Float32Array {
  const amplitude = Math.SQRT2 * 10 ** (db / 20);
  const out = new Float32Array(frames);
  for (let i = 0; i < frames; i++) out[i] = amplitude * Math.sin((2 * Math.PI * hz * (startFrame + i)) / sampleRate);
  return out;
}

describe('rmsToDb・levelDbOf', () => {
  it('実効値 1 が 0dBFS、0.1 が -20dBFS、0.01 が -40dBFS', () => {
    expect(rmsToDb(1)).toBe(0);
    expect(rmsToDb(0.1)).toBeCloseTo(-20, 10);
    expect(rmsToDb(0.01)).toBeCloseTo(-40, 10);
  });

  it('0・負・数でない値・とても小さい値は MIN_LEVEL_DB（-Infinity にしない）', () => {
    expect(rmsToDb(0)).toBe(MIN_LEVEL_DB);
    expect(rmsToDb(-1)).toBe(MIN_LEVEL_DB);
    expect(rmsToDb(Number.NaN)).toBe(MIN_LEVEL_DB);
    expect(rmsToDb(1e-9)).toBe(MIN_LEVEL_DB);
    expect(levelDbOf(new Float32Array(480))).toBe(MIN_LEVEL_DB);
    expect(levelDbOf(new Float32Array(0))).toBe(MIN_LEVEL_DB);
  });

  it('正弦波の音量は実効値で測る（振幅 1 の正弦波は約 -3dBFS）', () => {
    expect(levelDbOf(sine(-20, 480))).toBeCloseTo(-20, 3);
    expect(levelDbOf(sine(-3.0103, 4800))).toBeCloseTo(-3.0103, 3);
  });
});

describe('levelWindowFrames', () => {
  it('10ms のサンプル数（48kHz で 480、44.1kHz で 441）', () => {
    expect(levelWindowFrames(48000)).toBe(480);
    expect(levelWindowFrames(44100)).toBe(441);
    expect(levelWindowFrames(16000, 20)).toBe(320);
    expect(levelWindowFrames(10, 1)).toBe(1);
  });
});

describe('createLevelMeter', () => {
  function collect(sampleRate = 48000) {
    const levels: { rmsDb: number; endFrame: number }[] = [];
    const meter = createLevelMeter({ sampleRate, onLevel: (rmsDb, endFrame) => levels.push({ rmsDb, endFrame }) });
    return { meter, levels };
  }

  it('10ms ごとに区切って音量を出す。区切りの終わりの通し番号を添える', () => {
    const { meter, levels } = collect();
    const buffer = new Float32Array(1440);
    buffer.set(sine(-20, 480), 0);
    buffer.set(sine(-40, 480, 48000, 1000, 480), 480);
    // 最後の 10ms は無音
    meter.push(buffer, 0);
    expect(levels.map((l) => l.endFrame)).toEqual([480, 960, 1440]);
    expect(levels[0]!.rmsDb).toBeCloseTo(-20, 3);
    expect(levels[1]!.rmsDb).toBeCloseTo(-40, 3);
    expect(levels[2]!.rmsDb).toBe(MIN_LEVEL_DB);
  });

  it('届く長さがばらばらでも、区切りは通し番号で決まる（AudioWorklet の 128 ずつでも同じ結果）', () => {
    const signal = sine(-30, 4800);
    const whole = collect();
    whole.meter.push(signal, 0);
    const pieces = collect();
    for (let start = 0; start < signal.length; start += 128) {
      pieces.meter.push(signal.subarray(start, Math.min(signal.length, start + 128)), start);
    }
    expect(pieces.levels).toHaveLength(10);
    expect(pieces.levels.map((l) => l.endFrame)).toEqual(whole.levels.map((l) => l.endFrame));
    pieces.levels.forEach((l, i) => expect(l.rmsDb).toBeCloseTo(whole.levels[i]!.rmsDb, 6));
  });

  it('途中が抜けたら貯めた分を捨てて、届いた位置から数え直す', () => {
    const { meter, levels } = collect();
    meter.push(sine(-20, 300), 0); // 300 まで貯める
    meter.push(sine(-40, 480, 48000, 1000, 1000), 1000); // 300〜999 が抜けた
    expect(levels).toHaveLength(1);
    expect(levels[0]!.endFrame).toBe(1480);
    expect(levels[0]!.rmsDb).toBeCloseTo(-40, 3); // 抜ける前の -20dB は混ざらない
  });

  it('reset で貯めた分を捨てる。44.1kHz では 441 サンプルごと', () => {
    const { meter, levels } = collect(44100);
    meter.push(new Float32Array(400).fill(0.5), 0);
    meter.reset();
    meter.push(new Float32Array(441).fill(0.1), 400);
    expect(levels).toEqual([{ rmsDb: expect.closeTo(-20, 5), endFrame: 841 }]);
  });

  it('数でないサンプルは 0 として数える', () => {
    const { meter, levels } = collect();
    const buffer = new Float32Array(480).fill(0.1);
    buffer[0] = Number.NaN;
    buffer[1] = Number.POSITIVE_INFINITY;
    meter.push(buffer, 0);
    expect(Number.isFinite(levels[0]!.rmsDb)).toBe(true);
    expect(levels[0]!.rmsDb).toBeCloseTo(20 * Math.log10(0.1 * Math.sqrt(478 / 480)), 5);
  });
});
