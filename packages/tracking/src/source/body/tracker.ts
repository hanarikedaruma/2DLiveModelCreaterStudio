// 腕・手の観測を配信する（AT-04 / CC-032 の BodyTrackingCapability）。顔と同じカメラの映像を受け取り、
// Pose と手を1つの Worker で推定する。カメラを別に開かず、顔の通知とは独立に通知する。
// 左右の対応付け・正規化（AT-05）、手形の確定（AT-07）、モデルの制御はここで行わない。
import {
  ARM_TIMING,
  type BodyFeatureState,
  type BodySampleTime,
  type BodyTrackingCapability,
  type BodyTrackingConfig,
  type BodyTrackingFrame,
  type BodyTrackingStatus,
} from '@app/contracts';
import type { CameraVideo, VideoFrameInfo } from '../camera';
import { createBlobModuleWorker, defaultBodyAssetUrls, type BodyAssetUrls } from './assets';
import type { FromBodyWorker, HandsPart, PosePart, ReadyMessage, TaskReady, ToBodyWorker } from './protocol';

export interface BodyWorkerLike {
  postMessage(message: ToBodyWorker, transfer?: Transferable[]): void;
  addEventListener(type: 'message', listener: (event: MessageEvent<FromBodyWorker>) => void): void;
  addEventListener(type: 'error', listener: (event: ErrorEvent) => void): void;
  terminate(): void;
}

export interface BodyTrackerOptions {
  urls?: Partial<BodyAssetUrls>;
  // ここから下は差し替え用（テストなど）。省略すると本物を使う
  createWorker?: (url: string) => BodyWorkerLike;
  createImage?: (video: CameraVideo, capturedAt: number) => VideoFrame | ImageBitmap;
  now?: () => number;
  pageTimeOrigin?: number;
  terminateDelayMs?: number; // 止めるとき、推定器を閉じる時間を与えてから Worker を終わらせる
}

interface Feature {
  state: BodyFeatureState;
  delegate: 'GPU' | 'CPU' | null;
  reason: string | null;
}

interface Pending {
  image: VideoFrame | ImageBitmap;
  frameId: number;
  capturedAt: number;
  captureSource: BodySampleTime['captureSource'];
}

const POSE_INTERVAL_MS = 1000 / 30; // Pose は 30fps を目安に送る（カメラが 60fps なら1つおき）
const LIGHT_HAND_INTERVAL_MS = 1000 / 15; // 軽量は手を 15fps にする
const FPS_WINDOW_MS = 2000;
const off = (reason: string | null = null): Feature => ({ state: 'off', delegate: null, reason });

function defaultCreateImage(video: CameraVideo, capturedAt: number): VideoFrame {
  // 画素を複製しない。Worker が推定の後に閉じる
  return new VideoFrame(video.image, { timestamp: Math.round(capturedAt * 1000) });
}

export class BodyTracker implements BodyTrackingCapability {
  private config: BodyTrackingConfig = { enabled: false, mode: 'normal', hands: true };
  private generation = 0;
  private video: CameraVideo | null = null;
  private worker: BodyWorkerLike | null = null;
  private outstanding = 0; // Worker に渡して done を待っているフレーム（最大1）
  private held: Pending | null = null; // 処理中に届いた最新のフレーム（最大1）
  private frameId = 0;
  private lastQueued = -Infinity;
  private lastPose = -Infinity;
  private lastHands = -Infinity;
  private poseTimes: number[] = [];
  private handTimes: number[] = [];
  private dropped = 0;
  private stale = 0;
  private blocked = 0;
  private pose: Feature = off();
  private hands: Feature = off();
  private readonly frameListeners = new Set<(frame: BodyTrackingFrame) => void>();
  private readonly statusListeners = new Set<() => void>();
  private readonly urls: BodyAssetUrls;

  constructor(private readonly options: BodyTrackerOptions = {}) {
    this.urls = { ...defaultBodyAssetUrls(), ...options.urls };
  }

  private now(): number {
    return (this.options.now ?? (() => performance.now()))();
  }

  // ---- BodyTrackingCapability

  configure(next: BodyTrackingConfig): void {
    const previous = this.config;
    if (previous.enabled === next.enabled && previous.mode === next.mode && previous.hands === next.hands) return;
    this.config = { ...next };
    this.newGeneration();
    if (previous.enabled !== next.enabled || previous.hands !== next.hands) {
      // 推定器の組を作り直す。腕 OFF なら Worker を終わらせ、モデルと画像を手放す
      this.stopWorker();
      if (next.enabled && this.video) this.startWorker();
      else this.idle();
    } else {
      this.worker?.postMessage({ type: 'mode', handIntervalMs: this.handIntervalMs() });
    }
    this.notifyStatus();
  }

