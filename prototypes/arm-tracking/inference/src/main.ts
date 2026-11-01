// AT-01 の試作ページ。顔は製品と同じ関数でメインスレッドに、Pose と手は Worker で推定し、時刻と負荷を記録する。
// カメラの映像は推定器と画面にだけ使い、保存しない。保存するのは点列と計測値だけ。
import {
  createMediaPipeFaceLandmarker,
  defaultMediaPipeAssetUrls,
  type FaceLandmarkerLike,
} from '@app/tracking/src/source/landmarker';
import { createRenderLoad, type RenderLoad } from './load';
import workerUrl from './worker.ts?worker&url';
import { summarize, type BodyRecord, type FrameRecord, type Timeline } from './metrics';
import type {
  BodyResult,
  FromWorker,
  NetcheckResult,
  NetMessage,
  ProbeResult,
  ReadyMessage,
  ShapeMessage,
  ToWorker,
} from './protocol';
import { POSE, STRIDE } from './protocol';
import { COORDINATES, roundPose, toRecHand, type RecFrame, type Recording } from './record';
import { SCENARIOS, otherHandNote, type Scenario } from './scenarios';

export interface RunConfig {
  deviceId: string | null;
  width: number;
  height: number;
  fps: number;
  face: boolean;
  pose: boolean;
  hands: boolean;
  handHz: number; // 30（通常）・15（軽量案）
  poseHz: number; // Worker へ送る上限
  poseModel: 'lite' | 'full';
  delegate: 'GPU' | 'CPU';
  fallback: boolean;
  transfer: 'videoframe' | 'imagebitmap';
  load: number; // 合成の描画負荷のパーツ数。0 で描かない
  overlay: boolean;
  mirrorPreview: boolean; // 画面のプレビューだけを左右反転する。推定器へは未反転で渡す
  simulate: 'none' | 'gpu-fail' | 'gesture-fail' | 'worker-fail' | 'transfer-fail';
  splitPost: boolean; // Pose の結果を手の推定の前に受け取る
  workers: 1 | 2; // 1: Pose と手を同じ Worker で順に、2: 別々の Worker で並行に
  handDelegate: 'GPU' | 'CPU' | null; // 手だけ別の実行先にする（null は delegate と同じ）
  netGuard: boolean; // false は Worker の外部通信を止めずに記録だけする（外へ出ない設定で起動したときだけ使う）
  blobWorker: boolean; // Worker を blob の URL で包み、ページの CSP を引き継がせる（AT-04 の候補の確認）
}

export const DEFAULT_CONFIG: RunConfig = {
  deviceId: null,
  width: 640,
  height: 480,
  fps: 30,
  face: true,
  pose: true,
  hands: true,
  handHz: 30,
  poseHz: 30,
  poseModel: 'lite',
  delegate: 'GPU',
  fallback: true,
  transfer: 'videoframe',
  load: 120,
  overlay: true,
  mirrorPreview: true,
  simulate: 'none',
  splitPost: true,
  workers: 1,
  handDelegate: null,
  netGuard: true,
  blobWorker: false,
};

// blob の URL から本物の Worker のモジュールを読み込む。blob の Worker は作ったページの CSP を引き継ぐ
function createBlobWorker(): Worker {
  const source = `import ${JSON.stringify(new URL(workerUrl, document.baseURI).href)};`;
  return new Worker(URL.createObjectURL(new Blob([source], { type: 'text/javascript' })), { type: 'module' });
}

interface Held {
  image: VideoFrame | ImageBitmap;
  record: FrameRecord;
}

// 推定 Worker 1つ分。body は Pose と手を同じ Worker で順に、pose・hands は別々の Worker で並行に推定する
interface Lane {
  kind: 'body' | 'pose' | 'hands';
  worker: Worker | null;
  state: 'loading' | 'ready' | 'unavailable';
  error: string | null;
  ready: ReadyMessage | null;
  outstanding: number;
  held: Held | null;
  lastQueuedCapture: number;
  intervalMs: number; // ページから送る間隔の目安（撮影時刻で測る）
}

interface Session {
  config: RunConfig;
  generation: number;
  stream: MediaStream;
  video: HTMLVideoElement;
  startedAt: number;
  firstPoseMs: number | null; // 開始から最初の Pose の結果が届くまで（推定器の初回の準備を含む）
  firstHandsMs: number | null;
  lanes: Lane[];
  lastPoseCapture: number;
  lastHandCapture: number;
  frameId: number;
  faceTimestamp: number;
  cancelFrame: () => void;
  latestPose: number[] | null;
  latestHands: BodyResult['hands'];
  partialPose: { id: number; pose: BodyResult['pose'] } | null; // 先に届いた Pose（収録で手の結果と1フレームにまとめる）
  toApply: BodyRecord[]; // 届いてまだ描いていない結果
  latestFace: boolean | null;
  frameById: Map<number, FrameRecord>;
}

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error));

// Vite が同梱する URL（実行時にネットワークへ取りに行かない）。Worker はモジュール Worker なので module 版の WASM を使う
const WORKER_URLS = {
  wasmLoader: new URL(
    '../../../../packages/tracking/node_modules/@mediapipe/tasks-vision/wasm/vision_wasm_module_internal.js',
    import.meta.url,
  ).href,
  wasmBinary: new URL(
    '../../../../packages/tracking/node_modules/@mediapipe/tasks-vision/wasm/vision_wasm_module_internal.wasm',
    import.meta.url,
  ).href,
};
// モデルは .cache/arm-tracking/models から publicDir として配る（リポジトリには入れない）
const modelUrl = (name: string): string => new URL(name, document.baseURI).href;

