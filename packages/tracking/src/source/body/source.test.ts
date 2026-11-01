// 顔の推定元に腕・手の推定（AT-04）を組み込んだときの結合。カメラは1回だけ開き、顔と腕は独立に動く
import type { BodyTrackingFrame, TrackingFrame } from '@app/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CameraVideo, MediaDevicesLike, MediaStreamLike, VideoFrameInfo } from '../camera';
import type { LandmarkerResultLike } from '../convert';
import { createMediaPipeTrackingSource } from '../source';
import type { FromBodyWorker, ToBodyWorker } from './protocol';
import type { BodyWorkerLike } from './tracker';

class FakeVideo implements CameraVideo {
  readonly image = {} as HTMLVideoElement;
  callbacks: ((now: number, info: VideoFrameInfo) => void)[] = [];
  private frames = 0;
  frameCount() {
    return this.frames;
  }
  async play(): Promise<void> {}
  onNextFrame(callback: (now: number, info: VideoFrameInfo) => void): () => void {
    this.callbacks.push(callback);
    return () => {
      this.callbacks = this.callbacks.filter((c) => c !== callback);
    };
  }
  release(): void {}
  present(now: number, presentedFrames: number): void {
    this.frames = presentedFrames;
    const pending = this.callbacks;
    this.callbacks = [];
    for (const cb of pending) cb(now, { presentedFrames, captureTime: now - 5 });
  }
}

class FakeWorker implements BodyWorkerLike {
  readonly posted: ToBodyWorker[] = [];
  terminated = false;
  private listeners: ((event: MessageEvent<FromBodyWorker>) => void)[] = [];
  postMessage(message: ToBodyWorker): void {
    this.posted.push(message);
  }
  addEventListener(type: 'message' | 'error', listener: never): void {
    if (type === 'message') this.listeners.push(listener);
  }
  terminate(): void {
    this.terminated = true;
  }
  emit(message: FromBodyWorker): void {
    for (const l of this.listeners) l({ data: message } as MessageEvent<FromBodyWorker>);
  }
}

const NO_FACE: LandmarkerResultLike = { faceBlendshapes: [], facialTransformationMatrixes: [] };

function setup(createWorker: () => BodyWorkerLike) {
  const getUserMedia = vi.fn(async (): Promise<MediaStreamLike> => ({
    getTracks: () => [{ stop: () => {} }],
    getVideoTracks: () => [
      {
        getSettings: () => ({ width: 640, height: 480, frameRate: 30 }),
        getCapabilities: () => ({}),
        applyConstraints: async () => {},
      },
    ],
  }));
  const devices: MediaDevicesLike = { enumerateDevices: async () => [], getUserMedia };
  const video = new FakeVideo();
  let clock = 1000;
  const source = createMediaPipeTrackingSource({
    mediaDevices: devices,
    createVideo: () => video,
    createLandmarker: async () => ({ detectForVideo: () => NO_FACE, close: () => {} }),
    now: () => clock,
    body: {
      createWorker,
      createImage: () => ({ close: () => {} }) as unknown as VideoFrame,
      pageTimeOrigin: 0,
      terminateDelayMs: 0,
      urls: { worker: 'w', wasmLoader: 'l', wasmBinary: 'b', pose: 'p', gesture: 'g' },
    },
  });
  const faces: TrackingFrame[] = [];
  const bodies: BodyTrackingFrame[] = [];
  source.onFrame((f) => faces.push(f));
  source.body!.onFrame((f) => bodies.push(f));
  const tick = (n: number) => {
    clock += 33;
    video.present(clock, n);
  };
  return { source, getUserMedia, faces, bodies, tick, setClock: (t: number) => (clock = t) };
}

const sources: { stop(): void }[] = [];
afterEach(() => {
  for (const s of sources.splice(0)) s.stop();
  vi.useRealTimers();
});

describe('顔の推定元と腕・手の推定', () => {
  it('カメラは1回だけ開き、同じ映像のフレームを腕の Worker へ渡す。腕の結果は顔と別に届く', async () => {
    const workers: FakeWorker[] = [];
    const { source, getUserMedia, faces, bodies, tick } = setup(() => {
      const w = new FakeWorker();
      workers.push(w);
      return w;
    });
    sources.push(source);
    source.body!.configure({ enabled: true, mode: 'normal', hands: true });
    await source.start();
    const w = workers[0]!;
    w.emit({ type: 'ready', pose: { delegate: 'GPU', errors: [] }, hands: { delegate: 'GPU', errors: [] } });
    tick(1);
    tick(2);
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(faces.length).toBe(2); // 顔は毎フレーム
    const frames = w.posted.filter((m) => m.type === 'frame');
    expect(frames.length).toBe(1); // 腕は処理中の1枚
    const first = frames[0] as Extract<ToBodyWorker, { type: 'frame' }>;
    expect(first.captureSource).toBe('captureTime');
    w.emit({
      type: 'pose',
      generation: first.generation,
      frameId: first.frameId,
      capturedAt: first.capturedAt,
      captureSource: 'captureTime',
      completedAt: first.capturedAt + 10,
      width: 640,
      height: 480,
      error: null,
      value: { landmarks: [], worldLandmarks: [] },
    });
    expect(bodies.length).toBe(1);
  });

  it('腕の Worker を読み込めなくても顔は続き、状態に理由が出る。メインスレッドで推定しない', async () => {
    const { source, faces, tick } = setup(() => {
      throw new Error('Worker を作れない');
    });
    sources.push(source);
    source.body!.configure({ enabled: true, mode: 'normal', hands: true });
    await source.start();
    tick(1);
    tick(2);
    expect(faces.length).toBe(2);
    expect(source.body!.status().pose.state).toBe('unavailable');
    expect(source.body!.status().pose.reason).toContain('Worker を作れない');
  });

  it('カメラを止めると腕の Worker も終わり、開き直すと新しい世代で作り直す', async () => {
    const workers: FakeWorker[] = [];
    const { source } = setup(() => {
      const w = new FakeWorker();
      workers.push(w);
      return w;
    });
    sources.push(source);
    source.body!.configure({ enabled: true, mode: 'normal', hands: true });
    await source.start();
    const g = source.body!.status().generation;
    source.stop();
    await new Promise((r) => setTimeout(r, 5));
    expect(workers[0]!.terminated).toBe(true);
    expect(source.body!.status().pose.reason).toBe('カメラが止まっている');
    await source.start();
    expect(workers.length).toBe(2);
    expect(source.body!.status().generation).toBeGreaterThan(g);
  });

  it('腕 OFF のままなら Worker を作らず、顔だけが動く', async () => {
    const createWorker = vi.fn(() => new FakeWorker());
    const { source, faces, tick } = setup(createWorker);
    sources.push(source);
    await source.start();
    tick(1);
    expect(createWorker).not.toHaveBeenCalled();
    expect(faces.length).toBe(1);
    expect(source.body!.status().pose.state).toBe('off');
  });
});
