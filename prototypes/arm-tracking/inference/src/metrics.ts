// 計測の集計。時刻はすべてページの performance.now() の ms。
// fps の分母は「集計窓の長さ（秒）」。分子は、Pose・手は「結果がページに届いた時刻」、顔は「推定が終わった時刻」、
// カメラは「requestVideoFrameCallback が呼ばれた時刻」がその窓に入った件数。撮影時刻では数えない。

export interface FrameRecord {
  id: number;
  now: number; // requestVideoFrameCallback が呼ばれた時刻
  capture: number; // 撮影時刻として使った値（captureSource を参照）
  captureSource: 'captureTime' | 'callback';
  presentationTime: number | null;
  expectedDisplayTime: number | null;
  faceStart: number | null;
  faceEnd: number | null;
  faceDetected: boolean | null;
  sent: boolean;
  createMs: number | null; // 画像を渡す準備（VideoFrame・ImageBitmap を作る）にかかった時間
}

export interface BodyRecord {
  id: number;
  captureTime: number;
  sentAt: number;
  receivedAt: number;
  poseStart: number | null;
  poseEnd: number | null;
  handStart: number | null;
  handEnd: number | null;
  postedAt: number;
  arrivedAt: number; // ページが結果を受け取った時刻
  appliedAt: number | null; // 結果を初めて描いた requestAnimationFrame の時刻
  poseDetected: boolean | null;
  hands: number | null; // 見つかった手の数。null は手を推定していない
  stale: boolean; // 世代違い・順序の逆転で捨てた
}

export interface Timeline {
  frames: FrameRecord[];
  bodies: BodyRecord[];
  rafs: number[];
  longTasks: { start: number; duration: number }[];
  mainDropped: number[]; // ページ側で待ちを置き換えた時刻
  transferErrors: number[];
}

export interface Stat {
  count: number;
  p50: number | null;
  p95: number | null;
  max: number | null;
}

// 線形補間の分位点（R の type 7）。空なら null
export function percentile(values: readonly number[], p: number): number | null {
  const sorted = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const rank = (sorted.length - 1) * p;
  const low = Math.floor(rank);
  const high = Math.ceil(rank);
  return sorted[low]! + (sorted[high]! - sorted[low]!) * (rank - low);
}

export function stat(values: readonly number[]): Stat {
  const finite = values.filter((v) => Number.isFinite(v));
  return {
    count: finite.length,
    p50: percentile(finite, 0.5),
    p95: percentile(finite, 0.95),
    max: finite.length ? Math.max(...finite) : null,
  };
}

export const inWindow = (t: number | null | undefined, start: number, end: number): t is number =>
  typeof t === 'number' && t >= start && t < end;

export function fps(times: readonly (number | null)[], start: number, end: number): number {
  const seconds = (end - start) / 1000;
  if (seconds <= 0) return 0;
  return times.filter((t) => inWindow(t, start, end)).length / seconds;
}

const diff = (a: number | null, b: number | null): number => (a === null || b === null ? Number.NaN : a - b);
const ratio = (part: number, whole: number): number | null => (whole ? part / whole : null);

export const SLOW_FRAME_MS = 25; // 60fps で 1.5 フレームを超えた描画間隔