const timeline: Timeline = { frames: [], bodies: [], rafs: [], longTasks: [], mainDropped: [], transferErrors: [] };
const netAttempts: (NetMessage & { from: 'worker' | 'page' })[] = [];
const shapes: ShapeMessage[] = [];
let session: Session | null = null;
let generation = 0;
let face: Promise<FaceLandmarkerLike> | null = null;
let load: RenderLoad | null = null;
let loadParts = -1;
let recording: Recording | null = null;
let currentStep: string | null = null;
let probeWaiter: ((result: ProbeResult) => void) | null = null;
let netcheckWaiter: ((result: NetcheckResult) => void) | null = null;

// --- ページ自身の CSP 違反（製品と同じく HTML に CSP がある）
document.addEventListener('securitypolicyviolation', (event) => {
  netAttempts.push({
    type: 'net',
    from: 'page',
    url: event.blockedURI,
    method: event.effectiveDirective,
    at: performance.now(),
    blocked: true,
  });
});

try {
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries())
      timeline.longTasks.push({ start: entry.startTime, duration: entry.duration });
  }).observe({ type: 'longtask', buffered: false });
} catch {
  // longtask が無い環境では数えない
}

function loadFace(): Promise<FaceLandmarkerLike> {
  face ??= createMediaPipeFaceLandmarker(defaultMediaPipeAssetUrls()).catch((error: unknown) => {
    face = null;
    throw error;
  });
  return face;
}

function trim(): void {
  if (recording) return;
  const before = performance.now() - 120_000;
  const keep = <T>(items: T[], time: (item: T) => number): T[] => items.filter((item) => time(item) >= before);
  timeline.frames = keep(timeline.frames, (f) => f.now);
  timeline.bodies = keep(timeline.bodies, (b) => b.arrivedAt);
  timeline.rafs = keep(timeline.rafs, (t) => t);
  timeline.longTasks = keep(timeline.longTasks, (t) => t.start);
  timeline.mainDropped = keep(timeline.mainDropped, (t) => t);
  timeline.transferErrors = keep(timeline.transferErrors, (t) => t);
}

// --- Worker
function startWorkers(s: Session): void {
  const { config } = s;
  if (!config.pose && !config.hands) return;
  const kinds: Lane['kind'][] = config.workers === 2 && config.pose && config.hands ? ['pose', 'hands'] : ['body'];
  for (const kind of kinds) s.lanes.push(startLane(s, kind));
}

function startLane(s: Session, kind: Lane['kind']): Lane {
  const { config } = s;
  const lane: Lane = {
    kind,
    worker: null,
    state: 'loading',
    error: null,
    ready: null,
    outstanding: 0,
    held: null,
    lastQueuedCapture: -Infinity,
    intervalMs: kind === 'hands' ? 1000 / config.handHz : 1000 / config.poseHz,
  };
  try {
    lane.worker =
      config.simulate === 'worker-fail'
        ? new Worker(new URL('at01-missing-worker.js', document.baseURI), { type: 'module' })
        : config.blobWorker
          ? createBlobWorker()
          : new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  } catch (error) {
    lane.state = 'unavailable';
    lane.error = errorText(error);
    return lane;
  }
  const worker = lane.worker;
  worker.addEventListener('error', (event) => {
    event.preventDefault();
    if (session !== s) return;
    lane.state = 'unavailable';
    lane.error = event.message || 'Worker を読み込めない';
  });
  worker.addEventListener('message', (event: MessageEvent<FromWorker>) => onWorkerMessage(s, lane, event.data));
  const message: ToWorker = {
    type: 'init',
    pageTimeOrigin: performance.timeOrigin,
    config: {
      delegate: kind === 'hands' ? (config.handDelegate ?? config.delegate) : config.delegate,
      fallback: config.fallback,
      poseModel: config.poseModel,
      pose: kind !== 'hands' && config.pose,
      hands: kind !== 'pose' && config.hands,
      // 同じ Worker のときは Worker の中で手を間引く。別々のときはページが手の Worker へ送る間隔で間引く
      handIntervalMs: kind === 'body' && config.handHz < config.poseHz ? 1000 / config.handHz : 0,
      splitPost: config.splitPost,
      urls: {
        ...WORKER_URLS,
        pose: modelUrl(`pose_landmarker_${config.poseModel}.task`),
        gesture: modelUrl('gesture_recognizer.task'),
      },
      simulate: config.simulate === 'gpu-fail' || config.simulate === 'gesture-fail' ? config.simulate : undefined,
      netGuard: config.netGuard,
    },
  };
  worker.postMessage(message);
  return lane;
}

