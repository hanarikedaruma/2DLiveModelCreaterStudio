import type { Environment, Hotkey } from '@app/schema';
import type {
  Background,
  CalibrationService,
  CalibrationStep,
  DeformedModel,
  HotkeyService,
  OutputSink,
  TrackingFrame,
  ViewTransform,
} from '../index';

const average = (values: number[]): number => values.reduce((a, b) => a + b, 0) / values.length;

// 検出できたフレームの平均（口は最大）をそのまま使う。正面（neutral）を取るまでは null
export class FakeCalibration implements CalibrationService {
  private captured = new Map<CalibrationStep, TrackingFrame[]>();

  capture(step: CalibrationStep, frames: TrackingFrame[]): void {
    const detected = frames.filter((f) => f.detected);
    if (detected.length > 0) this.captured.set(step, detected);
  }

  result(): Environment['calibration'] {
    const neutral = this.captured.get('neutral');
    if (!neutral) return null;
    const closed = this.captured.get('eyesClosed');
    const mouth = this.captured.get('mouthOpen');
    return {
      neutral: {
        yaw: average(neutral.map((f) => f.faceYaw)),
        pitch: average(neutral.map((f) => f.facePitch)),
        roll: average(neutral.map((f) => f.faceRoll)),
      },
      eyeClosed: closed
        ? { l: average(closed.map((f) => f.eyeOpenL)), r: average(closed.map((f) => f.eyeOpenR)) }
        : { l: 0, r: 0 },
      mouthOpenMax: mouth ? Math.max(...mouth.map((f) => f.mouthOpen)) : 1,
    };
  }

  reset(): void {
    this.captured = new Map();
  }
}

// 登録だけする（OS には登録しない）。同じキーが登録済みなら conflict。テストでは press で押したことにできる
export class FakeHotkeys implements HotkeyService {
  private readonly handlers = new Map<string, { hotkey: Hotkey; handler: (phase: 'down' | 'up') => void }>();

  async register(hotkey: Hotkey, handler: (phase: 'down' | 'up') => void): Promise<'ok' | 'conflict'> {
    const key = hotkey.keys.toLowerCase();
    if (this.handlers.has(key)) return 'conflict';
    this.handlers.set(key, { hotkey, handler });
    return 'ok';
  }

  async unregisterAll(): Promise<void> {
    this.handlers.clear();
  }

  registered(): Hotkey[] {
    return [...this.handlers.values()].map((h) => h.hotkey);
  }

  // 登録されていれば handler を呼んで true
  press(keys: string, phase: 'down' | 'up' = 'down'): boolean {
    const entry = this.handlers.get(keys.toLowerCase());
    entry?.handler(phase);
    return entry !== undefined;
  }
}

// 何もしない（送った回数だけ数える）
export class FakeSpout implements OutputSink {
  running = false;
  submitted = 0;

  async start(_o: { width: number; height: number; fps: number }): Promise<void> {
    this.running = true;
  }

  async setTextures(_pngs: Record<string, Uint8Array>): Promise<void> {}

  submit(_model: DeformedModel, _view: ViewTransform, _background: Background): void {
    if (this.running) this.submitted++;
  }

  async stop(): Promise<void> {
    this.running = false;
  }
}
