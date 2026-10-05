import type { CameraCaptureStats, TrackingFrame, TrackingSource } from '@app/contracts';
import type { Environment } from '@app/schema';
import {
  AUTO_CAPTURE,
  type CameraVideo,
  type MediaDevicesLike,
  type MediaStreamLike,
  cameraConstraints,
  createDomCameraVideo,
  stopStream,
} from './camera';
import { CaptureSession } from './capture';
import { NEUTRAL_TRACKING_FRAME, landmarkerResultToFrame } from './convert';
import {
  type FaceLandmarkerLike,
  type MediaPipeAssetUrls,
  createMediaPipeFaceLandmarker,
  defaultMediaPipeAssetUrls,
} from './landmarker';

export interface MediaPipeTrackingSourceOptions {
  // 同梱するファイルの URL。省略したものは packages/tracking の中のファイルを Vite が同梱した URL
  assetUrls?: Partial<MediaPipeAssetUrls>;
  // ここから下は差し替え用（テストなど）。省略すると本物を使う
  mediaDevices?: MediaDevicesLike;
  createVideo?: () => CameraVideo;
  createLandmarker?: () => Promise<FaceLandmarkerLike>;
  now?: () => number;
}

interface Run {
  video: CameraVideo;
  stream: MediaStreamLike;
  capture: CaptureSession | null;
  landmarker: FaceLandmarkerLike;
  cancelFrame: (() => void) | null;
  lastPresentedFrames: number; // 最後に推定したフレームの通し番号
  busy: boolean; // 推定の途中
  warned: boolean;
}

// Webカメラの映像から顔の向き・目・口を PC の中で推定する。映像は外へ送らない
export function createMediaPipeTrackingSource(options: MediaPipeTrackingSourceOptions = {}): TrackingSource {
  return new MediaPipeTrackingSource(options);
}

class MediaPipeTrackingSource implements TrackingSource {
  private readonly listeners = new Set<(frame: TrackingFrame) => void>();
  private landmarker: Promise<FaceLandmarkerLike> | null = null;
  private run: Run | null = null;
  private generation = 0; // start・stop のたびに増やす。待っている間に古くなった start を捨てる
  private lastTimestamp = -Infinity; // detectForVideo の時刻は同じ landmarker で増え続ける必要がある
  private last: TrackingFrame = { ...NEUTRAL_TRACKING_FRAME };
  private captureSettings: Environment['cameraCapture'] = { ...AUTO_CAPTURE };
  private readonly captureListeners = new Set<() => void>();

  constructor(private readonly options: MediaPipeTrackingSourceOptions) {}

  private mediaDevices(): MediaDevicesLike {
    const devices = this.options.mediaDevices ?? globalThis.navigator?.mediaDevices;
    if (!devices) throw new Error('この環境ではカメラを使えない');
    return devices;
  }

  async listDevices(): Promise<{ id: string; label: string }[]> {
    const devices = await this.mediaDevices().enumerateDevices();
    // 許可の前は label が空になる
    return devices
      .filter((d) => d.kind === 'videoinput')
      .map((d, i) => ({ id: d.deviceId, label: d.label || `カメラ ${i + 1}` }));
  }

  configureCapture(settings: Environment['cameraCapture']): void {
    this.captureSettings = { ...settings };
    this.run?.capture?.configure(settings);
  }

  captureStats(): CameraCaptureStats | null {
    return this.run?.capture?.stats() ?? null;
  }

  onCaptureStats(listener: () => void): () => void {
    this.captureListeners.add(listener);
    return () => {
      this.captureListeners.delete(listener);
    };
  }

  private captureChanged(): void {
    for (const listener of [...this.captureListeners]) {
      try {
        listener();
      } catch (error) {
        console.error('カメラ計測の通知で失敗した', error);
      }
    }
  }

