import { describe, expect, it, vi } from 'vitest';
import type { AutoBlink } from '@app/contracts';
import {
  BLINK_CLOSE_MS,
  BLINK_DURATION_MS,
  BLINK_HOLD_MS,
  BLINK_OPEN_MS,
  blinkEase,
  blinkOpenness,
  createAutoBlink,
} from './autoBlink';

// 決まった値を順に返す乱数（尽きたら最後の値をくり返す）
function sequence(...values: number[]): () => number {
  let i = 0;
  return () => values[Math.min(i++, values.length - 1)]!;
}

// 種から決まる一様乱数（mulberry32）
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// from から to まで step ミリ秒ごとに tick し、目が閉じきった（0 になった）時刻を集める
function closedTimes(blink: AutoBlink, from: number, to: number, step = 1): number[] {
  const out: number[] = [];
  let prev = 1;
  for (let t = from; t <= to; t += step) {
    const v = blink.tick(t).EyeOpenL;
    if (v === 0 && prev !== 0) out.push(t);
    prev = v;
  }
  return out;
}

describe('createAutoBlink: 間隔', () => {
  it('間隔は 2〜6秒の一様乱数（乱数 0 → 2秒、0.25 → 3秒、0.5 → 4秒、0.75 → 5秒）', () => {
    const blink = createAutoBlink(sequence(0, 0.75, 0.25, 0.5));
    // 最初の tick（0）から数える。閉じきるのはまばたきの始まりから 80ms 後
    const starts = closedTimes(blink, 0, 15_000).map((t) => t - BLINK_CLOSE_MS);
    expect(starts).toEqual([2000, 7000, 10_000, 14_000]);
  });

  it('乱数が 1 に近いと 6秒近く空く', () => {
    const blink = createAutoBlink(sequence(0.999999));
    blink.tick(0);
    expect(blink.tick(5999).EyeOpenL).toBe(1);
    expect(blink.tick(6000 + BLINK_CLOSE_MS).EyeOpenL).toBe(0);
  });

  it('乱数の範囲の外や NaN は 0..1 に丸める（NaN は真ん中）', () => {
    const starts = (r: number) => {
      const blink = createAutoBlink(sequence(r));
      return closedTimes(blink, 0, 7000)[0]! - BLINK_CLOSE_MS;
    };
    expect(starts(-1)).toBe(2000);
    expect(starts(2)).toBe(6000);
    expect(starts(Number.NaN)).toBe(4000);
  });

  it('乱数を固定すると、間隔はすべて 2〜6秒で平均はおよそ 4秒', () => {
    const blink = createAutoBlink(seeded(36));
    const starts = closedTimes(blink, 0, 800_000, 10);
    const gaps = starts.slice(1).map((t, i) => t - starts[i]!);
    expect(gaps.length).toBeGreaterThan(150);
    // 10ms ごとに見ているので、その分の誤差を許す
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(2000 - 10);
    expect(Math.max(...gaps)).toBeLessThanOrEqual(6000 + 10);
    const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
    expect(mean).toBeGreaterThan(3800);
    expect(mean).toBeLessThan(4200);
    // 2〜4秒と 4〜6秒がどちらも同じくらい出る（一様）
    const short = gaps.filter((g) => g < 4000).length;
    expect(short / gaps.length).toBeGreaterThan(0.4);
    expect(short / gaps.length).toBeLessThan(0.6);
  });

  it('乱数は間隔を決めるときだけ使う（1回のまばたきに1つ）', () => {
    const random = vi.fn(() => 0.5);
    const blink = createAutoBlink(random);
    for (let t = 0; t <= 12_300; t += 5) blink.tick(t);
    // 最初の予定（4000）と、まばたきが終わるたびの次の予定（8000・12000・16000）
    expect(random).toHaveBeenCalledTimes(4);
  });
});