function onWorkerMessage(s: Session, lane: Lane, message: FromWorker): void {
  switch (message.type) {
    case 'ready':
      if (session !== s) return;
      lane.ready = message;
      lane.state = message.tasks.some((t) => t.delegate !== null) ? 'ready' : 'unavailable';
      if (lane.state === 'unavailable') lane.error = message.tasks.flatMap((t) => t.errors).join(' / ');
      return;
    case 'error':
      if (session !== s) return;
      lane.state = 'unavailable';
      lane.error = `${message.stage}: ${message.message}`;
      return;
    case 'net':
      netAttempts.push({ ...message, from: 'worker' });
      return;
    case 'shape':
      shapes.push(message);
      return;
    case 'probe':
      probeWaiter?.(message);
      probeWaiter = null;
      return;
    case 'netcheck':
      netcheckWaiter?.(message);
      netcheckWaiter = null;
      return;
    case 'result':
      onResult(s, lane, message);
      return;
  }
}

function onResult(s: Session, lane: Lane, result: BodyResult): void {
  const arrivedAt = performance.now();
  // 世代違い（止めた後・設定を変えた後）と、Pose・手それぞれの順序の逆転は捨てる
  const stale =
    session !== s ||
    result.generation !== s.generation ||
    (result.pose !== null && result.captureTime <= s.lastPoseCapture) ||
    (result.hands !== null && result.captureTime <= s.lastHandCapture);
  const record: BodyRecord = {
    id: result.id,
    captureTime: result.captureTime,
    sentAt: result.sentAt,
    receivedAt: result.receivedAt,
    poseStart: result.poseStart,
    poseEnd: result.poseEnd,
    handStart: result.handStart,
    handEnd: result.handEnd,
    postedAt: result.postedAt,
    arrivedAt,
    appliedAt: null,
    poseDetected: result.pose ? result.pose.landmarks.length > 0 : null,
    hands: result.hands ? result.hands.length : null,
    stale,
  };
  timeline.bodies.push(record);
  if (!stale) {
    if (result.pose) {
      s.lastPoseCapture = result.captureTime;
      s.latestPose = result.pose.landmarks;
      s.firstPoseMs ??= arrivedAt - s.startedAt;
    }
    if (result.hands) {
      s.lastHandCapture = result.captureTime;
      s.latestHands = result.hands;
      s.firstHandsMs ??= arrivedAt - s.startedAt;
    }
    s.toApply.push(record);
    if (!result.final) s.partialPose = { id: result.id, pose: result.pose };
    else if (recording && currentStep) {
      // 別々の Worker のときは Pose だけ・手だけのフレームとして残る（null は推定していない）
      const pose = result.pose ?? (s.partialPose?.id === result.id ? s.partialPose.pose : null);
      const frame: RecFrame = {
        t: result.captureTime,
        step: currentStep,
        face: s.frameById.get(result.id)?.faceDetected ?? null,
        pose: roundPose(pose?.landmarks),
        poseWorld: roundPose(pose?.world),
        hands: result.hands ? result.hands.map(toRecHand) : null,
      };
      recording.frames.push(frame);
    }
  }
  // Worker が次のフレームを受けられるのは、そのフレームの最後の結果を送った後
  if (!result.final || session !== s) return;
  lane.outstanding = Math.max(0, lane.outstanding - 1);
  const held = lane.held;
  if (held) {
    lane.held = null;
    send(s, lane, held.image, held.record);
  }
}

function send(s: Session, lane: Lane, image: VideoFrame | ImageBitmap, record: FrameRecord): void {
  if (!lane.worker || session !== s) {
    image.close();
    return;
  }
  if (s.config.simulate === 'transfer-fail' && record.id % 30 === 0) image.close(); // 閉じた画像を渡して失敗させる
  try {
    const message: ToWorker = {
      type: 'frame',
      id: record.id,
      generation: s.generation,
      captureTime: record.capture,
      sentAt: performance.now(),
      image,
    };
    lane.worker.postMessage(message, [image]);
    lane.outstanding++;
    record.sent = true;
  } catch {
    timeline.transferErrors.push(performance.now());
    image.close();
  }
}

// 処理中の1枚と、最新の待ち1枚だけ。待ちを置き換えるときは古い方を閉じる
function offer(s: Session, lane: Lane, image: VideoFrame | ImageBitmap, record: FrameRecord): void {
  if (session !== s) {
    image.close();
    return;
  }
  if (lane.outstanding < 1) {
    send(s, lane, image, record);
    return;
  }
  if (lane.held) {
    lane.held.image.close();
    timeline.mainDropped.push(performance.now());
  }
  lane.held = { image, record };
}

function queueFrame(s: Session, record: FrameRecord, lanes: Lane[]): void {
  const start = performance.now();
  if (s.config.transfer === 'videoframe') {
    let image: VideoFrame;
    try {
      image = new VideoFrame(s.video, { timestamp: Math.round(record.capture * 1000) });
    } catch {
      timeline.transferErrors.push(performance.now());
      return;
    }
    // 2つ目の Worker へは clone を渡す（画素は複製せず、閉じる責任だけが別になる）
    const images = lanes.map((_, i) => (i === 0 ? image : image.clone()));
    record.createMs = performance.now() - start;
    lanes.forEach((lane, i) => offer(s, lane, images[i]!, record));
    return;
  }
  for (const lane of lanes) {
    createImageBitmap(s.video).then(
      (image) => {
        record.createMs = performance.now() - start;
        offer(s, lane, image, record);
      },
      () => timeline.transferErrors.push(performance.now()),
    );
  }
}

