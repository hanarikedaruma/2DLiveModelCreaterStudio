// 波形から音量（RMS の dBFS）を求める（カード37）。AudioSource が 10ms ごとの音量を出すのに使う

export const LEVEL_INTERVAL_MS = 10; // 音量を出す間隔
export const MIN_LEVEL_DB = -100; // 無音（0）のときの値。log(0) の -Infinity の代わりに使う

// 実効値を dBFS にする（1.0 が 0dBFS）。0・負・数でない値と、MIN_LEVEL_DB より小さい値は MIN_LEVEL_DB
export function rmsToDb(rms: number): number {
  if (!(rms > 0)) return MIN_LEVEL_DB;
  return Math.max(MIN_LEVEL_DB, 20 * Math.log10(rms));
}

// サンプル全体の実効値の dBFS
export function levelDbOf(samples: ArrayLike<number>): number {
  if (samples.length === 0) return MIN_LEVEL_DB;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) {
    const v = samples[i]!;
    sum += v * v;
  }
  return rmsToDb(Math.sqrt(sum / samples.length));
}

// 1回分（intervalMs）のサンプル数。少なくとも 1
export function levelWindowFrames(sampleRate: number, intervalMs = LEVEL_INTERVAL_MS): number {
  return Math.max(1, Math.round((sampleRate * intervalMs) / 1000));
}

export interface LevelMeter {
  // startFrame はこのサンプルの先頭の通し番号（音声の始まりから数えたサンプル数）。
  // 前の続きでなければ（途中が抜けたら）、途中まで貯めた分を捨てて startFrame から数え直す
  push(samples: Float32Array, startFrame: number): void;
  reset(): void;
}

// 届いたサンプルを intervalMs ごとに区切り、区切るたびに onLevel（音量と、区切りの終わりの通し番号）を呼ぶ。
// 届く長さはばらばらでよい（区切りをまたいでも、1回に何区切り分来てもよい）
export function createLevelMeter(o: {
  sampleRate: number;
  intervalMs?: number;
  onLevel: (rmsDb: number, endFrame: number) => void;
}): LevelMeter {
  const frames = levelWindowFrames(o.sampleRate, o.intervalMs);
  let sum = 0; // 今の区切りの 2 乗の和
  let count = 0; // 今の区切りに入れたサンプル数
  let nextFrame: number | null = null; // 次に届くはずの通し番号

  return {
    push(samples, startFrame) {
      if (nextFrame !== startFrame) {
        sum = 0;
        count = 0;
      }
      for (let i = 0; i < samples.length; i++) {
        const v = samples[i]!;
        sum += Number.isFinite(v) ? v * v : 0;
        count += 1;
        if (count === frames) {
          const rmsDb = rmsToDb(Math.sqrt(sum / frames));
          sum = 0;
          count = 0;
          o.onLevel(rmsDb, startFrame + i + 1);
        }
      }
      nextFrame = startFrame + samples.length;
    },
    reset() {
      sum = 0;
      count = 0;
      nextFrame = null;
    },
  };
}
