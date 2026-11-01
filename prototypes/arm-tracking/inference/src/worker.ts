// Pose と手（GestureRecognizer）を同じ Worker で順に推定する。顔はページ側で、製品と同じくメインスレッドで推定する。
// HandLandmarker は同時に動かさない（GestureRecognizer が手の点も返す）。
import type {
  BodyResult,
  Delegate,
  FrameMessage,
  FromWorker,
  HandObservation,
  ProbeResult,
  TaskStatus,
  ToWorker,
  WorkerConfig,
} from './protocol';
import type { GestureRecognizer, PoseLandmarker } from '@mediapipe/tasks-vision';
import { LatestSlot } from './queue';

type Vision = typeof import('@mediapipe/tasks-vision');
interface Point {
  x: number;
  y: number;
  z: number;
  visibility?: number;
}
interface Job {
  frame: FrameMessage;
  receivedAt: number;
  close(): void;
}

const post = (message: FromWorker, transfer: Transferable[] = []): void => self.postMessage(message, transfer);
const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error));

let offset = 0; // ページの時刻 = Worker の performance.now() + offset
const now = (): number => performance.now() + offset;

// --- 外部への通信の見張り（MediaPipe は利用状況を fetch で 60 秒ごとに送ろうとする）
// 既定は止めて記録する。netGuard: false のときは記録だけして通す（ネットワーク層の確認用）
let guard = true;
const nativeFetch = self.fetch.bind(self);
self.fetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const url = new URL(input instanceof Request ? input.url : String(input), self.location.href);
  if (url.origin !== self.location.origin) {
    post({ type: 'net', url: url.origin + url.pathname, method: init?.method ?? 'GET', at: now(), blocked: guard });
    if (guard) return Promise.reject(new TypeError('AT-01: ページの外への通信を止めた'));
  }
  return nativeFetch(input, init);
};
const nativeOpen = XMLHttpRequest.prototype.open;
XMLHttpRequest.prototype.open = function (this: XMLHttpRequest, method: string, url: string | URL, ...rest: unknown[]) {
  const target = new URL(String(url), self.location.href);
  if (target.origin !== self.location.origin) {
    post({ type: 'net', url: target.origin + target.pathname, method, at: now(), blocked: guard });
    if (guard) throw new TypeError('AT-01: ページの外への通信を止めた');
  }
  return (nativeOpen as (...args: unknown[]) => void).call(this, method, url, ...rest);
} as typeof XMLHttpRequest.prototype.open;

// 決して解決されない名前へ送る（見張りを通る）。外へ出ない設定が Worker の通信にも効くかを NetLog で確かめる
async function netcheck(): Promise<void> {
  const url = 'https://at01-netcheck.invalid/at01';
  let error: string | null = null;
  try {
    await self.fetch(url, { cache: 'no-store' });
  } catch (caught) {
    error = errorText(caught);
  }
  post({ type: 'netcheck', url, error });
}

// CSP が この Worker に効いているか。違反なら securitypolicyviolation が出る。効いていなければ接続の拒否で終わる
async function probe(): Promise<ProbeResult> {
  let directive: string | null = null;
  const listener = (event: Event): void => {
    directive = (event as SecurityPolicyViolationEvent).effectiveDirective;
  };
  self.addEventListener('securitypolicyviolation', listener);
  let error: string | null = null;
  try {
    await nativeFetch('http://127.0.0.1:9/at01-csp-probe', { mode: 'no-cors', cache: 'no-store' });
  } catch (caught) {
    error = errorText(caught);
  }
  await new Promise((resolve) => setTimeout(resolve, 100));
  self.removeEventListener('securitypolicyviolation', listener);
  return { type: 'probe', violated: directive !== null, directive, error };
}

// --- 推定器
let config: WorkerConfig | null = null;
let pose: PoseLandmarker | null = null;
let gesture: GestureRecognizer | null = null;
let running = false;
let busy = false;
let lastTimestamp = -Infinity;
let lastHandCapture = -Infinity;
const slot = new LatestSlot<Job>();
const shapeSent = { pose: false, gesture: false };

async function create<T>(
  name: TaskStatus['name'],
  order: Delegate[],
  factory: (delegate: Delegate) => Promise<T>,
): Promise<{ task: T | null; status: TaskStatus }> {
  const status: TaskStatus = { name, delegate: null, loadMs: 0, errors: [] };
  const start = performance.now();
  for (const delegate of order) {
    try {
      const task = await factory(delegate);
      status.delegate = delegate;
      status.loadMs = performance.now() - start;
      return { task, status };
    } catch (error) {
      status.errors.push(`${delegate}: ${errorText(error)}`);
    }
  }
  status.loadMs = performance.now() - start;
  return { task: null, status };
}