// --- カメラのフレームごと
function onVideoFrame(s: Session, faceTask: FaceLandmarkerLike | null, now: number, meta: VideoFrameCallbackMetadata) {
  if (session !== s) return;
  s.cancelFrame = scheduleFrame(s, faceTask);
  const id = ++s.frameId;
  const hasCapture = typeof meta.captureTime === 'number' && meta.captureTime > 0;
  const record: FrameRecord = {
    id,
    now,
    capture: hasCapture ? meta.captureTime! : now,
    captureSource: hasCapture ? 'captureTime' : 'callback',
    presentationTime: meta.presentationTime ?? null,
    expectedDisplayTime: meta.expectedDisplayTime ?? null,
    faceStart: null,
    faceEnd: null,
    faceDetected: null,
    sent: false,
    createMs: null,
  };
  timeline.frames.push(record);
  s.frameById.set(id, record);
  s.frameById.delete(id - 300);
  // 先に Worker へ渡してから顔を推定する（顔の推定中に Worker が並行して動く）。撮影の間隔は揺れるので、目安の 3/4 で判定する
  const due = s.lanes.filter(
    (lane) => lane.state === 'ready' && record.capture - lane.lastQueuedCapture >= lane.intervalMs * 0.75,
  );
  for (const lane of due) lane.lastQueuedCapture = record.capture;
  if (due.length) queueFrame(s, record, due);
  if (faceTask) {
    const time = record.capture > s.faceTimestamp ? record.capture : s.faceTimestamp + 0.001;
    s.faceTimestamp = time;
    record.faceStart = performance.now();
    try {
      const result = faceTask.detectForVideo(s.video, time);
      record.faceDetected = result.facialTransformationMatrixes.length > 0;
    } catch {
      record.faceDetected = false;
    }
    record.faceEnd = performance.now();
    s.latestFace = record.faceDetected;
  }
}

function scheduleFrame(s: Session, faceTask: FaceLandmarkerLike | null): () => void {
  const handle = s.video.requestVideoFrameCallback((now, meta) => onVideoFrame(s, faceTask, now, meta));
  return () => s.video.cancelVideoFrameCallback(handle);
}

// --- 開始・停止
export async function start(next: Partial<RunConfig> = {}): Promise<ReturnType<typeof status>> {
  stop();
  const config: RunConfig = { ...DEFAULT_CONFIG, ...next };
  const myGeneration = ++generation;
  const constraints: MediaStreamConstraints = {
    audio: false,
    video: {
      ...(config.deviceId ? { deviceId: { exact: config.deviceId } } : {}),
      width: { ideal: config.width },
      height: { ideal: config.height },
      frameRate: { ideal: config.fps },
    },
  };
  const startedAt = performance.now();
  // 待っている間に stop() されたら世代が変わる。取れたカメラ・映像は、どこで止まっても失敗しても必ず閉じる
  const stale = (): boolean => myGeneration !== generation;
  const [camera, faceLoad] = await Promise.allSettled([
    navigator.mediaDevices.getUserMedia(constraints),
    config.face ? loadFace() : Promise.resolve(null),
  ]);
  const stream = camera.status === 'fulfilled' ? camera.value : null;
  const release = (video?: HTMLVideoElement): void => {
    if (video) {
      video.pause();
      video.srcObject = null;
      video.remove();
    }
    for (const track of stream?.getTracks() ?? []) track.stop();
  };
  if (camera.status === 'rejected') throw camera.reason;
  if (faceLoad.status === 'rejected') {
    release();
    throw faceLoad.reason;
  }
  if (stale()) {
    release();
    throw new Error('開始の途中で止められた');
  }
  const faceTask = faceLoad.value;
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.style.cssText = 'position:fixed;left:0;top:0;width:1px;height:1px;opacity:0;pointer-events:none;';
  document.body.appendChild(video);
  video.srcObject = stream;
  try {
    await video.play();
  } catch (error) {
    release(video);
    throw error;
  }
  if (stale()) {
    release(video);
    throw new Error('開始の途中で止められた');
  }
  const s: Session = {
    config,
    generation: myGeneration,
    stream: stream!,
    video,
    startedAt,
    firstPoseMs: null,
    firstHandsMs: null,
    lanes: [],
    lastPoseCapture: -Infinity,
    lastHandCapture: -Infinity,
    frameId: 0,
    faceTimestamp: -Infinity,
    cancelFrame: () => {},
    latestPose: null,
    latestHands: null,
    partialPose: null,
    toApply: [],
    latestFace: null,
    frameById: new Map(),
  };
  session = s;
  startWorkers(s);
  s.cancelFrame = scheduleFrame(s, faceTask);
  // Worker の準備（または失敗）を待つ
  const until = performance.now() + 30_000;
  while (s.lanes.some((lane) => lane.state === 'loading') && performance.now() < until && session === s)
    await sleep(50);
  return status();
}

export function stop(): void {
  generation++; // 開始の途中なら、その開始を取り消す
  const s = session;
  if (!s) return;
  session = null;
  s.cancelFrame();
  for (const lane of s.lanes) {
    lane.held?.image.close();
    lane.held = null;
    const worker = lane.worker;
    if (!worker) continue;
    worker.postMessage({ type: 'stop' } satisfies ToWorker);
    // 推定器を閉じる時間を少し与えてから Worker を終わらせる
    setTimeout(() => worker.terminate(), 500);
  }
  for (const track of s.stream.getTracks()) track.stop();
  s.video.pause();
  s.video.srcObject = null;
  s.video.remove();
}