  status(): BodyTrackingStatus {
    const now = this.now();
    const fps = (times: number[]): number | null => {
      const recent = times.filter((t) => t > now - FPS_WINDOW_MS);
      return recent.length ? recent.length / (FPS_WINDOW_MS / 1000) : null;
    };
    return {
      generation: this.generation,
      pose: { ...this.pose },
      hands: { ...this.hands },
      poseFps: this.pose.state === 'ready' ? fps(this.poseTimes) : null,
      handFps: this.hands.state === 'ready' ? fps(this.handTimes) : null,
      droppedFrames: this.dropped,
      staleResults: this.stale,
    };
  }

  onFrame(listener: (frame: BodyTrackingFrame) => void): () => void {
    this.frameListeners.add(listener);
    return () => {
      this.frameListeners.delete(listener);
    };
  }

  onStatus(listener: () => void): () => void {
    this.statusListeners.add(listener);
    return () => {
      this.statusListeners.delete(listener);
    };
  }

  // ---- 推定元（source.ts）から呼ぶ

  // カメラの映像が出始めた
  attach(video: CameraVideo): void {
    this.video = video;
    this.newGeneration();
    if (this.config.enabled) this.startWorker();
    this.notifyStatus();
  }

  // カメラを止めた（カメラの切替も一度ここを通る）
  detach(): void {
    if (!this.video) return;
    this.video = null;
    this.newGeneration();
    this.stopWorker();
    this.idle();
    this.notifyStatus();
  }

  // 解像度の自動選択で小さい映像を選ばない（手が小さくなりすぎる）
  wantsLargeCapture(): boolean {
    return this.config.enabled && this.config.hands;
  }

  // ページの外への通信を止めた回数（診断・試験用。CC-032 の status には無い）
  blockedRequests(): number {
    return this.blocked;
  }

  // カメラの新しいフレームごとに呼ぶ
  onVideoFrame(now: number, info: VideoFrameInfo): void {
    if (!this.video || !this.worker || !this.config.enabled) return;
    if (this.pose.state !== 'ready' && this.hands.state !== 'ready') return;
    const hasCapture = typeof info.captureTime === 'number' && info.captureTime > 0;
    const capturedAt = hasCapture ? info.captureTime! : now;
    // 撮影の間隔は揺れるので、目安の 3/4 で判定する（時間で判定し、フレーム数で数えない）
    if (capturedAt - this.lastQueued < POSE_INTERVAL_MS * 0.75) return;
    this.lastQueued = capturedAt;
    let image: VideoFrame | ImageBitmap;
    try {
      image = (this.options.createImage ?? defaultCreateImage)(this.video, capturedAt);
    } catch {
      this.dropped++;
      return;
    }
    const frame: Pending = {
      image,
      frameId: ++this.frameId,
      capturedAt,
      captureSource: hasCapture ? 'captureTime' : 'callback',
    };
    if (this.outstanding < 1) {
      this.send(frame);
      return;
    }
    // 処理中の1枚とは別に、最新の待ちを1枚だけ持つ。古い待ちは閉じて捨てる
    if (this.held) {
      this.held.image.close();
      this.dropped++;
    }
    this.held = frame;
  }

  // ---- 中身

  private handIntervalMs(): number {
    return this.config.mode === 'light' ? LIGHT_HAND_INTERVAL_MS : 0;
  }

  private newGeneration(): void {
    this.generation++;
    this.held?.image.close();
    this.held = null;
    this.lastQueued = -Infinity;
    this.lastPose = -Infinity;
    this.lastHands = -Infinity;
    this.poseTimes = [];
    this.handTimes = [];
    this.dropped = 0;
    this.stale = 0;
  }

  private idle(): void {
    const reason = this.config.enabled ? 'カメラが止まっている' : null;
    this.pose = off(reason);
    this.hands = off(reason);
  }

  private startWorker(): void {
    let worker: BodyWorkerLike;
    try {
      worker = (this.options.createWorker ?? createBlobModuleWorker)(this.urls.worker);
    } catch (error) {
      this.unavailable(`腕の推定を始められない: ${error instanceof Error ? error.message : String(error)}`);
      return;
    }
    this.worker = worker;
    this.outstanding = 0;
    this.pose = { state: 'loading', delegate: null, reason: null };
    this.hands = this.config.hands ? { state: 'loading', delegate: null, reason: null } : off();
    worker.addEventListener('message', (event) => {
      // 止める途中の Worker も推定器を閉じるときに送信を試みるので、外への通信を止めた知らせだけは数える
      if (event.data.type === 'net') this.blocked++;
      else if (this.worker === worker) this.onMessage(event.data);
    });
    worker.addEventListener('error', (event) => {
      event.preventDefault?.();
      if (this.worker !== worker) return;
      this.unavailable(event.message || '腕の推定の Worker を読み込めない');
      this.notifyStatus();
    });
    const { worker: _worker, ...urls } = this.urls;
    worker.postMessage({
      type: 'init',
      pageTimeOrigin: this.options.pageTimeOrigin ?? performance.timeOrigin,
      hands: this.config.hands,
      handIntervalMs: this.handIntervalMs(),
      urls,
    });
  }

