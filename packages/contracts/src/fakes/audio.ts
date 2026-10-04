import type { AudioLevel, AudioSource, FrameContext, Layer, LipSyncProducer } from '../index';

const LEVEL_INTERVAL = 10; // ミリ秒
const SAMPLE_RATE = 48000;
const SAMPLES_PER_TICK = (SAMPLE_RATE * LEVEL_INTERVAL) / 1000;
const TALK_CYCLE = 1000; // 1秒ごとに
const TALK_DURATION = 600; // 0.6秒話して 0.4秒黙る
const SYLLABLE_PERIOD = 150; // 音節の強弱の周期
export const FAKE_SILENCE_DB = -70;

// 開始からの経過時間 t（ミリ秒）のときの音量（dBFS）。話している間は -30〜-18、黙っている間は -70
export function fakeAudioLevel(t: number): number {
  const phase = t % TALK_CYCLE;
  if (phase >= TALK_DURATION) return FAKE_SILENCE_DB;
  return -30 + 12 * Math.abs(Math.sin((Math.PI * phase) / SYLLABLE_PERIOD));
}

// 10ms ごとに、一定間隔で話している音量と、その音量の正弦波のサンプルを出す
export class FakeAudioSource implements AudioSource {
  private timer: ReturnType<typeof setInterval> | null = null;
  private startedAt = 0;
  private readonly levelListeners = new Set<(x: AudioLevel) => void>();
  private readonly sampleListeners = new Set<(samples: Float32Array, sampleRate: number, time: number) => void>();

  constructor(private readonly clock: () => number = () => performance.now()) {}

  async listDevices(): Promise<{ id: string; label: string }[]> {
    return [{ id: 'fake-microphone', label: '仮のマイク' }];
  }

  async start(_deviceId?: string): Promise<void> {
    this.stop();
    this.startedAt = this.clock();
    this.timer = setInterval(() => this.emit(this.clock()), LEVEL_INTERVAL);
  }

  stop(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }

  onLevel(listener: (x: AudioLevel) => void): () => void {
    this.levelListeners.add(listener);
    return () => {
      this.levelListeners.delete(listener);
    };
  }

  onSamples(listener: (samples: Float32Array, sampleRate: number, time: number) => void): () => void {
    this.sampleListeners.add(listener);
    return () => {
      this.sampleListeners.delete(listener);
    };
  }

  private emit(now: number): void {
    const t = now - this.startedAt;
    const rmsDb = fakeAudioLevel(t);
    for (const l of [...this.levelListeners]) l({ time: now, rmsDb });
    if (this.sampleListeners.size === 0) return;
    // 実効値が rmsDb になる 220Hz の正弦波
    const amplitude = Math.SQRT2 * 10 ** (rmsDb / 20);
    const samples = new Float32Array(SAMPLES_PER_TICK);
    const start = (t / 1000) * SAMPLE_RATE;
    for (let i = 0; i < samples.length; i++) {
      samples[i] = amplitude * Math.sin((2 * Math.PI * 220 * (start + i)) / SAMPLE_RATE);
    }
    for (const l of [...this.sampleListeners]) l(samples, SAMPLE_RATE, now);
  }
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

// 音量をそのまま MouthOpen にする（無音のしきい値で 0、0dBFS で 1。スムージングなし）。
// mouthSource が max ならカメラの口と大きいほう、micOnly なら上書き、cameraOnly なら何も出さない
export class FakeLipSync implements LipSyncProducer {
  readonly id = 'lipSync' as const;
  private config: Parameters<LipSyncProducer['configure']>[0] = {
    mouthSource: 'max',
    strength: 'standard',
    silenceThresholdDb: -50,
  };
  private level: AudioLevel | null = null;

  configure(o: Parameters<LipSyncProducer['configure']>[0]): void {
    this.config = { ...o };
  }

  update(level: AudioLevel): void {
    this.level = level;
  }

  produce(ctx: FrameContext): Layer | null {
    if (this.config.mouthSource === 'cameraOnly' || !this.level) return null;
    const threshold = this.config.silenceThresholdDb;
    const open = clamp01((this.level.rmsDb - threshold) / Math.max(1, -threshold));
    return {
      id: 'lipSync',
      weight: ctx.flags.lipSyncWeight,
      values: { MouthOpen: open },
      blend: { MouthOpen: this.config.mouthSource === 'max' ? 'max' : 'override' },
    };
  }
}
