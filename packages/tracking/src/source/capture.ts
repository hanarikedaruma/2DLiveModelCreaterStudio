import type { CameraCaptureStats } from '@app/contracts';
import type { Environment } from '@app/schema';
import { AUTO_CAPTURE, captureConstraints, type CameraTrack, type CameraVideo } from './camera';

type Settings = Environment['cameraCapture'];
interface Sample {
  constraints: MediaTrackConstraints;
  cameraFps: number;
  trackingFps: number;
}
const AUTO_SIZES = [
  { width: 320, height: 240 },
  { width: 1280, height: 720 },
];

// 各候補で1秒の安定待ちと1秒の実測。同程度なら最初の640px設定を保持する。
export class CaptureSession {
  private timer: ReturnType<typeof setInterval> | null = null;
  private revision = 0;
  private busy = false;
  private warming = true;
  private selecting = false;
  private candidate = 0;
  private best: Sample | null = null;
  private requested: Settings;
  private state: CameraCaptureStats;
  private since = 0;
  private frames = 0;
  private estimates = 0;
  private estimateCount = 0;
  private constraints: MediaTrackConstraints;
  private applying: Promise<void> = Promise.resolve();

  constructor(
    private readonly track: CameraTrack,
    private readonly video: CameraVideo,
    settings: Settings,
    private readonly changed: () => void,
    private readonly now: () => number = () => performance.now(),
  ) {
    this.requested = { ...settings };
    const actual = track.getSettings();
    this.constraints = {
      width: { exact: actual.width },
      height: { exact: actual.height },
      frameRate: { ideal: settings.mode === 'auto' ? 60 : settings.fps },
    };
    this.state = {
      mode: settings.mode,
      state: settings.mode === 'auto' ? 'selecting' : 'ready',
      width: 0,
      height: 0,
      requestedFps: settings.mode === 'auto' ? 60 : settings.fps,
      nominalFps: null,
      maxFps: null,
      cameraFps: null,
      trackingFps: null,
      warning: null,
    };
  }

  stats(): CameraCaptureStats {
    return this.state;
  }
  estimated(): void {
    this.estimateCount++;
  }

  start(): void {
    this.selecting = this.requested.mode === 'auto';
    this.resetWindow();
    this.timer = setInterval(() => this.measure(), 1000);
    this.publish({});
  }

  stop(): void {
    this.revision++;
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }

  configure(settings: Settings): void {
    if (Object.keys(settings).every((key) => settings[key as keyof Settings] === this.requested[key as keyof Settings]))
      return;
    this.requested = { ...settings };
    this.best = null;
    this.candidate = 0;
    this.selecting = settings.mode === 'auto';
    void this.apply(captureConstraints(settings.mode === 'auto' ? AUTO_CAPTURE : settings), this.selecting).catch(
      (error: unknown) => {
        this.selecting = false;
        this.publish({
          state: 'error',
          warning: `カメラ設定を適用できない: ${error instanceof Error ? error.message : String(error)}`,
        });
      },
    );
  }

  private resetWindow(): void {
    this.since = this.now();
    this.frames = this.video.frameCount();
    this.estimates = this.estimateCount;
    this.warming = true;
  }

  private publish(patch: Partial<CameraCaptureStats>): void {
    const actual = this.track.getSettings();
    this.state = {
      ...this.state,
      mode: this.requested.mode,
      requestedFps: this.requested.mode === 'auto' ? 60 : this.requested.fps,
      width: actual.width ?? this.video.image.videoWidth ?? 0,
      height: actual.height ?? this.video.image.videoHeight ?? 0,
      nominalFps: actual.frameRate ?? null,
      maxFps: this.track.getCapabilities().frameRate?.max ?? null,
      ...patch,
    };
    this.changed();
  }

  private measure(): void {
    if (this.busy) return;
    const now = this.now();
    const elapsed = now - this.since;
    if (elapsed < 1000) return;
    const count = this.video.frameCount();
    const cameraFps = (Math.max(0, count - this.frames) * 1000) / elapsed;
    const trackingFps = (Math.max(0, this.estimateCount - this.estimates) * 1000) / elapsed;
    this.since = now;
    this.frames = count;
    this.estimates = this.estimateCount;
    if (this.warming) {
      this.warming = false;
      return;
    }
    const warning =
      cameraFps < this.state.requestedFps * 0.8
        ? `映像は${cameraFps.toFixed(1)} fps（要求${this.state.requestedFps}）。機器・照明・PC負荷を確認`
        : null;
    this.publish({ cameraFps, trackingFps, ...(this.state.state === 'error' ? {} : { warning }) });
    if (!this.selecting) return;
    const sample = { constraints: this.constraints, cameraFps, trackingFps };
    if (!this.best || better(sample, this.best)) this.best = sample;
    if (this.candidate === 0 && cameraFps >= 54 && trackingFps >= 54) {
      this.selecting = false;
      this.publish({ state: 'ready' });
      return;
    }
    void this.advance();
  }

  private async apply(constraints: MediaTrackConstraints, selecting: boolean): Promise<boolean> {
    const revision = ++this.revision;
    this.busy = true;
    this.publish({ state: 'selecting', cameraFps: null, trackingFps: null, warning: null });
    const operation = this.applying.then(async () => {
      if (revision !== this.revision || this.timer === null) return false;
      await this.track.applyConstraints(constraints);
      return true;
    });
    this.applying = operation.then(
      () => {},
      () => {},
    );
    try {
      if (!(await operation)) return false;
      if (revision !== this.revision || this.timer === null) return false;
      this.constraints = constraints;
      this.resetWindow();
      this.publish({ state: selecting ? 'selecting' : 'ready' });
      return true;
    } catch (error) {
      if (revision !== this.revision || this.timer === null) return false;
      throw error;
    } finally {
      if (revision === this.revision) this.busy = false;
    }
  }

  private async advance(): Promise<void> {
    const requested = this.requested;
    while (this.candidate < AUTO_SIZES.length) {
      const size = AUTO_SIZES[this.candidate++]!;
      try {
        if (await this.apply(captureConstraints({ ...AUTO_CAPTURE, ...size }), true)) return;
        return;
      } catch {
        if (this.requested !== requested || this.timer === null) return;
      }
    }
    if (this.requested !== requested || this.timer === null) return;
    this.selecting = false;
    const best = this.best;
    try {
      if (best && this.constraints !== best.constraints && !(await this.apply(best.constraints, false))) return;
      this.publish({ state: 'ready' });
    } catch (error) {
      this.publish({ state: 'error', warning: `自動選択した設定に戻せない: ${String(error)}` });
    }
  }
}

function better(a: Sample, b: Sample): boolean {
  const usableA = Math.min(a.cameraFps, a.trackingFps);
  const usableB = Math.min(b.cameraFps, b.trackingFps);
  if (Math.abs(usableA - usableB) > Math.max(usableA, usableB) * 0.1) return usableA > usableB;
  if (Math.abs(a.cameraFps - b.cameraFps) > Math.max(a.cameraFps, b.cameraFps) * 0.1) return a.cameraFps > b.cameraFps;
  return false;
}