  private stopWorker(): void {
    const worker = this.worker;
    this.worker = null;
    this.outstanding = 0;
    this.held?.image.close();
    this.held = null;
    if (!worker) return;
    worker.postMessage({ type: 'stop' });
    // 推定器を閉じる時間を少し与えてから終わらせる（古い世代の結果は世代の照合で捨てる）
    setTimeout(() => worker.terminate(), this.options.terminateDelayMs ?? 500);
  }

  // Worker も推定器も使えない。顔は続け、腕・手は利用できないと示す。重い推定をメインスレッドへ移さない
  private unavailable(reason: string): void {
    const worker = this.worker;
    this.worker = null;
    this.outstanding = 0;
    this.held?.image.close();
    this.held = null;
    worker?.terminate();
    this.pose = { state: 'unavailable', delegate: null, reason };
    this.hands = this.config.hands ? { state: 'unavailable', delegate: null, reason } : off();
  }

  private send(frame: Pending): void {
    const worker = this.worker;
    if (!worker) {
      frame.image.close();
      return;
    }
    try {
      worker.postMessage(
        {
          type: 'frame',
          generation: this.generation,
          frameId: frame.frameId,
          capturedAt: frame.capturedAt,
          captureSource: frame.captureSource,
          image: frame.image,
        },
        [frame.image],
      );
      this.outstanding++;
    } catch {
      frame.image.close();
      this.dropped++;
    }
  }

  private onMessage(message: FromBodyWorker): void {
    switch (message.type) {
      case 'ready':
        this.onReady(message);
        return;
      case 'failed':
        this.unavailable(`腕の推定を始められない: ${message.message}`);
        this.notifyStatus();
        return;
      case 'net':
        return; // 受け取ったときに数えている
      case 'done': {
        this.outstanding = Math.max(0, this.outstanding - 1);
        const held = this.held;
        if (held && this.outstanding < 1) {
          this.held = null;
          this.send(held);
        }
        return;
      }
      case 'pose':
      case 'hands':
        this.accept(message);
        return;
    }
  }

  private onReady(message: ReadyMessage): void {
    const feature = (ready: TaskReady | null): Feature =>
      ready === null
        ? off()
        : ready.delegate
          ? {
              state: 'ready',
              delegate: ready.delegate,
              reason: ready.errors.length ? `GPU を使えず CPU で推定している（${ready.errors.join(' / ')}）` : null,
            }
          : { state: 'unavailable', delegate: null, reason: ready.errors.join(' / ') || '推定器を作れない' };
    this.pose = feature(message.pose);
    this.hands = feature(message.hands);
    if (this.pose.state !== 'ready' && this.hands.state !== 'ready') {
      // どちらも使えないなら Worker を終わらせて資源を手放す
      const worker = this.worker;
      this.worker = null;
      worker?.terminate();
    }
    this.notifyStatus();
  }

  private accept(part: PosePart | HandsPart): void {
    const receivedAt = this.now();
    // 世代違い（止めた後・設定を変えた後）、部位ごとの順序の逆転、期限切れは捨てる
    const last = part.type === 'pose' ? this.lastPose : this.lastHands;
    if (
      part.generation !== this.generation ||
      part.capturedAt <= last ||
      receivedAt - part.capturedAt > ARM_TIMING.resultMaxAgeMs
    ) {
      this.stale++;
      return;
    }
    if (part.value === null) return; // 推定に失敗したフレーム。更新なし（ロストにはしない）
    const time: BodySampleTime = {
      generation: part.generation,
      frameId: part.frameId,
      capturedAt: part.capturedAt,
      captureSource: part.captureSource,
      completedAt: part.completedAt,
      receivedAt,
    };
    const image = { width: part.width, height: part.height };
    let frame: BodyTrackingFrame;
    if (part.type === 'pose') {
      this.lastPose = part.capturedAt;
      this.poseTimes = [...this.poseTimes.filter((t) => t > receivedAt - FPS_WINDOW_MS), receivedAt];
      frame = { image, pose: { time, value: part.value }, hands: null };
    } else {
      this.lastHands = part.capturedAt;
      this.handTimes = [...this.handTimes.filter((t) => t > receivedAt - FPS_WINDOW_MS), receivedAt];
      frame = { image, pose: null, hands: { time, value: part.value } };
    }
    for (const listener of [...this.frameListeners]) {
      try {
        listener(frame);
      } catch (error) {
        console.error('腕・手の観測を受け取る処理で失敗した', error);
      }
    }
  }

  private notifyStatus(): void {
    for (const listener of [...this.statusListeners]) {
      try {
        listener();
      } catch (error) {
        console.error('腕・手の推定の状態を受け取る処理で失敗した', error);
      }
    }
  }
}