// gpu-fail の再現: GPU を試す間だけ OffscreenCanvas の webgl2 を取れなくする
async function withGpuBlocked<T>(blocked: boolean, run: () => Promise<T>): Promise<T> {
  if (!blocked) return run();
  const original = OffscreenCanvas.prototype.getContext;
  OffscreenCanvas.prototype.getContext = function (this: OffscreenCanvas, kind: string, ...rest: unknown[]) {
    if (kind === 'webgl2' || kind === 'webgl') return null;
    return (original as (...args: unknown[]) => unknown).call(this, kind, ...rest);
  } as typeof original;
  try {
    return await run();
  } finally {
    OffscreenCanvas.prototype.getContext = original;
  }
}

// モジュール Worker では WASM の読み込み口（ES モジュール）が1度しか評価されない。SDK は推定器を作るたびに
// self.ModuleFactory を消すので、2つ目（手、CPU での作り直し）は「ModuleFactory not set.」で失敗する。
// 読み込んだファクトリを覚えておき、作る直前に入れ直す（クラシック Worker なら importScripts が毎回評価する）
let moduleFactory: unknown = null;
async function restoreFactory(url: string): Promise<void> {
  moduleFactory ??= ((await import(/* @vite-ignore */ url)) as { default: unknown }).default;
  (self as unknown as { ModuleFactory?: unknown }).ModuleFactory = moduleFactory;
}

async function init(next: WorkerConfig): Promise<void> {
  config = next;
  guard = next.netGuard !== false;
  const vision: Vision = await import('@mediapipe/tasks-vision');
  const fileset = { wasmLoaderPath: next.urls.wasmLoader, wasmBinaryPath: next.urls.wasmBinary };
  const order: Delegate[] = next.delegate === 'GPU' && next.fallback ? ['GPU', 'CPU'] : [next.delegate];
  const gpuBlocked = next.simulate === 'gpu-fail';
  const tasks: TaskStatus[] = [];
  if (next.pose) {
    const made = await create('pose', order, (delegate) =>
      withGpuBlocked(gpuBlocked && delegate === 'GPU', async () => {
        await restoreFactory(next.urls.wasmLoader);
        return vision.PoseLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: next.urls.pose, delegate },
          runningMode: 'VIDEO',
          numPoses: 1,
          outputSegmentationMasks: false,
        });
      }),
    );
    pose = made.task;
    tasks.push(made.status);
  }
  if (next.hands) {
    const modelAssetPath = next.simulate === 'gesture-fail' ? next.urls.gesture + '.missing' : next.urls.gesture;
    const made = await create('gesture', order, (delegate) =>
      withGpuBlocked(gpuBlocked && delegate === 'GPU', async () => {
        await restoreFactory(next.urls.wasmLoader);
        return vision.GestureRecognizer.createFromOptions(fileset, {
          baseOptions: { modelAssetPath, delegate },
          runningMode: 'VIDEO',
          numHands: 2,
        });
      }),
    );
    gesture = made.task;
    tasks.push(made.status);
  }
  const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(1, 1) : null;
  running = true;
  post({
    type: 'ready',
    tasks,
    offscreenCanvas: canvas !== null,
    webgl2: canvas?.getContext('webgl2') != null,
  });
}

function flat(points: readonly Point[] | undefined): number[] {
  const out: number[] = [];
  for (const p of points ?? []) out.push(p.x, p.y, p.z, p.visibility ?? Number.NaN);
  return out;
}

function shape(task: 'pose' | 'gesture', samples: Record<string, object | undefined>, points: readonly Point[]): void {
  if (shapeSent[task]) return;
  shapeSent[task] = true;
  const keys: Record<string, string[]> = {};
  for (const [name, sample] of Object.entries(samples)) keys[name] = sample ? Object.keys(sample) : [];
  const values = points.map((p) => p.visibility).filter((v): v is number => typeof v === 'number');
  post({
    type: 'shape',
    task,
    keys,
    visibility: {
      min: values.length ? Math.min(...values) : Number.NaN,
      max: values.length ? Math.max(...values) : Number.NaN,
      count: values.length,
    },
  });
}