export function status() {
  const s = session;
  const settings = s?.stream.getVideoTracks()[0]?.getSettings();
  return {
    running: s !== null,
    config: s?.config ?? null,
    firstResultMs: s ? { pose: s.firstPoseMs, hands: s.firstHandsMs } : null,
    camera: settings
      ? {
          label: s?.stream.getVideoTracks()[0]?.label ?? null,
          width: settings.width ?? null,
          height: settings.height ?? null,
          frameRate: settings.frameRate ?? null,
        }
      : null,
    // Worker が複数のときはまとめる（どれかが使えなければ unavailable）
    worker: s ? workerStatus(s) : null,
    net: netAttempts.slice(),
    shapes: shapes.slice(),
  };
}

function workerStatus(s: Session) {
  const state = s.lanes.some((l) => l.state === 'unavailable')
    ? 'unavailable'
    : s.lanes.some((l) => l.state === 'loading')
      ? 'loading'
      : s.lanes.length
        ? 'ready'
        : 'off';
  return {
    state,
    error:
      s.lanes
        .map((l) => l.error)
        .filter(Boolean)
        .join(' / ') || null,
    ready: s.lanes.length ? { tasks: s.lanes.flatMap((l) => l.ready?.tasks ?? []) } : null,
    lanes: s.lanes.map((l) => ({ kind: l.kind, state: l.state, tasks: l.ready?.tasks ?? [] })),
  };
}

// --- 描画（合成の負荷とプレビュー）
const ARMS: [number, number, string][] = [
  [POSE.leftShoulder, POSE.leftElbow, '#3ddc84'],
  [POSE.leftElbow, POSE.leftWrist, '#3ddc84'],
  [POSE.rightShoulder, POSE.rightElbow, '#ff9f43'],
  [POSE.rightElbow, POSE.rightWrist, '#ff9f43'],
  [POSE.leftShoulder, POSE.rightShoulder, '#cccccc'],
];

