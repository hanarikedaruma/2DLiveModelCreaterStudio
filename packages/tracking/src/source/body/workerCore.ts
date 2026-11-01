// 腕・手の推定 Worker の中身（AT-04）。Pose（肩・肘・手首）→ 手（GestureRecognizer）の順に1つの Worker で推定する。
// MediaPipe に依存する部分（推定器を作る）は差し込み口にし、ここは試験できる純粋な流れだけを持つ。
import type { HandObservation, PoseObservation } from '@app/contracts';
import type { Delegate, FrameMessage, FromBodyWorker, InitMessage, TaskReady, ToBodyWorker } from './protocol';

export interface LandmarkLike {
  x: number;
  y: number;
  z: number;
  visibility?: number;
}
export interface CategoryLike {
  categoryName: string;
  score: number;
}
export interface PoseTaskLike {
  detectForVideo(
    image: VideoFrame | ImageBitmap,
    timestamp: number,
  ): { landmarks: LandmarkLike[][]; worldLandmarks: LandmarkLike[][] };
  close(): void;
}
export interface GestureTaskLike {
  recognizeForVideo(
    image: VideoFrame | ImageBitmap,
    timestamp: number,
  ): {
    landmarks: LandmarkLike[][];
    worldLandmarks: LandmarkLike[][];
    handedness: CategoryLike[][];
    gestures: CategoryLike[][];
  };
  close(): void;
}
export interface TaskFactory {
  pose(delegate: Delegate): Promise<PoseTaskLike>;
  gesture(delegate: Delegate): Promise<GestureTaskLike>;
}

export interface BodyWorkerDeps {
  post(message: FromBodyWorker): void;
  now(): number; // Worker の performance.now()
  timeOrigin: number; // Worker の performance.timeOrigin
  tasks(init: InitMessage): TaskFactory;
}

const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error));
const point = (p: LandmarkLike) => ({ x: p.x, y: p.y, z: p.z });

// Pose は SDK の visibility を使う（無ければ見えていない扱いの0）。presence は SDK に無い
export function toPoseObservation(result: ReturnType<PoseTaskLike['detectForVideo']>): PoseObservation {
  return {
    landmarks: (result.landmarks[0] ?? []).map((p) => ({
      ...point(p),
      visibility: typeof p.visibility === 'number' && Number.isFinite(p.visibility) ? p.visibility : 0,
    })),
    worldLandmarks: (result.worldLandmarks[0] ?? []).map(point),
  };
}

// 手の点の visibility は SDK が常に0を返すので入れない（AT-01）。左右は SDK の候補（演者自身の側）で、所属の正解ではない
export function toHandObservations(result: ReturnType<GestureTaskLike['recognizeForVideo']>): HandObservation[] {
  return result.landmarks.map((points, i) => {
    const side = result.handedness[i]?.[0];
    const gesture = result.gestures[i]?.[0];
    return {
      landmarks: points.map(point),
      worldLandmarks: (result.worldLandmarks[i] ?? []).map(point),
      handedness:
        side && (side.categoryName === 'Left' || side.categoryName === 'Right')
          ? { side: side.categoryName === 'Left' ? 'left' : 'right', score: side.score }
          : null,
      gesture: gesture ? { name: gesture.categoryName, score: gesture.score } : null,
    };
  });
}

async function createWithFallback<T>(
  create: (delegate: Delegate) => Promise<T>,
): Promise<{ task: T | null; ready: TaskReady }> {
  const errors: string[] = [];
  for (const delegate of ['GPU', 'CPU'] as const) {
    try {
      return { task: await create(delegate), ready: { delegate, errors } };
    } catch (error) {
      errors.push(`${delegate}: ${errorText(error)}`);
    }
  }
  return { task: null, ready: { delegate: null, errors } };
}

export function createBodyWorkerCore(deps: BodyWorkerDeps) {
  let offset = 0; // ページの時刻 = Worker の performance.now() + offset
  let pose: PoseTaskLike | null = null;
  let gesture: GestureTaskLike | null = null;
  let handIntervalMs = 0;
  let running = false;
  let lastTimestamp = -Infinity;
  let lastHandCapture = -Infinity;
  const pageNow = (): number => deps.now() + offset;

  async function init(message: InitMessage): Promise<void> {
    offset = deps.timeOrigin - message.pageTimeOrigin;
    handIntervalMs = message.handIntervalMs;
    const factory = deps.tasks(message);
    const madePose = await createWithFallback((delegate) => factory.pose(delegate));
    pose = madePose.task;
    let hands: TaskReady | null = null;
    if (message.hands) {
      const madeGesture = await createWithFallback((delegate) => factory.gesture(delegate));
      gesture = madeGesture.task;
      hands = madeGesture.ready;
    }
    running = true;
    deps.post({ type: 'ready', pose: madePose.ready, hands });
  }

  function process(frame: FrameMessage): void {
    const image = frame.image;
    const base = {
      generation: frame.generation,
      frameId: frame.frameId,
      capturedAt: frame.capturedAt,
      captureSource: frame.captureSource,
      width: 'displayWidth' in image ? image.displayWidth : image.width,
      height: 'displayHeight' in image ? image.displayHeight : image.height,
    };
    try {
      // detectForVideo の時刻は推定器ごとに増え続ける必要がある
      const timestamp = frame.capturedAt > lastTimestamp ? frame.capturedAt : lastTimestamp + 0.001;
      lastTimestamp = timestamp;
      // 軽量は撮影時刻で間引く（フレーム数では数えない）。撮影の間隔は揺れるので、間隔の 3/4 を超えたら推定する
      const handsDue = gesture !== null && frame.capturedAt - lastHandCapture >= handIntervalMs * 0.75;
      if (pose) {
        let value: PoseObservation | null = null;
        let error: string | null = null;
        try {
          value = toPoseObservation(pose.detectForVideo(image, timestamp));
        } catch (caught) {
          error = errorText(caught);
        }
        deps.post({ type: 'pose', ...base, completedAt: pageNow(), value, error });
      }
      if (gesture && handsDue) {
        lastHandCapture = frame.capturedAt;
        let value: HandObservation[] | null = null;
        let error: string | null = null;
        try {
          value = toHandObservations(gesture.recognizeForVideo(image, timestamp));
        } catch (caught) {
          error = errorText(caught);
        }
        deps.post({ type: 'hands', ...base, completedAt: pageNow(), value, error });
      }
    } finally {
      image.close();
      deps.post({ type: 'done', generation: frame.generation, frameId: frame.frameId });
    }
  }

  function stop(): void {
    running = false;
    // close() で MediaPipe が利用状況を送ろうとするが、Worker の CSP と見張りで止まる
    pose?.close();
    gesture?.close();
    pose = null;
    gesture = null;
  }

  return {
    handle(message: ToBodyWorker): Promise<void> | void {
      switch (message.type) {
        case 'init':
          return init(message).catch((error: unknown) => deps.post({ type: 'failed', message: errorText(error) }));
        case 'mode':
          handIntervalMs = message.handIntervalMs;
          lastHandCapture = -Infinity;
          return;
        case 'frame':
          if (!running) {
            // 準備の前・止めた後に届いた画像は推定せずに閉じ、ページの流れを止めない
            message.image.close();
            deps.post({ type: 'done', generation: message.generation, frameId: message.frameId });
            return;
          }
          process(message);
          return;
        case 'stop':
          stop();
          return;
      }
    },
  };
}
