// 案内つき収録の点列を、案内の正解（演者自身の左右・手形）と照合する純粋関数。
// SDK の左右・手形を正解として扱わない。比べる相手は steps[].truth だけ。
import { POSE, STRIDE } from './protocol';
import type { RecFrame, RecHand, Recording, Shape, Side, StepInfo } from './record';

export interface P3 {
  x: number;
  y: number;
  z: number;
  v: number | null;
}

export function point(values: readonly (number | null)[] | null | undefined, index: number): P3 | null {
  if (!values || values.length < (index + 1) * STRIDE) return null;
  const at = (k: number): number | null => values[index * STRIDE + k] ?? null;
  const x = at(0);
  const y = at(1);
  const z = at(2);
  if (x === null || y === null || z === null) return null;
  const v = at(3);
  return { x, y, z, v: typeof v === 'number' && Number.isFinite(v) ? v : null };
}

const POSE_SIDE = {
  left: { shoulder: POSE.leftShoulder, elbow: POSE.leftElbow, wrist: POSE.leftWrist },
  right: { shoulder: POSE.rightShoulder, elbow: POSE.rightElbow, wrist: POSE.rightWrist },
} as const;

// 画面の中にあり、visibility が閾値以上の点だけを「見えている」とする（visibility が無い点は見えていない扱い）
export function visible(p: P3 | null, threshold = 0.5): boolean {
  return p !== null && p.v !== null && p.v >= threshold && p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1;
}

// 指の曲がり（度）。付け根→第2関節 と 第2関節→指先 のなす角。手基準の 3D 座標で測るので、指の向き（上・横）に依らない
export function bend(world: readonly number[], mcp: number, pip: number, tip: number): number | null {
  const a = point(world, mcp);
  const b = point(world, pip);
  const c = point(world, tip);
  if (!a || !b || !c) return null;
  const u = [b.x - a.x, b.y - a.y, b.z - a.z];
  const w = [c.x - b.x, c.y - b.y, c.z - b.z];
  const nu = Math.hypot(u[0]!, u[1]!, u[2]!);
  const nw = Math.hypot(w[0]!, w[1]!, w[2]!);
  if (nu < 1e-6 || nw < 1e-6) return null;
  const cos = (u[0]! * w[0]! + u[1]! * w[1]! + u[2]! * w[2]!) / (nu * nw);
  return (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI;
}

const FINGERS = [
  [5, 6, 8],
  [9, 10, 12],
  [13, 14, 16],
  [17, 18, 20],
] as const; // 人さし指・中指・薬指・小指（MCP・PIP・TIP）
export const STRAIGHT_DEG = 45;
export const CURLED_DEG = 75;

// 試作の簡単な手形の判定（親指は使わない）。製品の判定は AT-07 で作る
export function geometricShape(hand: RecHand): Shape | 'unknown' {
  const states = FINGERS.map(([m, p, t]) => {
    const deg = bend(hand.world, m, p, t);
    if (deg === null) return 'unknown';
    return deg < STRAIGHT_DEG ? 'straight' : deg > CURLED_DEG ? 'curled' : 'unknown';
  });
  const [index, middle, ring, pinky] = states;
  if (states.every((s) => s === 'straight')) return 'open';
  if (states.every((s) => s === 'curled')) return 'fist';
  if (index === 'straight' && middle === 'straight' && ring === 'curled' && pinky === 'curled') return 'peace';
  if (index === 'straight' && middle === 'curled' && ring === 'curled' && pinky === 'curled') return 'point';
  return 'unknown';
}

const SDK_GESTURE: Record<Shape, string> = {
  open: 'Open_Palm',
  fist: 'Closed_Fist',
  point: 'Pointing_Up',
  peace: 'Victory',
};

// 人さし指（付け根→指先）の画面上の向き（度）。0 = 画像の右、90 = 上。縦横比を直してから測る
export function indexDirection(hand: RecHand, width: number, height: number): number | null {
  const a = point(hand.lm, 5);
  const b = point(hand.lm, 8);
  if (!a || !b) return null;
  const dx = (b.x - a.x) * width;
  const dy = (a.y - b.y) * height;
  if (Math.hypot(dx, dy) < 1) return null;
  return (Math.atan2(dy, dx) * 180) / Math.PI;
}

// 手首と Pose の手首の距離（画素）
function wristDistance(hand: RecHand, pose: readonly number[] | null, side: Side, width: number, height: number) {
  const a = point(hand.lm, 0);
  const b = point(pose, POSE_SIDE[side].wrist);
  if (!a || !b) return Number.POSITIVE_INFINITY;
  return Math.hypot((a.x - b.x) * width, (a.y - b.y) * height);
}

// 手を Pose の左右へ割り当てる。手首がどちらかの Pose の手首に近く、その差が 20px 以上のときだけ（区別できないものは null）
export function assignSide(hand: RecHand, pose: readonly number[] | null, width: number, height: number): Side | null {
  if (!pose?.length) return null;
  const left = wristDistance(hand, pose, 'left', width, height);
  const right = wristDistance(hand, pose, 'right', width, height);
  if (!Number.isFinite(left) || !Number.isFinite(right) || Math.abs(left - right) < 20) return null;
  return left < right ? 'left' : 'right';
}

const share = (count: number, total: number): number | null => (total ? count / total : null);
const median = (values: number[]): number | null => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
};
const counts = (values: readonly string[]): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const value of values) out[value] = (out[value] ?? 0) + 1;
  return out;
};