function process(job: Job): void {
  const { frame } = job;
  const errors: string[] = [];
  // detectForVideo の時刻は推定器ごとに増え続ける必要がある
  const timestamp = frame.captureTime > lastTimestamp ? frame.captureTime : lastTimestamp + 0.001;
  lastTimestamp = timestamp;
  const image = frame.image;
  const width = 'displayWidth' in image ? image.displayWidth : image.width;
  const height = 'displayHeight' in image ? image.displayHeight : image.height;
  let poseStart: number | null = null;
  let poseEnd: number | null = null;
  let poseOut: BodyResult['pose'] = null;
  if (pose) {
    poseStart = now();
    try {
      const result = pose.detectForVideo(image, timestamp);
      const points = result.landmarks[0] ?? [];
      poseOut = { landmarks: flat(points), world: flat(result.worldLandmarks[0]) };
      if (points.length) shape('pose', { landmark: points[0], world: result.worldLandmarks[0]?.[0] }, points);
    } catch (error) {
      errors.push(`pose: ${errorText(error)}`);
    }
    poseEnd = now();
  }
  const base = {
    type: 'result' as const,
    id: frame.id,
    generation: frame.generation,
    captureTime: frame.captureTime,
    sentAt: frame.sentAt,
    receivedAt: job.receivedAt,
    width,
    height,
  };
  const interval = config?.handIntervalMs ?? 0;
  // 軽量案は撮影時刻で間引く（フレーム数では数えない）。撮影の間隔は揺れるので、間隔の 3/4 を超えたら推定する
  const handsDue = gesture !== null && frame.captureTime - lastHandCapture >= interval * 0.75;
  // 腕を手の推定で待たせないよう、Pose の結果を先に送る（splitPost）。手の推定がこのフレームで無ければ1通で送る
  const split = (config?.splitPost ?? true) && pose !== null && handsDue;
  if (split) {
    post({
      ...base,
      poseStart,
      poseEnd,
      handStart: null,
      handEnd: null,
      postedAt: now(),
      pose: poseOut,
      hands: null,
      final: false,
      dropped: slot.dropped,
      errors: errors.splice(0),
    });
  }
  let handStart: number | null = null;
  let handEnd: number | null = null;
  let hands: HandObservation[] | null = null;
  if (gesture && handsDue) {
    lastHandCapture = frame.captureTime;
    handStart = now();
    try {
      const result = gesture.recognizeForVideo(image, timestamp);
      hands = result.landmarks.map((points, i) => {
        const side = result.handedness[i]?.[0];
        return {
          handedness: side ? { categoryName: side.categoryName, score: side.score, index: side.index } : null,
          gestures: (result.gestures[i] ?? []).map((g) => ({ categoryName: g.categoryName, score: g.score })),
          landmarks: flat(points),
          world: flat(result.worldLandmarks[i]),
        };
      });
      const first = result.landmarks[0];
      if (first?.length)
        shape(
          'gesture',
          {
            landmark: first[0],
            world: result.worldLandmarks[0]?.[0],
            handedness: result.handedness[0]?.[0],
            gesture: result.gestures[0]?.[0],
          },
          result.landmarks.flat(),
        );
    } catch (error) {
      errors.push(`gesture: ${errorText(error)}`);
    }
    handEnd = now();
  }
  job.close();
  post({
    ...base,
    poseStart: split ? null : poseStart,
    poseEnd: split ? null : poseEnd,
    handStart,
    handEnd,
    postedAt: now(),
    pose: split ? null : poseOut,
    hands,
    final: true,
    dropped: slot.dropped,
    errors,
  });
}

function pump(): void {
  if (busy) return;
  busy = true;
  try {
    for (let job = slot.take(); job && running; job = slot.take()) process(job);
  } finally {
    busy = false;
  }
}

function stop(): void {
  running = false;
  slot.clear();
  pose?.close();
  gesture?.close();
  pose = null;
  gesture = null;
}

self.addEventListener('message', (event: MessageEvent<ToWorker>) => {
  const message = event.data;
  switch (message.type) {
    case 'init':
      offset = performance.timeOrigin - message.pageTimeOrigin;
      init(message.config).catch((error: unknown) => post({ type: 'error', stage: 'init', message: errorText(error) }));
      return;
    case 'frame': {
      const job: Job = { frame: message, receivedAt: now(), close: () => message.image.close() };
      if (!running) {
        job.close();
        return;
      }
      slot.offer(job);
      pump();
      return;
    }
    case 'probe':
      void probe().then(post);
      return;
    case 'netcheck':
      void netcheck();
      return;
    case 'stop':
      stop();
      return;
  }
});
