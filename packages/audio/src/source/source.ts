// マイクの音声（カード37）。getUserMedia → AudioWorklet で波形を受け取り、10ms ごとに音量（RMS の dBFS）を出す。
// 音声はこの PC の中だけで扱い、外へは送らない
import type { AudioLevel, AudioSource } from '@app/contracts';
import { type CreateCaptureGraph, type CaptureGraph, type MediaStreamLike, createWorkletCaptureGraph } from './graph';
import { type LevelMeter, LEVEL_INTERVAL_MS, createLevelMeter } from './level';

// navigator.mediaDevices のうち使うところ
export interface AudioMediaDevicesLike {
  enumerateDevices(): Promise<{ deviceId: string; kind: string; label: string }[]>;
  getUserMedia(constraints: MediaStreamConstraints): Promise<MediaStreamLike>;
}

export interface AudioSourceOptions {
  // ここから下は差し替え用（テストなど）。省略すると本物を使う
  mediaDevices?: AudioMediaDevicesLike;
  createGraph?: CreateCaptureGraph;
  clock?: () => number; // 音量の time の時計（ミリ秒）。既定は performance.now（スタジオのフレームと同じ時計）
}

// 声の大きさをそのまま測るため、音声の加工はすべて切る（加工の分だけ遅れ、自動の音量調整はしきい値をずらす）。
// deviceId を渡したときはその機器だけ
export function microphoneConstraints(deviceId?: string): MediaStreamConstraints {
  return {
    video: false,
    audio: {
      ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
      channelCount: { ideal: 1 },
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
    },
  };
}

function stopStream(stream: MediaStreamLike): void {
  for (const track of stream.getTracks()) track.stop();
}

interface Run {
  stream: MediaStreamLike;
  graph: CaptureGraph;
  meter: LevelMeter;
  origin: number | null; // 通し番号 0 の時刻（最初の波形が届いたときに決める）
}

export function createAudioSource(options: AudioSourceOptions = {}): AudioSource {
  return new MicrophoneAudioSource(options);
}

class MicrophoneAudioSource implements AudioSource {
  private readonly levelListeners = new Set<(x: AudioLevel) => void>();
  private readonly sampleListeners = new Set<(samples: Float32Array, sampleRate: number, time: number) => void>();
  private run: Run | null = null;
  private generation = 0; // start・stop のたびに増やす。待っている間に古くなった start を捨てる
  private readonly reported = new WeakSet<object>(); // 受け取る処理の例外は1回だけ知らせる

  constructor(private readonly options: AudioSourceOptions) {}

  private mediaDevices(): AudioMediaDevicesLike {
    const devices = this.options.mediaDevices ?? globalThis.navigator?.mediaDevices;
    if (!devices) throw new Error('この環境ではマイクを使えない');
    return devices;
  }

  private clock(): number {
    return (this.options.clock ?? (() => performance.now()))();
  }

  async listDevices(): Promise<{ id: string; label: string }[]> {
    const devices = await this.mediaDevices().enumerateDevices();
    // 許可の前は label が空になる
    return devices
      .filter((d) => d.kind === 'audioinput')
      .map((d, i) => ({ id: d.deviceId, label: d.label || `マイク ${i + 1}` }));
  }

  async start(deviceId?: string): Promise<void> {
    this.stop();
    const generation = this.generation;
    const isStale = (): boolean => generation !== this.generation;
    const stream = await this.mediaDevices()
      .getUserMedia(microphoneConstraints(deviceId))
      .catch((error: unknown) => {
        // 待っている間に stop・start されたら、失敗も知らせない
        if (isStale()) return null;
        throw error;
      });
    if (!stream) return;
    if (isStale()) {
      stopStream(stream);
      return;
    }
    let run: Run | null = null;
    let graph: CaptureGraph;
    try {
      graph = await (this.options.createGraph ?? createWorkletCaptureGraph())(stream, (samples, startFrame) => {
        if (run && this.run === run) this.receive(run, samples, startFrame);
      });
    } catch (error) {
      stopStream(stream);
      if (isStale()) return;
      throw error;
    }
    if (isStale()) {
      graph.close();
      stopStream(stream);
      return;
    }
    const sampleRate = graph.sampleRate;
    const current: Run = {
      stream,
      graph,
      origin: null,
      meter: createLevelMeter({
        sampleRate,
        intervalMs: LEVEL_INTERVAL_MS,
        onLevel: (rmsDb, endFrame) => {
          const time = (current.origin ?? 0) + (endFrame / sampleRate) * 1000;
          this.emit(this.levelListeners, (l) => l({ time, rmsDb }));
        },
      }),
    };
    run = current;
    this.run = current;
  }

  stop(): void {
    this.generation++;
    const run = this.run;
    if (!run) return;
    this.run = null;
    run.graph.close();
    stopStream(run.stream);
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

  private receive(run: Run, samples: Float32Array, startFrame: number): void {
    const { sampleRate } = run.graph;
    // 最初に届いた波形の終わりを「いま」とみなして、通し番号を時刻に直す基準にする（あとは音声の時計で進める）
    run.origin ??= this.clock() - ((startFrame + samples.length) / sampleRate) * 1000;
    const time = run.origin + (startFrame / sampleRate) * 1000;
    this.emit(this.sampleListeners, (l) => l(samples, sampleRate, time));
    run.meter.push(samples, startFrame);
  }

  private emit<T extends object>(listeners: Set<T>, call: (listener: T) => void): void {
    for (const listener of [...listeners]) {
      try {
        call(listener);
      } catch (error) {
        if (this.reported.has(listener)) continue;
        this.reported.add(listener);
        console.error('マイクの音声を受け取る処理で失敗した', error);
      }
    }
  }
}