export function summarize(timeline: Timeline, start: number, end: number) {
  const frames = timeline.frames.filter((f) => inWindow(f.now, start, end));
  const faces = timeline.frames.filter((f) => inWindow(f.faceEnd, start, end));
  const bodies = timeline.bodies.filter((b) => !b.stale && inWindow(b.arrivedAt, start, end));
  const poses = bodies.filter((b) => b.poseEnd !== null);
  const hands = bodies.filter((b) => b.handEnd !== null);
  const rafs = timeline.rafs.filter((t) => inWindow(t, start, end));
  const intervals = rafs.slice(1).map((t, i) => t - rafs[i]!);
  const longTasks = timeline.longTasks.filter((t) => inWindow(t.start, start, end));
  return {
    windowMs: end - start,
    camera: {
      fps: fps(
        frames.map((f) => f.now),
        start,
        end,
      ),
      // 撮影時刻からコールバックまで（カメラ・ブラウザー側の遅れ）
      captureToCallbackMs: stat(frames.filter((f) => f.captureSource === 'captureTime').map((f) => f.now - f.capture)),
      captureSource: frames[0]?.captureSource ?? null,
      sentFps: fps(
        frames.filter((f) => f.sent).map((f) => f.now),
        start,
        end,
      ),
      createMs: stat(frames.map((f) => f.createMs ?? Number.NaN)),
    },
    face: {
      fps: fps(
        faces.map((f) => f.faceEnd),
        start,
        end,
      ),
      inferMs: stat(faces.map((f) => diff(f.faceEnd, f.faceStart))),
      ageMs: stat(faces.map((f) => diff(f.faceEnd, f.capture))),
      detectedRatio: ratio(faces.filter((f) => f.faceDetected).length, faces.length),
    },
    pose: {
      fps: fps(
        poses.map((b) => b.arrivedAt),
        start,
        end,
      ),
      inferMs: stat(poses.map((b) => diff(b.poseEnd, b.poseStart))),
      // 撮影から結果の受け取りまで（結果の古さ）と、撮影から最初に描いたフレームまで
      ageAtArrivalMs: stat(poses.map((b) => b.arrivedAt - b.captureTime)),
      captureToDisplayMs: stat(poses.map((b) => diff(b.appliedAt, b.captureTime))),
      detectedRatio: ratio(poses.filter((b) => b.poseDetected).length, poses.length),
    },
    hands: {
      fps: fps(
        hands.map((b) => b.arrivedAt),
        start,
        end,
      ),
      inferMs: stat(hands.map((b) => diff(b.handEnd, b.handStart))),
      ageAtArrivalMs: stat(hands.map((b) => b.arrivedAt - b.captureTime)),
      captureToDisplayMs: stat(hands.map((b) => diff(b.appliedAt, b.captureTime))),
      anyHandRatio: ratio(hands.filter((b) => (b.hands ?? 0) > 0).length, hands.length),
      twoHandsRatio: ratio(hands.filter((b) => (b.hands ?? 0) > 1).length, hands.length),
    },
    worker: {
      transferMs: stat(bodies.map((b) => b.receivedAt - b.sentAt)),
      // Worker が受け取ってから最初の推定を始めるまで（Pose が無い構成だけ手で測る）
      queueMs: stat((poses.length ? poses : hands).map((b) => diff(b.poseStart ?? b.handStart, b.receivedAt))),
      resultPostMs: stat(bodies.map((b) => b.arrivedAt - b.postedAt)),
      // ページ側で古い待ちを新しいフレームに置き換えた数（キューを積まない代わりに捨てた数）
      mainDropped: timeline.mainDropped.filter((t) => inWindow(t, start, end)).length,
      transferErrors: timeline.transferErrors.filter((t) => inWindow(t, start, end)).length,
      stale: timeline.bodies.filter((b) => b.stale && inWindow(b.arrivedAt, start, end)).length,
    },
    render: {
      fps: rafs.length > 1 ? (rafs.length - 1) / ((rafs[rafs.length - 1]! - rafs[0]!) / 1000) : 0,
      intervalMs: stat(intervals),
      p99IntervalMs: percentile(intervals, 0.99),
      slowFrames: intervals.filter((d) => d > SLOW_FRAME_MS).length,
      slowRatio: ratio(intervals.filter((d) => d > SLOW_FRAME_MS).length, intervals.length),
      longTasks: longTasks.length,
      longTaskMs: longTasks.reduce((sum, t) => sum + t.duration, 0),
    },
  };
}

export type Summary = ReturnType<typeof summarize>;
