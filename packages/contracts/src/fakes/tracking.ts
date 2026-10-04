import type { Environment } from '@app/schema';
import type { Layer, ParamValues, TrackingFrame, TrackingLayerProducer, TrackingSource } from '../index';

const FRAME_INTERVAL = 1000 / 30;
const SWING_PERIOD = 4000; // 左右に振る周期（ミリ秒）
const LOST_CYCLE = 20000; // 20秒ごとに
const LOST_DURATION = 2000; // 2秒間 detected を false にする

// 開始からの経過時間 t（ミリ秒）のときのフレーム
export function fakeTrackingFrame(t: number, time: number): TrackingFrame {
  const detected = t % LOST_CYCLE < LOST_CYCLE - LOST_DURATION;
  const phase = (2 * Math.PI * t) / SWING_PERIOD;
  return {
    time,
    detected,
    faceYaw: detected ? 20 * Math.sin(phase) : 0,
    facePitch: detected ? 5 * Math.sin(phase * 0.5) : 0,
    faceRoll: 0,
    eyeOpenL: 1,
    eyeOpenR: 1,
    eyeBallX: detected ? 0.5 * Math.sin(phase) : 0,
    eyeBallY: 0,
    mouthOpen: 0,
  };
}

// 30fps で顔をゆっくり左右に振る TrackingFrame を出す。20秒ごとに2秒間 detected を false にする
export class FakeTrackingSource implements TrackingSource {
  private timer: ReturnType<typeof setInterval> | null = null;
  private startedAt = 0;
  private readonly listeners = new Set<(frame: TrackingFrame) => void>();

  constructor(private readonly clock: () => number = () => performance.now()) {}

  async listDevices(): Promise<{ id: string; label: string }[]> {
    return [{ id: 'fake-camera', label: '仮のカメラ' }];
  }

  async start(_deviceId?: string): Promise<void> {
    this.stop();
    this.startedAt = this.clock();
    this.timer = setInterval(() => {
      const now = this.clock();
      const frame = fakeTrackingFrame(now - this.startedAt, now);
      for (const l of [...this.listeners]) l(frame);
    }, FRAME_INTERVAL);
  }

  stop(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }

  onFrame(listener: (frame: TrackingFrame) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}

// フレームの値をそのままパラメータに写す（ミラー・スムージングなし）
export class FakeTrackingLayer implements TrackingLayerProducer {
  private last: TrackingFrame | null = null;
  private values: ParamValues = {};

  update(frame: TrackingFrame): void {
    this.last = frame;
    if (!frame.detected) return;
    this.values = {
      FaceAngleX: frame.faceYaw,
      FaceAngleY: frame.facePitch,
      FaceAngleZ: frame.faceRoll,
      EyeOpenL: frame.eyeOpenL,
      EyeOpenR: frame.eyeOpenR,
      EyeBallX: frame.eyeBallX,
      EyeBallY: frame.eyeBallY,
      MouthOpen: frame.mouthOpen,
    };
  }

  tick(_now: number): Layer {
    return { id: 'tracking', weight: 1, values: { ...this.values } };
  }

  status(): 'tracking' | 'lost' {
    return this.last?.detected ? 'tracking' : 'lost';
  }

  setMirror(_on: boolean): void {}

  setLostBehavior(_b: 'returnToFront' | 'hold'): void {}

  // STEP1 で足したメソッド。何もしない
  setCalibration(_c: Environment['calibration']): void {}

  setPreset(
    _p: 'stable' | 'standard' | 'large' | 'custom',
    _custom?: { minCutoff: number; beta: number; gain: number; deadZone: number },
  ): void {}

  setEyeTracking(_on: boolean): void {}
}
