import type { BodyTrackingFrame } from '@app/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CameraVideo } from '../camera';
import type { FromBodyWorker, ToBodyWorker } from './protocol';
import { BodyTracker, type BodyWorkerLike } from './tracker';

class FakeWorker implements BodyWorkerLike {
  readonly posted: ToBodyWorker[] = [];
  terminated = false;
  private messageListeners: ((event: MessageEvent<FromBodyWorker>) => void)[] = [];
  private errorListeners: ((event: ErrorEvent) => void)[] = [];
  postMessage(message: ToBodyWorker): void {
    this.posted.push(message);
  }
  addEventListener(type: 'message' | 'error', listener: never): void {
    if (type === 'message') this.messageListeners.push(listener);
    else this.errorListeners.push(listener);
  }
  terminate(): void {
    this.terminated = true;
  }
  emit(message: FromBodyWorker): void {
    for (const l of this.messageListeners) l({ data: message } as MessageEvent<FromBodyWorker>);
  }
  fail(message: string): void {
    for (const l of this.errorListeners) l({ message, preventDefault: () => {} } as ErrorEvent);
  }
  frames() {
    return this.posted.filter((m): m is Extract<ToBodyWorker, { type: 'frame' }> => m.type === 'frame');
  }
}

const video = {} as CameraVideo;
let clock = 0;
let workers: FakeWorker[] = [];
let images: { close: ReturnType<typeof vi.fn> }[] = [];

function tracker() {
  return new BodyTracker({
    createWorker: () => {
      const w = new FakeWorker();
      workers.push(w);
      return w;
    },
    createImage: () => {
      const image = { close: vi.fn() };
      images.push(image);
      return image as unknown as VideoFrame;
    },
    now: () => clock,
    pageTimeOrigin: 0,
    terminateDelayMs: 100,
    urls: { worker: 'w', wasmLoader: 'l', wasmBinary: 'b', pose: 'p', gesture: 'g' },
  });
}

const ready = (w: FakeWorker) =>
  w.emit({ type: 'ready', pose: { delegate: 'GPU', errors: [] }, hands: { delegate: 'GPU', errors: [] } });
const part = (type: 'pose' | 'hands', generation: number, frameId: number, capturedAt: number) =>
  ({
    type,
    generation,
    frameId,
    capturedAt,
    captureSource: 'captureTime',
    completedAt: capturedAt + 20,
    width: 640,
    height: 480,
    error: null,
    value: type === 'pose' ? { landmarks: [], worldLandmarks: [] } : [],
  }) as FromBodyWorker;

beforeEach(() => {
  vi.useFakeTimers();
  clock = 0;
  workers = [];
  images = [];
});
afterEach(() => {
  vi.useRealTimers();
});