// 案内どおりに動けたとみなす目安。満たさない区間は精度の集計から外す
// 画面の外へ出す区間は手が写らない時間があるので、案内の手は 0.2 以上でよい
export const FOLLOWED = { truthHand: 0.5, truthHandOutOfFrame: 0.2, otherHand: 0.2, bothHands: 0.5, restHand: 0.2 };

export function analyzeStep(step: StepInfo, frames: readonly RecFrame[], width: number, height: number) {
  const truth = step.truth;
  const poseFrames = frames.filter((f) => f.pose !== null);
  const posed = poseFrames.filter((f) => f.pose!.length > 0);
  const handFrames = frames.filter((f) => f.hands !== null);
  const sideVisibility = (side: Side) => {
    const ids = POSE_SIDE[side];
    const ratio = (index: number): number | null =>
      share(posed.filter((f) => visible(point(f.pose, index))).length, poseFrames.length);
    return { shoulder: ratio(ids.shoulder), elbow: ratio(ids.elbow), wrist: ratio(ids.wrist) };
  };
  const single = truth.active.length === 1 && !truth.crossed ? truth.active[0]! : null;
  const other: Side | null = single === 'left' ? 'right' : single === 'right' ? 'left' : null;
  // Pose の左右: 案内の側の手首が、もう片方より上にあるか（Pose の名前のまま。下ろしたまま行う区間では意味が薄い）
  let poseHigherIsTruth = 0;
  let poseCompared = 0;
  let truthSideOnImageLeft = 0;
  if (single && other) {
    for (const f of posed) {
      const mine = point(f.pose, POSE_SIDE[single].wrist);
      const theirs = point(f.pose, POSE_SIDE[other].wrist);
      if (!mine || !theirs) continue;
      poseCompared++;
      if (mine.y < theirs.y) poseHigherIsTruth++;
      if (mine.x < theirs.x) truthSideOnImageLeft++;
    }
  }
  // 片手の案内では、案内の側の Pose の手首に近い手だけを照合に使う（反対の手が写っても選ばない）
  const sides: string[] = [];
  const gestures: string[] = [];
  const shapes: string[] = [];
  const directions: number[] = [];
  let truthHandFrames = 0;
  let otherHandFrames = 0;
  for (const f of handFrames) {
    if (!f.hands!.length) continue;
    const assigned = f.hands!.map((h) => ({ hand: h, side: assignSide(h, f.pose, width, height) }));
    if (single && assigned.some((a) => a.side === other)) otherHandFrames++;
    const targets = single
      ? assigned.filter((a) => a.side === single).map((a) => a.hand)
      : truth.active.length
        ? f.hands!
        : [];
    if (single && targets.length) truthHandFrames++;
    for (const h of targets) {
      gestures.push(h.gesture ?? 'none');
      shapes.push(geometricShape(h));
      const direction = indexDirection(h, width, height);
      if (direction !== null && truth.shape === 'point') directions.push(direction);
      if (single) sides.push(h.sdkSide ?? 'none');
    }
  }
  const sideName = single ? (single === 'left' ? 'Left' : 'Right') : null;
  const sdkSides = counts(sides);
  const handRate = share(handFrames.filter((f) => f.hands!.length > 0).length, handFrames.length);
  const twoHandRate = share(handFrames.filter((f) => f.hands!.length > 1).length, handFrames.length);
  const truthHandRate = single ? share(truthHandFrames, handFrames.length) : null;
  const otherHandRate = single ? share(otherHandFrames, handFrames.length) : null;
  const followed = single
    ? (truthHandRate ?? 0) >= (truth.outOfFrame ? FOLLOWED.truthHandOutOfFrame : FOLLOWED.truthHand) &&
      (otherHandRate ?? 1) <= FOLLOWED.otherHand
    : truth.active.length === 2
      ? (twoHandRate ?? 0) >= FOLLOWED.bothHands
      : (handRate ?? 1) <= FOLLOWED.restHand;
  return {
    id: step.id,
    truth,
    retries: step.retries ?? 0,
    frames: frames.length,
    durationMs: step.end - step.start,
    followed,
    poseRate: share(posed.length, poseFrames.length),
    handRate,
    twoHandRate,
    truthHandRate,
    otherHandRate,
    faceRate: share(frames.filter((f) => f.face).length, frames.filter((f) => f.face !== null).length),
    visibility: { left: sideVisibility('left'), right: sideVisibility('right') },
    pose: single
      ? {
          higherWristNamedAsTruth: share(poseHigherIsTruth, poseCompared),
          truthSideOnImageLeft: share(truthSideOnImageLeft, poseCompared),
        }
      : null,
    hands: single ? { sdkSides, sdkSameNameAsTruth: share(sdkSides[sideName!] ?? 0, sides.length) } : null,
    gestures: counts(gestures),
    sdkGestureMatch: truth.shape
      ? share(gestures.filter((g) => g === SDK_GESTURE[truth.shape!]).length, gestures.length)
      : null,
    geometricShapes: counts(shapes),
    geometricMatch: truth.shape ? share(shapes.filter((s) => s === truth.shape).length, shapes.length) : null,
    indexDirectionDeg: median(directions),
  };
}