  async start(deviceId?: string): Promise<void> {
    this.stop();
    const generation = this.generation;
    const settings = { ...this.captureSettings };
    const isStale = (): boolean => generation !== this.generation;
    const [streamResult, landmarkerResult] = await Promise.allSettled([
      this.openCamera(deviceId, settings, isStale),
      this.loadLandmarker(),
    ]);
    // 待っている間に stop・start されたら、取れたカメラを閉じて終わる（失敗も知らせない）
    if (streamResult.status === 'rejected') {
      if (isStale()) return;
      throw streamResult.reason;
    }
    const stream = streamResult.value;
    if (landmarkerResult.status === 'rejected' || isStale()) {
      stopStream(stream);
      if (landmarkerResult.status === 'rejected' && !isStale()) throw landmarkerResult.reason;
      return;
    }
    const video = (this.options.createVideo ?? createDomCameraVideo)();
    try {
      await video.play(stream);
    } catch (error) {
      video.release();
      stopStream(stream);
      if (isStale()) return;
      throw error;
    }
    if (isStale()) {
      video.release();
      stopStream(stream);
      return;
    }
    const run: Run = {
      video,
      stream,
      capture: null,
      landmarker: landmarkerResult.value,
      cancelFrame: null,
      lastPresentedFrames: -Infinity,
      busy: false,
      warned: false,
    };
    this.run = run;
    const track = stream.getVideoTracks()[0];
    if (!track) {
      this.stop();
      throw new Error('カメラの映像トラックがない');
    }
    run.capture = new CaptureSession(
      track,
      video,
      settings,
      () => {
        if (this.run === run) this.captureChanged();
      },
      this.options.now,
    );
    run.capture.start();
    if (this.run !== run) return;
    run.capture.configure(this.captureSettings);
    this.scheduleFrame(run);
  }

  private async openCamera(
    deviceId: string | undefined,
    settings: Environment['cameraCapture'],
    isStale: () => boolean,
  ): Promise<MediaStreamLike> {
    try {
      return await this.mediaDevices().getUserMedia(cameraConstraints(deviceId, settings));
    } catch (error) {
      if (isStale() || settings.mode !== 'auto' || !(error instanceof Error) || error.name !== 'OverconstrainedError')
        throw error;
      return this.mediaDevices().getUserMedia(cameraConstraints(deviceId, settings, true));
    }
  }

  stop(): void {
    this.generation++;
    const run = this.run;
    if (!run) return;
    this.run = null;
    run.capture?.stop();
    run.cancelFrame?.();
    run.cancelFrame = null;
    run.video.release();
    stopStream(run.stream);
    this.captureChanged();
  }

  onFrame(listener: (frame: TrackingFrame) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  // 一度だけ作り、start・stop をまたいで使い回す。失敗したら次の start で作り直す
  private loadLandmarker(): Promise<FaceLandmarkerLike> {
    if (!this.landmarker) {
      const create =
        this.options.createLandmarker ??
        (() => createMediaPipeFaceLandmarker({ ...defaultMediaPipeAssetUrls(), ...this.options.assetUrls }));
      this.landmarker = create().catch((error: unknown) => {
        this.landmarker = null;
        throw error;
      });
    }
    return this.landmarker;
  }

  private scheduleFrame(run: Run): void {
    run.cancelFrame = run.video.onNextFrame((now, info) => {
      if (this.run !== run) return;
      // 次のフレームを先に予約する。推定が長引いて間に出たフレームはブラウザーが1つにまとめる（＝捨てる）
      this.scheduleFrame(run);
      // 推定の途中に来たフレームと、推定済みのフレームは捨てる
      if (run.busy || info.presentedFrames <= run.lastPresentedFrames) return;
      run.lastPresentedFrames = info.presentedFrames;
      run.busy = true;
      run.capture?.estimated();
      try {
        this.processFrame(run, now);
      } finally {
        run.busy = false;
      }
    });
  }

  private processFrame(run: Run, now: number): void {
    // detectForVideo の時刻は前より大きくないといけない
    const time = now > this.lastTimestamp ? now : this.lastTimestamp + 1;
    this.lastTimestamp = time;
    let frame: TrackingFrame;
    try {
      const result = run.landmarker.detectForVideo(run.video.image, time);
      frame = landmarkerResultToFrame(result, time, this.last);
    } catch (error) {
      if (!run.warned) console.warn('顔の推定に失敗した', error);
      run.warned = true;
      frame = { ...this.last, time, detected: false };
    }
    if (this.run !== run) return; // 推定の途中で止められた
    this.last = frame;
    for (const listener of [...this.listeners]) {
      try {
        listener(frame);
      } catch (error) {
        console.error('トラッキングのフレームを受け取る処理で失敗した', error);
      }
    }
  }
}
