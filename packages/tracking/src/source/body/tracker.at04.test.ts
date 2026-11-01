import type { BodyTrackingFrame } from '@app/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CameraVideo } from '../camera';
import type { FromBodyWorker, ToBodyWorker } from './protocol';
import { BodyTracker, type BodyWorkerLike } from './tracker';

// CO独立の転送境界。画像の所有権はpostMessageが成功した場合だけWorkerへ移る。
class Boundary implements BodyWorkerLike {
  sent: ToBodyWorker[] = [];
  listener: ((event: MessageEvent<FromBodyWorker>) => void) | null = null;
  terminate = vi.fn();
  postMessage(message: ToBodyWorker): void {
    this.sent.push(message);
  }
  addEventListener(type: 'message' | 'error', listener: never): void {
    if (type === 'message') this.listener = listener;
  }
  emit(message: FromBodyWorker) {
    this.listener?.({ data: message } as MessageEvent<FromBodyWorker>);
  }
}
function setup() {
  let now = 100;
  const workers: Boundary[] = [],
    images: { close: ReturnType<typeof vi.fn> }[] = [];
  const tracker = new BodyTracker({
    createWorker: () => {
      const w = new Boundary();
      workers.push(w);
      return w;
    },
    createImage: () => {
      const image = { close: vi.fn() };
      images.push(image);
      return image as unknown as VideoFrame;
    },
    now: () => now,
    pageTimeOrigin: 0,
    terminateDelayMs: 10,
    urls: { worker: 'worker', pose: 'pose', gesture: 'hands', wasmLoader: 'loader', wasmBinary: 'binary' },
  });
  const frames: BodyTrackingFrame[] = [];
  tracker.onFrame((f) => frames.push(f));
  tracker.configure({ enabled: true, mode: 'normal', hands: true });
  tracker.attach({} as CameraVideo);
  const ready = (w: Boundary) =>
    w.emit({
      type: 'ready',
      pose: { delegate: 'GPU', errors: [] },
      hands: { delegate: 'CPU', errors: ['GPU unavailable'] },
    });
  const part = (
    w: Boundary,
    type: 'pose' | 'hands',
    at: number,
    generation = tracker.status().generation,
    missing = false,
  ) => {
    const common = {
      generation,
      frameId: at,
      capturedAt: at,
      completedAt: at + 5,
      captureSource: 'captureTime' as const,
      width: 640,
      height: 480,
      error: null,
    };
    w.emit(
      type === 'pose'
        ? { ...common, type, value: missing ? null : { landmarks: [], worldLandmarks: [] } }
        : { ...common, type, value: missing ? null : [] },
    );
  };
  return {
    tracker,
    workers,
    images,
    frames,
    ready,
    part,
    clock: (t: number) => {
      now = t;
    },
  };
}
afterEach(() => vi.useRealTimers());

describe('AT-04 CO独立確認', () => {
  it('同じ撮影時刻のPoseと手を独立配信し、null・順序逆転・250ms超の結果は配信しない', () => {
    const { tracker, workers, frames, ready, part, clock } = setup();
    const w = workers[0]!;
    ready(w);
    part(w, 'pose', 90);
    part(w, 'hands', 90);
    expect(frames).toHaveLength(2);
    expect(frames[0]?.hands).toBeNull();
    expect(frames[1]?.pose).toBeNull();
    expect(frames[1]?.hands?.value).toEqual([]);
    part(w, 'pose', 95, undefined, true);
    part(w, 'pose', 89);
    clock(400);
    part(w, 'hands', 100);
    expect(frames).toHaveLength(2);
    expect(tracker.status().staleResults).toBe(2);
    expect(tracker.status().hands.delegate).toBe('CPU');
    tracker.detach();
  });

  it('再開後は古いWorkerを無視し、新Workerからの現世代だけを配信する', () => {
    vi.useFakeTimers();
    const { tracker, workers, frames, ready, part } = setup();
    const old = workers[0]!;
    ready(old);
    const oldGeneration = tracker.status().generation;
    tracker.detach();
    tracker.attach({} as CameraVideo);
    const current = workers[1]!;
    ready(current);
    part(old, 'pose', 95, oldGeneration);
    part(current, 'pose', 95, oldGeneration);
    expect(frames).toHaveLength(0);
    part(current, 'pose', 95);
    expect(frames).toHaveLength(1);
    vi.advanceTimersByTime(10);
    expect(old.terminate).toHaveBeenCalledOnce();
    expect(current.terminate).not.toHaveBeenCalled();
    tracker.detach();
    vi.runAllTimers();
  });

  it('推定中の画像はページ側で閉じず、待ち画像の置換と停止では各1回だけ閉じる', () => {
    vi.useFakeTimers();
    const { tracker, workers, images, ready } = setup();
    ready(workers[0]!);
    for (const t of [100, 140, 180]) tracker.onVideoFrame(t, { presentedFrames: t, captureTime: t });
    expect(images).toHaveLength(3);
    expect(images[0]?.close).not.toHaveBeenCalled();
    expect(images[1]?.close).toHaveBeenCalledOnce();
    expect(images[2]?.close).not.toHaveBeenCalled();
    tracker.detach();
    expect(images[0]?.close).not.toHaveBeenCalled();
    expect(images[2]?.close).toHaveBeenCalledOnce();
    tracker.detach();
    vi.runAllTimers();
    expect(images[2]?.close).toHaveBeenCalledOnce();
  });
});
