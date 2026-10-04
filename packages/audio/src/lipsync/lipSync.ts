// 音量のリップシンク（カード37）。マイクの音量を口の開き（MouthOpen）にする。
// 無音のしきい値以下は 0、そこから +30dB で 1 になる線形の写像に強さの倍率を掛け、0..1 に丸める。
// 開くときは時定数 30ms、閉じるときは 120ms でならす（10ms ごとの音量のたびに 1 - exp(-経過 / 時定数) だけ近づける）
import type { AudioLevel, AudioSource, FrameContext, Layer, LipSyncProducer, VowelEstimator } from '@app/contracts';
import { createVowelSampler } from '../vowel/sampler';
import { VOWEL_IDS } from '../vowel/vowel';

export type LipSyncConfig = Parameters<LipSyncProducer['configure']>[0];
export type LipSyncStrength = LipSyncConfig['strength'];
export type MouthSource = LipSyncConfig['mouthSource'];

export const LIP_SYNC_RANGE_DB = 30; // しきい値からこれだけ大きいと開き 1
export const LIP_SYNC_STRENGTH_RATES: Record<LipSyncStrength, number> = { low: 0.7, standard: 1.0, high: 1.3 };
export const LIP_SYNC_ATTACK_MS = 30; // 開くときの時定数
export const LIP_SYNC_RELEASE_MS = 120; // 閉じるときの時定数
export const DEFAULT_LIP_SYNC_CONFIG: LipSyncConfig = {
  mouthSource: 'max',
  strength: 'standard',
  silenceThresholdDb: -50, // Environment.silenceThreshold の既定値と同じ
};
const NOMINAL_INTERVAL_MS = 10; // 最初の音量は、AudioSource の間隔の分だけたったとみなす

const MOUTH_SOURCES: readonly MouthSource[] = ['max', 'micOnly', 'cameraOnly'];

const clamp01 = (v: number) => (v > 1 ? 1 : v > 0 ? v : 0); // NaN は 0

// 音量（dBFS）→ 口の開き（0..1）。ならす前の目標の値
export function mouthOpenFromLevel(rmsDb: number, silenceThresholdDb: number, strength: LipSyncStrength): number {
  if (!(rmsDb > silenceThresholdDb)) return 0;
  const rate = LIP_SYNC_STRENGTH_RATES[strength] ?? LIP_SYNC_STRENGTH_RATES.standard;
  return clamp01(((rmsDb - silenceThresholdDb) / LIP_SYNC_RANGE_DB) * rate);
}

// current から target へ dtMs ミリ秒分だけ近づける（開くときは LIP_SYNC_ATTACK_MS、閉じるときは LIP_SYNC_RELEASE_MS）
export function smoothMouthOpen(current: number, target: number, dtMs: number): number {
  if (!(dtMs > 0) || target === current) return current;
  const tau = target > current ? LIP_SYNC_ATTACK_MS : LIP_SYNC_RELEASE_MS;
  return current + (target - current) * (1 - Math.exp(-dtMs / tau));
}

export interface AudioLipSyncProducer extends LipSyncProducer {
  produce(ctx: FrameContext): Layer; // 音量が来る前も含めて、いつもレイヤーを返す
  mouthOpen(): number; // ならしたあとの今の開き（0..1）
  vowelFrameTime(): number | null; // 最後の描画に使った母音の窓の先頭（計測用）
}

// MouthOpen を出すレイヤー。blend は mouthSource が max なら max（カメラの口と大きい方）、micOnly なら override、
// cameraOnly なら weight 0（何もしない）。weight には ctx.flags.lipSyncWeight を掛ける（アニメーションが止めるときに使う）
export function createLipSyncProducer(options?: {
  audio: Pick<AudioSource, 'onSamples'>;
  vowels: VowelEstimator;
}): AudioLipSyncProducer {
  let config: LipSyncConfig = { ...DEFAULT_LIP_SYNC_CONFIG };
  let open = 0;
  let lastTime: number | null = null;
  let vowelTime: number | null = null;
  const sampler = options ? createVowelSampler(options.vowels) : null;
  if (sampler) options!.audio.onSamples(sampler.update);

  return {
    id: 'lipSync',
    configure(o) {
      config = {
        mouthSource: MOUTH_SOURCES.includes(o.mouthSource) ? o.mouthSource : config.mouthSource,
        strength: Object.hasOwn(LIP_SYNC_STRENGTH_RATES, o.strength) ? o.strength : config.strength,
        silenceThresholdDb: Number.isFinite(o.silenceThresholdDb) ? o.silenceThresholdDb : config.silenceThresholdDb,
      };
    },
    update(level: AudioLevel) {
      if (!(level.rmsDb > config.silenceThresholdDb)) sampler?.clear();
      const target = mouthOpenFromLevel(level.rmsDb, config.silenceThresholdDb, config.strength);
      if (!Number.isFinite(level.time)) {
        open = smoothMouthOpen(open, target, NOMINAL_INTERVAL_MS);
        return;
      }
      // 時刻が戻ったとき（音声を開き直したときなど）は経過 0 とみなし、そこから数え直す
      const dt = lastTime === null ? NOMINAL_INTERVAL_MS : Math.max(0, level.time - lastTime);
      lastTime = level.time;
      open = smoothMouthOpen(open, target, dt);
    },
    produce(ctx: FrameContext): Layer {
      const { mouthSource } = config;
      const weight = mouthSource === 'cameraOnly' ? 0 : clamp01(ctx.flags.lipSyncWeight);
      const values: Record<string, number> = { MouthOpen: open };
      const blend: NonNullable<Layer['blend']> = { MouthOpen: mouthSource === 'max' ? 'max' : 'override' };
      const probabilities = sampler?.current(ctx.now);
      vowelTime = null;
      if (probabilities && ctx.project.model.lipSync.vowels.length > 0) {
        if (weight > 0) vowelTime = sampler!.frameTime();
        for (const id of ['MouthOpen', 'MouthForm', 'MouthWidth']) {
          const parameter = ctx.project.model.parameters.find((p) => p.id === id);
          if (!parameter) continue;
          let value = 0;
          for (const vowel of VOWEL_IDS) {
            const registered = ctx.project.model.lipSync.vowels.find((v) => v.vowel === vowel)?.values[id];
            const fallback = id === 'MouthOpen' ? open : (ctx.mixedSoFar[id] ?? parameter.default);
            value +=
              probabilities[vowel] * (registered !== undefined && Number.isFinite(registered) ? registered : fallback);
          }
          value = Math.min(parameter.max, Math.max(parameter.min, value));
          if (id === 'MouthOpen') values[id] = Math.min(open, value);
          else {
            // パラメータ別の重みを値に折り込む。外側の weight はアニメーションによる抑制だけ。
            const before = ctx.mixedSoFar[id] ?? parameter.default;
            values[id] = before + (value - before) * open;
            blend[id] = 'override';
          }
        }
      }
      return {
        id: 'lipSync',
        weight,
        values,
        blend,
      };
    },
    mouthOpen: () => open,
    vowelFrameTime: () => vowelTime,
  };
}