describe('BodyTracker', () => {
  it('腕 OFF では Worker を作らない。ON とカメラがそろってから作り、準備できるまで画像を渡さない', () => {
    const t = tracker();
    t.attach(video);
    t.onVideoFrame(0, { presentedFrames: 1, captureTime: 0 });
    expect(workers.length).toBe(0);
    t.configure({ enabled: true, mode: 'normal', hands: true });
    expect(workers.length).toBe(1);
    expect(workers[0]!.posted[0]).toMatchObject({ type: 'init', hands: true, handIntervalMs: 0 });
    expect(t.status().pose.state).toBe('loading');
    t.onVideoFrame(33, { presentedFrames: 2, captureTime: 33 });
    expect(workers[0]!.frames().length).toBe(0);
    ready(workers[0]!);
    expect(t.status().pose).toEqual({ state: 'ready', delegate: 'GPU', reason: null });
  });

  it('処理中1枚＋最新の待ち1枚。置き換えた待ちは閉じて数え、done で最新を渡す', () => {
    const t = tracker();
    t.attach(video);
    t.configure({ enabled: true, mode: 'normal', hands: true });
    const w = workers[0]!;
    ready(w);
    for (let i = 1; i <= 4; i++) t.onVideoFrame(i * 33, { presentedFrames: i, captureTime: i * 33 });
    expect(w.frames().map((f) => f.frameId)).toEqual([1]); // 処理中は1枚だけ
    expect(images[1]!.close).toHaveBeenCalled(); // 2 は 3 に、3 は 4 に置き換わった
    expect(images[2]!.close).toHaveBeenCalled();
    expect(images[3]!.close).not.toHaveBeenCalled();
    expect(t.status().droppedFrames).toBe(2);
    w.emit({ type: 'done', generation: t.status().generation, frameId: 1 });
    expect(w.frames().map((f) => f.frameId)).toEqual([1, 4]);
  });

  it('カメラが 60fps でも Pose へは 30fps を目安に渡す（撮影時刻で判定）', () => {
    const t = tracker();
    t.attach(video);
    t.configure({ enabled: true, mode: 'normal', hands: true });
    const w = workers[0]!;
    ready(w);
    for (let i = 1; i <= 12; i++) {
      t.onVideoFrame(i * 16.7, { presentedFrames: i, captureTime: i * 16.7 });
      const last = w.frames().at(-1);
      if (last) w.emit({ type: 'done', generation: t.status().generation, frameId: last.frameId });
    }
    expect(w.frames().length).toBe(6);
  });

  it('Pose だけ・手だけの通知を契約の形で届け、撮影時刻・完了・受け取りの時刻を持つ', () => {
    const t = tracker();
    const got: BodyTrackingFrame[] = [];
    t.onFrame((f) => got.push(f));
    t.attach(video);
    t.configure({ enabled: true, mode: 'normal', hands: true });
    const w = workers[0]!;
    ready(w);
    const g = t.status().generation;
    clock = 60;
    w.emit(part('pose', g, 1, 33));
    w.emit(part('hands', g, 1, 33)); // 同じ frameId の別の部位も捨てない
    expect(got.length).toBe(2);
    expect(got[0]!.hands).toBeNull();
    expect(got[0]!.pose!.time).toEqual({
      generation: g,
      frameId: 1,
      capturedAt: 33,
      captureSource: 'captureTime',
      completedAt: 53,
      receivedAt: 60,
    });
    expect(got[0]!.image).toEqual({ width: 640, height: 480 });
    expect(got[1]!.pose).toBeNull();
    expect(got[1]!.hands!.value).toEqual([]);
  });

  it('世代違い・部位ごとの順序の逆転・期限（250ms）切れは届けずに数える', () => {
    const t = tracker();
    const got: BodyTrackingFrame[] = [];
    t.onFrame((f) => got.push(f));
    t.attach(video);
    t.configure({ enabled: true, mode: 'normal', hands: true });
    const w = workers[0]!;
    ready(w);
    const g = t.status().generation;
    clock = 200;
    w.emit(part('pose', g - 1, 1, 150)); // 前の世代
    w.emit(part('pose', g, 2, 150));
    w.emit(part('pose', g, 3, 120)); // 順序の逆転
    clock = 1000;
    w.emit(part('pose', g, 4, 700)); // 300ms 前の撮影
    expect(got.map((f) => f.pose!.time.frameId)).toEqual([2]);
    expect(t.status().staleResults).toBe(3);
  });

  it('設定を変えると世代が増える。軽量への切替は推定器を作り直さず、手の間隔だけを変える', () => {
    const t = tracker();
    t.attach(video);
    t.configure({ enabled: true, mode: 'normal', hands: true });
    const g = t.status().generation;
    t.configure({ enabled: true, mode: 'light', hands: true });
    expect(t.status().generation).toBe(g + 1);
    expect(workers.length).toBe(1);
    expect(workers[0]!.posted.at(-1)).toEqual({ type: 'mode', handIntervalMs: 1000 / 15 });
    t.configure({ enabled: true, mode: 'light', hands: true }); // 同じ設定は何もしない
    expect(t.status().generation).toBe(g + 1);
  });

  it('腕 OFF で Worker を止めて終わらせ、待ちの画像を閉じる。カメラを止めても同じ', () => {
    const t = tracker();
    t.attach(video);
    t.configure({ enabled: true, mode: 'normal', hands: true });
    const w = workers[0]!;
    ready(w);
    t.onVideoFrame(33, { presentedFrames: 1, captureTime: 33 });
    t.onVideoFrame(66, { presentedFrames: 2, captureTime: 66 }); // 待ち
    t.configure({ enabled: false, mode: 'normal', hands: true });
    expect(w.posted.at(-1)).toEqual({ type: 'stop' });
    expect(images[1]!.close).toHaveBeenCalled();
    vi.advanceTimersByTime(100);
    expect(w.terminated).toBe(true);
    expect(t.status().pose.state).toBe('off');
    // 再び ON → 新しい Worker。カメラを止めると終わる
    t.configure({ enabled: true, mode: 'normal', hands: true });
    expect(workers.length).toBe(2);
    t.detach();
    vi.advanceTimersByTime(100);
    expect(workers[1]!.terminated).toBe(true);
    expect(t.status().pose).toEqual({ state: 'off', delegate: null, reason: 'カメラが止まっている' });
  });

  it('止めた後に古い Worker から届いた結果は捨てる', () => {
    const t = tracker();
    const got: BodyTrackingFrame[] = [];
    t.onFrame((f) => got.push(f));
    t.attach(video);
    t.configure({ enabled: true, mode: 'normal', hands: true });
    const old = workers[0]!;
    ready(old);
    const g = t.status().generation;
    t.configure({ enabled: true, mode: 'normal', hands: false }); // 手を止める → 作り直し
    clock = 40;
    old.emit(part('pose', g, 1, 33));
    expect(got).toEqual([]);
    expect(workers[1]!.posted[0]).toMatchObject({ type: 'init', hands: false });
  });

  it('GPU が使えず CPU になった理由と、Worker を読み込めないときの利用不可を状態から読める', () => {
    const t = tracker();
    t.attach(video);
    t.configure({ enabled: true, mode: 'normal', hands: true });
    workers[0]!.emit({
      type: 'ready',
      pose: { delegate: 'CPU', errors: ['GPU: kGpuService'] },
      hands: { delegate: null, errors: ['GPU: x', 'CPU: y'] },
    });
    expect(t.status().pose.state).toBe('ready');
    expect(t.status().pose.reason).toContain('CPU');
    expect(t.status().hands).toEqual({ state: 'unavailable', delegate: null, reason: 'GPU: x / CPU: y' });
    t.configure({ enabled: false, mode: 'normal', hands: true });
    t.configure({ enabled: true, mode: 'normal', hands: true });
    workers[1]!.fail('404');
    expect(t.status().pose).toEqual({ state: 'unavailable', delegate: null, reason: '404' });
    expect(workers[1]!.terminated).toBe(true);
  });

  it('Pose も手も使えないなら Worker を終わらせる', () => {
    const t = tracker();
    t.attach(video);
    t.configure({ enabled: true, mode: 'normal', hands: false });
    workers[0]!.emit({ type: 'ready', pose: { delegate: null, errors: ['CPU: no'] }, hands: null });
    expect(workers[0]!.terminated).toBe(true);
    expect(t.status().pose.state).toBe('unavailable');
    expect(t.status().hands.state).toBe('off');
  });

  it('外への通信を止めた知らせを数える。手を使う間は小さい映像を選ばない', () => {
    const t = tracker();
    expect(t.wantsLargeCapture()).toBe(false);
    t.attach(video);
    t.configure({ enabled: true, mode: 'normal', hands: true });
    expect(t.wantsLargeCapture()).toBe(true);
    workers[0]!.emit({ type: 'net', url: 'https://odml.pa.googleapis.com/v1/log', method: 'POST' });
    expect(t.blockedRequests()).toBe(1);
    // 止めた後（推定器を閉じたとき）の知らせも数える
    t.configure({ enabled: false, mode: 'normal', hands: true });
    workers[0]!.emit({ type: 'net', url: 'https://odml.pa.googleapis.com/v1/log', method: 'POST' });
    expect(t.blockedRequests()).toBe(2);
  });

  it('完了 fps は直近2秒に届いた件数から求める', () => {
    const t = tracker();
    t.attach(video);
    t.configure({ enabled: true, mode: 'normal', hands: true });
    const w = workers[0]!;
    ready(w);
    const g = t.status().generation;
    for (let i = 1; i <= 50; i++) {
      clock = i * 40;
      w.emit(part('pose', g, i, clock - 30));
    }
    expect(t.status().poseFps).toBe(25);
  });
});