function drawOverlay(s: Session | null): void {
  const canvas = $<HTMLCanvasElement>('overlay');
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#111';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  if (!s || !s.config.overlay) return;
  const w = canvas.width;
  const h = canvas.height;
  const mirror = s.config.mirrorPreview;
  ctx.save();
  if (mirror) {
    ctx.translate(w, 0);
    ctx.scale(-1, 1);
  }
  ctx.drawImage(s.video, 0, 0, w, h);
  ctx.restore();
  const px = (x: number): number => (mirror ? 1 - x : x) * w;
  const pose = s.latestPose;
  if (pose?.length) {
    ctx.lineWidth = 4;
    for (const [a, b, color] of ARMS) {
      ctx.strokeStyle = color;
      ctx.globalAlpha = Math.max(0.15, Math.min(pose[a * STRIDE + 3] ?? 1, pose[b * STRIDE + 3] ?? 1));
      ctx.beginPath();
      ctx.moveTo(px(pose[a * STRIDE]!), pose[a * STRIDE + 1]! * h);
      ctx.lineTo(px(pose[b * STRIDE]!), pose[b * STRIDE + 1]! * h);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }
  ctx.font = '14px sans-serif';
  for (const hand of s.latestHands ?? []) {
    const lm = hand.landmarks;
    ctx.fillStyle = hand.handedness?.categoryName === 'Left' ? '#7bdcff' : '#ff7bd5';
    for (let i = 0; i < lm.length; i += STRIDE) ctx.fillRect(px(lm[i]!) - 2, lm[i + 1]! * h - 2, 4, 4);
    const label = `SDK:${hand.handedness?.categoryName ?? '?'} ${hand.gestures[0]?.categoryName ?? ''}`;
    ctx.fillText(label, px(lm[0]!) + 6, lm[1]! * h + 16);
  }
  ctx.fillStyle = s.latestFace ? '#3ddc84' : '#ff5c5c';
  ctx.fillText(s.latestFace === null ? '顔: 推定なし' : s.latestFace ? '顔: あり' : '顔: なし', 8, 18);
  ctx.fillStyle = '#ffffff';
  ctx.fillText(mirror ? 'プレビューのみ左右反転（推定は未反転）' : 'プレビュー未反転', 8, h - 8);
}

function frame(time: number): void {
  timeline.rafs.push(time);
  const s = session;
  const parts = s?.config.load ?? DEFAULT_CONFIG.load;
  if (parts !== loadParts) {
    load?.dispose();
    load = parts > 0 ? createRenderLoad($<HTMLCanvasElement>('load'), parts) : null;
    loadParts = parts;
  }
  load?.draw(time);
  drawOverlay(s);
  // 描いた結果の時刻（画面に出るのはさらに後）。前の描画から届いた結果のうち、実際に描いた最新の Pose と手だけに付ける。
  // 描く前に新しい結果で置き換わった分と、プレビューを描かないときは付けない
  if (s?.toApply.length) {
    const drawn = performance.now();
    if (s.config.overlay) {
      const latest = [...s.toApply].reverse();
      const pose = latest.find((r) => r.poseEnd !== null);
      const hands = latest.find((r) => r.handEnd !== null);
      if (pose) pose.appliedAt = drawn;
      if (hands) hands.appliedAt = drawn;
    }
    s.toApply = [];
  }
  requestAnimationFrame(frame);
}

// --- 計測
export async function measure(durationMs = 15_000, warmupMs = 4_000) {
  await sleep(warmupMs);
  const start = performance.now();
  await sleep(durationMs);
  const end = performance.now();
  return {
    measuredAt: new Date().toISOString(),
    visibility: document.visibilityState,
    status: status(),
    window: { start, end },
    summary: summarize(timeline, start, end),
    timeline: windowed(start, end),
  };
}

// 集計窓の前後1秒を含む生の記録（0.1ms に丸める）。summary を独立に計算し直すために保存する
function windowed(start: number, end: number) {
  const r = (v: number | null): number | null => (v === null ? null : Math.round(v * 10) / 10);
  const near = (t: number | null): boolean => t !== null && t >= start - 1000 && t < end + 1000;
  return {
    frames: timeline.frames
      .filter((f) => near(f.now))
      .map((f) => [
        f.id,
        r(f.now),
        r(f.capture),
        f.captureSource,
        r(f.faceStart),
        r(f.faceEnd),
        f.faceDetected,
        f.sent,
      ]),
    framesColumns: ['id', 'now', 'capture', 'captureSource', 'faceStart', 'faceEnd', 'faceDetected', 'sent'],
    bodies: timeline.bodies
      .filter((b) => near(b.arrivedAt))
      .map((b) => [
        b.id,
        r(b.captureTime),
        r(b.sentAt),
        r(b.receivedAt),
        r(b.poseStart),
        r(b.poseEnd),
        r(b.handStart),
        r(b.handEnd),
        r(b.postedAt),
        r(b.arrivedAt),
        r(b.appliedAt),
        b.poseDetected,
        b.hands,
        b.stale,
      ]),
    bodiesColumns: [
      'id',
      'captureTime',
      'sentAt',
      'receivedAt',
      'poseStart',
      'poseEnd',
      'handStart',
      'handEnd',
      'postedAt',
      'arrivedAt',
      'appliedAt',
      'poseDetected',
      'hands',
      'stale',
    ],
    rafs: timeline.rafs.filter((t) => near(t)).map(r),
    longTasks: timeline.longTasks.filter((t) => near(t.start)).map((t) => [r(t.start), r(t.duration)]),
    mainDropped: timeline.mainDropped.filter((t) => near(t)).map(r),
    transferErrors: timeline.transferErrors.filter((t) => near(t)).map(r),
  };
}

export function environment() {
  const gl = document.createElement('canvas').getContext('webgl2');
  const info = gl?.getExtension('WEBGL_debug_renderer_info');
  const brands = (navigator as Navigator & { userAgentData?: { brands: { brand: string; version: string }[] } })
    .userAgentData?.brands;
  return {
    userAgent: navigator.userAgent,
    brands: brands ?? null,
    hardwareConcurrency: navigator.hardwareConcurrency,
    devicePixelRatio,
    viewport: { width: innerWidth, height: innerHeight },
    webgl: info && gl ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : null,
    videoFrame: typeof VideoFrame !== 'undefined',
    offscreenCanvas: typeof OffscreenCanvas !== 'undefined',
    worker: typeof Worker !== 'undefined',
    origin: location.origin,
  };
}

// ページと Worker のそれぞれで、CSP が効いているかを送り先の無い 127.0.0.1:9 で確かめる
export async function probe(): Promise<{ page: ProbeResult; worker: ProbeResult | null }> {
  let directive: string | null = null;
  const listener = (event: SecurityPolicyViolationEvent): void => {
    if (event.blockedURI.includes('127.0.0.1')) directive = event.effectiveDirective;
  };
  document.addEventListener('securitypolicyviolation', listener);
  let error: string | null = null;
  try {
    await fetch('http://127.0.0.1:9/at01-csp-probe-page', { mode: 'no-cors', cache: 'no-store' });
  } catch (caught) {
    error = errorText(caught);
  }
  await sleep(100);
  document.removeEventListener('securitypolicyviolation', listener);
  const page: ProbeResult = { type: 'probe', violated: directive !== null, directive, error };
  const s = session;
  const lane = s?.lanes.find((l) => l.state === 'ready' && l.worker);
  if (!lane) return { page, worker: null };
  const worker = await new Promise<ProbeResult>((resolve) => {
    probeWaiter = resolve;
    lane.worker!.postMessage({ type: 'probe' } satisfies ToWorker);
  });
  return { page, worker };
}

// 最初の Worker に、決して解決されない名前へ送らせる（ネットワーク層の確認用）
export async function netcheck(): Promise<NetcheckResult | null> {
  const lane = session?.lanes.find((l) => l.state === 'ready' && l.worker);
  if (!lane) return null;
  return new Promise<NetcheckResult>((resolve) => {
    netcheckWaiter = resolve;
    lane.worker!.postMessage({ type: 'netcheck' } satisfies ToWorker);
  });
}

// --- 保存（ホストの窓では IPC でファイルへ、ふつうのブラウザーではダウンロード）
export function save(name: string, data: unknown): Promise<boolean> {
  const text = JSON.stringify(data, null, 1);
  const ipc = (window as Window & { ipc?: { postMessage(message: string): void } }).ipc;
  if (!ipc) {
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    link.download = name;
    link.click();
    return Promise.resolve(true);
  }
  return new Promise((resolve) => {
    const listener = (event: Event): void => {
      const detail = (event as CustomEvent<{ name: string; ok: boolean }>).detail;
      if (detail.name !== name) return;
      window.removeEventListener('at01-saved', listener);
      resolve(detail.ok);
    };
    window.addEventListener('at01-saved', listener);
    ipc.postMessage(JSON.stringify({ type: 'save', name, text }));
  });
}

// --- 案内つきの収録。案内の文が正解になる
// 収録中は鏡像のプレビューを大きく出す（右手が画面の右側に映る）。R キーでその区間をやり直す（その区間の点列は捨てる）
export async function guided(options: { prepMs?: number; recordMs?: number; steps?: string[] } = {}) {
  const s = session;
  if (!s?.lanes.length || s.lanes.some((l) => l.state !== 'ready'))
    throw new Error('Pose・手の推定を開始してから収録する');
  const prepMs = options.prepMs ?? 5000;
  const recordMs = options.recordMs ?? 6000;
  const steps: Scenario[] = options.steps
    ? SCENARIOS.filter((scenario) => options.steps!.includes(scenario.id))
    : SCENARIOS;
  const rec: Recording = {
    format: 'at01-points/1',
    createdAt: new Date().toISOString(),
    coordinates: COORDINATES,
    environment: { ...environment(), camera: status().camera, config: s.config, prepMs, recordMs },
    steps: [],
    frames: [],
  };
  recording = rec;
  const prompt = $<HTMLDivElement>('prompt');
  const overlay = $<HTMLCanvasElement>('overlay');
  const mirror = s.config.mirrorPreview;
  s.config.mirrorPreview = true;
  overlay.width = 960;
  overlay.height = 720;
  document.body.classList.add('guided');
  let redo = false;
  const onKey = (event: KeyboardEvent): void => {
    if (event.key === 'r' || event.key === 'R') redo = true;
  };
  window.addEventListener('keydown', onKey);
  const show = (head: string, scenario: Scenario, recordingNow: boolean): void => {
    prompt.hidden = false;
    prompt.classList.toggle('recording', recordingNow);
    const note = otherHandNote(scenario);
    const line = (className: string, text: string): HTMLDivElement => {
      const element = document.createElement('div');
      element.className = className;
      element.textContent = text;
      return element;
    };
    prompt.replaceChildren(
      line('head', head),
      line('action', scenario.label),
      line('note', `${note ? `${note} ／ ` : ''}やり直すときは R キー`),
    );
  };
  try {
    for (const [index, scenario] of steps.entries()) {
      let retries = 0;
      for (;;) {
        redo = false;
        for (let left = prepMs; left > 0; left -= 1000) {
          show(`${index + 1}/${steps.length} ／ 準備（${Math.ceil(left / 1000)}）`, scenario, false);
          await sleep(Math.min(1000, left));
        }
        redo = false;
        const start = performance.now();
        currentStep = scenario.id;
        for (let left = recordMs; left > 0 && !redo; left -= 1000) {
          show(`● 収録中 ${index + 1}/${steps.length} ／ あと ${Math.ceil(left / 1000)} 秒`, scenario, true);
          await sleep(Math.min(1000, left));
        }
        currentStep = null;
        if (redo) {
          // やり直す区間の点列は捨てる
          rec.frames = rec.frames.filter((f) => f.step !== scenario.id);
          retries++;
          continue;
        }
        rec.steps.push({
          id: scenario.id,
          label: scenario.label,
          truth: scenario.truth,
          start,
          end: performance.now(),
          retries,
        });
        break;
      }
    }
  } finally {
    currentStep = null;
    recording = null;
    window.removeEventListener('keydown', onKey);
    document.body.classList.remove('guided');
    overlay.width = 480;
    overlay.height = 360;
    s.config.mirrorPreview = mirror;
    prompt.classList.remove('recording');
    prompt.textContent = 'おつかれさまでした。収録を保存しています';
    setTimeout(() => {
      prompt.hidden = true;
    }, 3000);
  }
  const name = `at01-guided-${rec.createdAt.replace(/[:.]/g, '-')}.json`;
  const saved = await save(name, rec);
  return {
    name,
    saved,
    steps: rec.steps.length,
    frames: rec.frames.length,
    retries: rec.steps.reduce((sum, step) => sum + (step.retries ?? 0), 0),
  };
}

// --- 画面の操作
function readForm(): Partial<RunConfig> {
  const value = (id: string): string => $<HTMLInputElement | HTMLSelectElement>(id).value;
  const checked = (id: string): boolean => $<HTMLInputElement>(id).checked;
  const [width, height] = value('size').split('x').map(Number) as [number, number];
  const mode = value('mode');
  return {
    deviceId: value('camera') || null,
    width,
    height,
    fps: Number(value('fps')),
    face: mode.includes('face'),
    pose: mode.includes('pose'),
    hands: mode.includes('hands'),
    handHz: Number(value('handHz')),
    poseModel: value('poseModel') as RunConfig['poseModel'],
    delegate: value('delegate') as RunConfig['delegate'],
    transfer: value('transfer') as RunConfig['transfer'],
    workers: value('workers') === '2' ? 2 : 1,
    load: Number(value('load-parts')),
    mirrorPreview: checked('mirror'),
    simulate: value('simulate') as RunConfig['simulate'],
  };
}

function showStats(): void {
  const end = performance.now();
  const summary = summarize(timeline, end - 5000, end);
  const st = status();
  const n = (v: number | null | undefined, digits = 1): string => (typeof v === 'number' ? v.toFixed(digits) : '—');
  $<HTMLPreElement>('stats').textContent = [
    `カメラ ${st.camera ? `${st.camera.width}×${st.camera.height} ${n(st.camera.frameRate)}fps ${st.camera.label}` : '停止'}`,
    `Worker ${st.worker?.state ?? 'off'} ${st.worker?.ready?.tasks.map((t) => `${t.name}:${t.delegate ?? '×'} ${n(t.loadMs, 0)}ms`).join(' ') ?? ''} ${st.worker?.error ?? ''}`,
    `カメラ ${n(summary.camera.fps)}fps（撮影時刻: ${summary.camera.captureSource ?? '—'}、撮影→通知 p50 ${n(summary.camera.captureToCallbackMs.p50)}ms）`,
    `顔   ${n(summary.face.fps)}fps 推定 p50 ${n(summary.face.inferMs.p50)} / p95 ${n(summary.face.inferMs.p95)}ms 検出 ${n((summary.face.detectedRatio ?? 0) * 100, 0)}%`,
    `Pose ${n(summary.pose.fps)}fps 推定 p50 ${n(summary.pose.inferMs.p50)} / p95 ${n(summary.pose.inferMs.p95)}ms 撮影→描画 p95 ${n(summary.pose.captureToDisplayMs.p95)}ms`,
    `手   ${n(summary.hands.fps)}fps 推定 p50 ${n(summary.hands.inferMs.p50)} / p95 ${n(summary.hands.inferMs.p95)}ms 撮影→描画 p95 ${n(summary.hands.captureToDisplayMs.p95)}ms`,
    `描画 ${n(summary.render.fps)}fps 間隔 p95 ${n(summary.render.intervalMs.p95)}ms 遅いフレーム ${summary.render.slowFrames} 長いタスク ${summary.render.longTasks}`,
    `捨てた待ち ${summary.worker.mainDropped} 受け渡し失敗 ${summary.worker.transferErrors} 古い結果 ${summary.worker.stale}`,
    `外部への通信の試み ${netAttempts.length}（${[...new Set(netAttempts.map((a) => `${a.from}:${new URL(a.url, location.href).host}`))].join(', ')}）`,
  ].join('\n');
  trim();
}

async function listCameras(): Promise<void> {
  const select = $<HTMLSelectElement>('camera');
  const devices = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput');
  select.replaceChildren(
    new Option('既定のカメラ', ''),
    ...devices.map((d, i) => new Option(d.label || `カメラ ${i + 1}`, d.deviceId)),
  );
}

function bind(): void {
  const log = (text: string): void => {
    $<HTMLPreElement>('log').textContent =
      `${new Date().toLocaleTimeString()} ${text}\n${$<HTMLPreElement>('log').textContent}`;
  };
  $('start').addEventListener('click', () => {
    void start(readForm()).then(
      (st) => {
        log(`開始: ${JSON.stringify(st.worker)}`);
        return listCameras();
      },
      (error: unknown) => log(`開始できない: ${errorText(error)}`),
    );
  });
  $('stop').addEventListener('click', () => {
    stop();
    log('停止');
  });
  $('measure').addEventListener('click', () => {
    log('計測中（準備4秒＋15秒）');
    void measure().then((result) => {
      log(JSON.stringify(result.summary));
      return save(`at01-measure-${Date.now()}.json`, { environment: environment(), ...result });
    });
  });
  $('guided').addEventListener('click', () => {
    void guided().then(
      (result) => log(`収録: ${JSON.stringify(result)}`),
      (error: unknown) => log(`収録できない: ${errorText(error)}`),
    );
  });
  $('probe').addEventListener('click', () => {
    void probe().then((result) => log(`CSP: ${JSON.stringify(result)}`));
  });
  setInterval(showStats, 1000);
  void listCameras();
}

declare global {
  interface Window {
    __at01: {
      start: typeof start;
      stop: typeof stop;
      status: typeof status;
      measure: typeof measure;
      environment: typeof environment;
      probe: typeof probe;
      guided: typeof guided;
      save: typeof save;
      say: typeof say;
      findCamera: typeof findCamera;
      netcheck: typeof netcheck;
      defaults: RunConfig;
    };
  }
}

// 計測中の案内（空文字で消す）
function say(text: string): void {
  const prompt = $<HTMLDivElement>('prompt');
  prompt.hidden = !text;
  prompt.textContent = text;
}

// 名前の一部でカメラを選ぶ。名前は許可の後でないと読めないので、一度だけカメラを開いて閉じる
async function findCamera(label: string): Promise<{ deviceId: string; label: string } | null> {
  const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
  for (const track of stream.getTracks()) track.stop();
  const devices = await navigator.mediaDevices.enumerateDevices();
  const found = devices.find((d) => d.kind === 'videoinput' && d.label.includes(label));
  return found ? { deviceId: found.deviceId, label: found.label } : null;
}

window.__at01 = {
  start,
  stop,
  status,
  measure,
  environment,
  probe,
  guided,
  save,
  say,
  findCamera,
  netcheck,
  defaults: DEFAULT_CONFIG,
};
bind();
requestAnimationFrame(frame);