describe('createAutoBlink: 形', () => {
  it('閉じる 80ms → 閉じたまま 40ms → 開く 120ms。前後は 1', () => {
    const blink = createAutoBlink(() => 0.5); // 4000 から始まる
    const at = (t: number) => blink.tick(t).EyeOpenL;
    expect(at(0)).toBe(1);
    expect(at(3999)).toBe(1);
    expect(at(4000)).toBe(1); // 閉じ始め
    expect(at(4040)).toBeCloseTo(0.5, 10); // 閉じる途中の真ん中
    expect(at(4080)).toBe(0); // 閉じきる
    expect(at(4100)).toBe(0);
    expect(at(4119)).toBe(0);
    expect(at(4120)).toBe(0); // 開き始め
    expect(at(4180)).toBeCloseTo(0.5, 10); // 開く途中の真ん中
    expect(at(4239)).toBeGreaterThan(0.99);
    expect(at(4240)).toBe(1); // 開ききる
    expect(at(7999)).toBe(1);
    expect(at(8080)).toBe(0); // 次のまばたき（4秒後）
  });

  it('左右は同時', () => {
    const blink = createAutoBlink(seeded(7));
    for (let t = 0; t < 20_000; t += 3) {
      const v = blink.tick(t);
      expect(v.EyeOpenR).toBe(v.EyeOpenL);
    }
  });

  it('閉じる・開くは ease-in-out（始めと終わりがゆっくりで、途中は単調）', () => {
    // 閉じる: 10% の時点ではほとんど開いたまま、90% の時点ではほとんど閉じている
    expect(blinkOpenness(BLINK_CLOSE_MS * 0.1)).toBeGreaterThan(0.95);
    expect(blinkOpenness(BLINK_CLOSE_MS * 0.9)).toBeLessThan(0.05);
    // 開く: 10% の時点ではほとんど閉じたまま、90% の時点ではほとんど開いている
    const opening = BLINK_CLOSE_MS + BLINK_HOLD_MS;
    expect(blinkOpenness(opening + BLINK_OPEN_MS * 0.1)).toBeLessThan(0.05);
    expect(blinkOpenness(opening + BLINK_OPEN_MS * 0.9)).toBeGreaterThan(0.95);
    // 単調で 0..1 に収まる
    let prev = 1;
    for (let t = 0; t <= opening; t += 0.5) {
      const v = blinkOpenness(t);
      expect(v).toBeLessThanOrEqual(prev);
      expect(v).toBeGreaterThanOrEqual(0);
      prev = v;
    }
    for (let t = opening; t <= BLINK_DURATION_MS; t += 0.5) {
      const v = blinkOpenness(t);
      expect(v).toBeGreaterThanOrEqual(prev);
      expect(v).toBeLessThanOrEqual(1);
      prev = v;
    }
    expect(blinkEase(0)).toBe(0);
    expect(blinkEase(0.5)).toBe(0.5);
    expect(blinkEase(1)).toBe(1);
    expect(BLINK_DURATION_MS).toBe(240);
  });
});

describe('createAutoBlink: 時刻の飛び', () => {
  it('長く呼ばれずにまばたきを通り過ぎたら、その時刻から数え直す（まとめて何回もまばたきしない）', () => {
    const blink = createAutoBlink(() => 0.5);
    blink.tick(0); // 4000 に予定
    expect(blink.tick(100_000).EyeOpenL).toBe(1);
    expect(blink.tick(103_999).EyeOpenL).toBe(1);
    expect(blink.tick(104_000 + BLINK_CLOSE_MS).EyeOpenL).toBe(0);
  });

  it('時刻が戻ったら、その時刻から数え直す', () => {
    const blink = createAutoBlink(() => 0.5);
    blink.tick(50_000); // 54000 に予定
    expect(blink.tick(1000).EyeOpenL).toBe(1); // 5000 に予定し直す
    expect(blink.tick(5000 + BLINK_CLOSE_MS).EyeOpenL).toBe(0);
  });

  it('数でない時刻は開いたまま', () => {
    const blink = createAutoBlink(() => 0.5);
    expect(blink.tick(Number.NaN)).toEqual({ EyeOpenL: 1, EyeOpenR: 1 });
    expect(blink.tick(Number.POSITIVE_INFINITY)).toEqual({ EyeOpenL: 1, EyeOpenR: 1 });
    expect(blink.tick(0)).toEqual({ EyeOpenL: 1, EyeOpenR: 1 });
    expect(blink.tick(4080)).toEqual({ EyeOpenL: 0, EyeOpenR: 0 });
  });
});