// 人さし指の向きを、真上からのずれで分ける
export function directionBin(direction: number): 'up' | 'diagonal' | 'side' | 'down' {
  const off = Math.abs(((direction - 90 + 540) % 360) - 180);
  return off < 30 ? 'up' : off < 60 ? 'diagonal' : off < 120 ? 'side' : 'down';
}

// 案内の正解を使わない集計。演者が案内どおりに動けなかった区間があっても成り立つ
export function truthFree(recording: Recording, width: number, height: number) {
  let agree = 0;
  let compared = 0;
  let crossedAgree = 0;
  let crossedCompared = 0;
  let crossedFrames = 0;
  let posed = 0;
  let leftElbow = 0;
  let rightElbow = 0;
  let noFace = 0;
  let noFacePose = 0;
  let noFaceHands = 0;
  const pointing: Record<string, { frames: number; sdkPointingUp: number }> = {};
  const shapeVsSdk: Record<string, Record<string, number>> = {};
  for (const f of recording.frames) {
    if (f.face === false) {
      noFace++;
      if (f.pose?.length) noFacePose++;
      if (f.hands?.length) noFaceHands++;
    }
    const lw = f.pose?.length ? point(f.pose, POSE.leftWrist) : null;
    const rw = f.pose?.length ? point(f.pose, POSE.rightWrist) : null;
    // 未反転の映像では演者の右手首は画像の左。右手首が左手首より右にあれば交差
    const crossed = !!(lw && rw && visible(lw) && visible(rw) && rw.x > lw.x + 0.02);
    if (f.pose?.length) {
      posed++;
      if (crossed) crossedFrames++;
      if (visible(point(f.pose, POSE.leftElbow))) leftElbow++;
      if (visible(point(f.pose, POSE.rightElbow))) rightElbow++;
    }
    for (const h of f.hands ?? []) {
      const side = assignSide(h, f.pose, width, height);
      if (side && h.sdkSide) {
        const same = h.sdkSide === (side === 'left' ? 'Left' : 'Right');
        compared++;
        if (same) agree++;
        if (crossed) {
          crossedCompared++;
          if (same) crossedAgree++;
        }
      }
      const shape = geometricShape(h);
      const row = (shapeVsSdk[shape] ??= {});
      row[h.gesture ?? 'none'] = (row[h.gesture ?? 'none'] ?? 0) + 1;
      const direction = shape === 'point' ? indexDirection(h, width, height) : null;
      if (direction !== null) {
        const bin = (pointing[directionBin(direction)] ??= { frames: 0, sdkPointingUp: 0 });
        bin.frames++;
        if (h.gesture === 'Pointing_Up') bin.sdkPointingUp++;
      }
    }
  }
  return {
    sdkSideMatchesNearestPoseWrist: { rate: share(agree, compared), frames: compared },
    whileCrossed: { rate: share(crossedAgree, crossedCompared), frames: crossedCompared, crossedFrames },
    pointingByDirection: pointing,
    geometricShapeVsSdk: shapeVsSdk,
    faceLost: { frames: noFace, poseRate: share(noFacePose, noFace), handRate: share(noFaceHands, noFace) },
    elbowVisible: { left: share(leftElbow, posed), right: share(rightElbow, posed), frames: posed },
  };
}

export function analyze(recording: Recording) {
  const camera = recording.environment.camera as { width?: number; height?: number } | undefined;
  const width = camera?.width ?? 640;
  const height = camera?.height ?? 480;
  const steps = recording.steps.map((step) =>
    analyzeStep(
      step,
      recording.frames.filter((f) => f.step === step.id),
      width,
      height,
    ),
  );
  return {
    createdAt: recording.createdAt,
    width,
    height,
    followedSteps: steps.filter((s) => s.followed).length,
    steps,
    truthFree: truthFree(recording, width, height),
  };
}

export type Analysis = ReturnType<typeof analyze>;
