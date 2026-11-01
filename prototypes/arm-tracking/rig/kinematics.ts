// AT-02の技術試作。製品コードから参照しない。角度は度、長さは技術見本のpx。
export interface Point {
  x: number;
  y: number;
}
export type Side = 'L' | 'R';
export type HandShape = 'open' | 'fist' | 'point' | 'peace';
export interface Pose {
  shoulder: number;
  elbow: number;
  wrist: number;
}
export interface Parent {
  rotation: number;
  scale: number;
  breath: number;
}
export interface ScenePose {
  name: string;
  left: Pose;
  right: Pose;
  leftHand: HandShape;
  rightHand: HandShape;
  parent: Parent;
}

export const RIG = {
  upperLength: 118,
  lowerLength: 108,
  shoulderX: 78,
  shoulderY: 240,
  shoulder: [-25, 160],
  elbow: [0, 145],
  wrist: [-40, 40],
  forearm: [-25, 300],
  hand: [-55, 300],
} as const;
export const REST: Pose = { shoulder: 8, elbow: 12, wrist: 0 };
export const IDENTITY_PARENT: Parent = { rotation: 0, scale: 1, breath: 0 };
export const HAND_SHAPES: HandShape[] = ['open', 'fist', 'point', 'peace'];
export const RAD = Math.PI / 180;
export const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, n));
export const distance = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y);

export function constrain(input: Pose): { pose: Pose; reasons: string[] } {
  if (![input.shoulder, input.elbow, input.wrist].every(Number.isFinite))
    return { pose: { ...REST }, reasons: ['非有限の入力：休止姿勢'] };
  const shoulder = clamp(input.shoulder, ...RIG.shoulder);
  const elbow = clamp(
    input.elbow,
    Math.max(RIG.elbow[0], RIG.forearm[0] - shoulder),
    Math.min(RIG.elbow[1], RIG.forearm[1] - shoulder),
  );
  const forearm = shoulder + elbow;
  const wrist = clamp(
    input.wrist,
    Math.max(RIG.wrist[0], RIG.hand[0] - forearm),
    Math.min(RIG.wrist[1], RIG.hand[1] - forearm),
  );
  const pose = { shoulder, elbow, wrist };
  const reasons: string[] = [];
  if (shoulder !== input.shoulder) reasons.push('肩の範囲');
  if (elbow !== input.elbow) reasons.push('肘・前腕の範囲');
  if (wrist !== input.wrist) reasons.push('手首・手の合成角度');
  return { pose, reasons };
}

// モデル自身のLは画面右。左右の画面角度を混ぜず、外側へ上げる角度に正規化。
export function forward(pose: Pose, side: Side): { shoulder: Point; elbow: Point; wrist: Point; handRotation: number } {
  const sign = side === 'L' ? 1 : -1;
  const shoulder = { x: sign * RIG.shoulderX, y: RIG.shoulderY };
  const segment = (p: Point, angle: number, length: number): Point => ({
    x: p.x + sign * Math.sin(angle * RAD) * length,
    y: p.y + Math.cos(angle * RAD) * length,
  });
  const elbow = segment(shoulder, pose.shoulder, RIG.upperLength);
  const wrist = segment(elbow, pose.shoulder + pose.elbow, RIG.lowerLength);
  return { shoulder, elbow, wrist, handRotation: sign * (180 - pose.shoulder - pose.elbow - pose.wrist) };
}

export function toWorld(p: Point, parent: Parent): Point {
  if (
    !Number.isFinite(parent.scale) ||
    parent.scale <= 0 ||
    !Number.isFinite(parent.rotation) ||
    !Number.isFinite(parent.breath)
  )
    throw new Error('親は有限の回転と正の等倍率に限る');
  const c = Math.cos(parent.rotation * RAD),
    s = Math.sin(parent.rotation * RAD);
  const x = p.x * parent.scale,
    y = (p.y - 260 - parent.breath) * parent.scale;
  return { x: c * x - s * y, y: 260 + s * x + c * y };
}

export function fromWorld(p: Point, parent: Parent): Point {
  toWorld({ x: 0, y: 0 }, parent); // 親の入力の検査を共有する。
  const c = Math.cos(parent.rotation * RAD),
    s = Math.sin(parent.rotation * RAD);
  return {
    x: (c * p.x + s * (p.y - 260)) / parent.scale,
    y: (-s * p.x + c * (p.y - 260)) / parent.scale + 260 + parent.breath,
  };
}

export function handPoint(local: Point, pose: Pose, side: Side, parent = IDENTITY_PARENT): Point {
  const arm = forward(pose, side),
    c = Math.cos(arm.handRotation * RAD),
    s = Math.sin(arm.handRotation * RAD);
  return toWorld({ x: arm.wrist.x + c * local.x - s * local.y, y: arm.wrist.y + s * local.x + c * local.y }, parent);
}

// 曲がった基準画像にも使う差分回転。子のpivotから親へ順に1回ずつ適用する。
export function referencePoint(
  point: Point,
  reference: Pose,
  pose: Pose,
  side: Side,
  segment: 'upper' | 'lower' | 'hand',
  parent = IDENTITY_PARENT,
): Point {
  const origin = forward(reference, side),
    sign = side === 'L' ? -1 : 1;
  const rotate = (p: Point, pivot: Point, degrees: number): Point => {
    const c = Math.cos(degrees * RAD),
      s = Math.sin(degrees * RAD);
    const x = p.x - pivot.x,
      y = p.y - pivot.y;
    return { x: pivot.x + c * x - s * y, y: pivot.y + s * x + c * y };
  };
  let result = point;
  if (segment === 'hand') result = rotate(result, origin.wrist, sign * (pose.wrist - reference.wrist));
  if (segment !== 'upper') result = rotate(result, origin.elbow, sign * (pose.elbow - reference.elbow));
  result = rotate(result, origin.shoulder, sign * (pose.shoulder - reference.shoulder));
  return toWorld(result, parent);
}

// 試作用の有界探索。2°の全域比較→局所細分化。製品IKの方式・性能の保証ではない。
export function solveTarget(
  target: Point,
  side: Side,
  requestedWrist = 0,
  previous?: Pose,
): {
  pose: Pose;
  error: number;
  limited: boolean;
  reason: string;
} {
  if (![target.x, target.y, requestedWrist].every(Number.isFinite))
    return { pose: { ...REST }, error: 0, limited: true, reason: '無効な目標：休止姿勢' };
  let best = constrain(previous ?? REST).pose,
    bestCost = Infinity;
  const consider = (shoulder: number, elbow: number) => {
    const candidate = constrain({ shoulder, elbow, wrist: requestedWrist }).pose;
    const positionError = distance(forward(candidate, side).wrist, target);
    const previousCost = previous
      ? 0.015 * ((candidate.shoulder - previous.shoulder) ** 2 + (candidate.elbow - previous.elbow) ** 2)
      : 0;
    const cost = positionError ** 2 + previousCost;
    if (cost < bestCost) {
      bestCost = cost;
      best = candidate;
    }
  };
  for (let s = RIG.shoulder[0]; s <= RIG.shoulder[1]; s += 2)
    for (let e = RIG.elbow[0]; e <= RIG.elbow[1]; e += 2) consider(s, e);
  for (const s of RIG.shoulder) for (const e of RIG.elbow) consider(s, e);
  for (const step of [0.2, 0.02]) {
    const center = { ...best };
    for (let ds = -10; ds <= 10; ds++)
      for (let de = -10; de <= 10; de++) consider(center.shoulder + ds * step, center.elbow + de * step);
  }
  const error = distance(forward(best, side).wrist, target);
  return { pose: best, error, limited: error > 1, reason: error > 1 ? '可動域を優先：目標への誤差あり' : '目標付近' };
}

const p = (shoulder: number, elbow: number, wrist = 0): Pose => ({ shoulder, elbow, wrist });
const scene = (
  name: string,
  left: Pose,
  right = left,
  leftHand: HandShape = 'open',
  rightHand = leftHand,
  parent = IDENTITY_PARENT,
): ScenePose => ({ name, left, right, leftHand, rightHand, parent });
export const POSES: ScenePose[] = [
  scene('休止姿勢', REST),
  scene('肘 0°', p(55, 0)),
  scene('肘 45°', p(55, 45)),
  scene('肘 90°', p(55, 90)),
  scene('肘 145°', p(55, 145)),
  scene('手振り・左', p(65, 100, -25), REST),
  scene('左右へ指さす', p(90, 0), p(90, 0), 'point'),
  scene('上へ指さす', p(160, 20), REST, 'point', 'open'),
  scene('顔の前のピース', p(110, 130, -30), p(110, 130, -30), 'peace'),
  scene('グーとパー', p(60, 110, 10), p(60, 110, 10), 'fist', 'open'),
  scene('手首の両端', p(65, 100, -40), p(65, 100, 40)),
  scene('複合角度の制限', p(160, 145, 40)),
  scene('肩の下限', p(-25, 0, -40)),
  scene('親の傾き・呼吸', p(110, 130, -30), p(65, 100, 15), 'peace', 'open', { rotation: 12, scale: 0.85, breath: 6 }),
  scene('左右の異なる手形', p(65, 100), p(65, 100), 'point', 'peace'),
  scene('基準角を持つ腕', p(25, 65, 10), p(25, 65, 10), 'fist'),
];

export function waveAt(time: number): ScenePose {
  const phase = time * Math.PI * 2;
  return scene(
    '連続手振り（1Hz）',
    p(65 + 6 * Math.sin(phase), 100 + 10 * Math.sin(phase), 25 * Math.cos(phase)),
    p(65 + 6 * Math.sin(phase + Math.PI), 100 + 10 * Math.sin(phase + Math.PI), 25 * Math.cos(phase + Math.PI)),
  );
}

// 制約済みの角度を凸補間する。形状は中間番号を作らず、半分の時点で切り替える。
export function transitionAt(start: ScenePose, end: ScenePose, progress: number): ScenePose {
  const t = clamp(progress, 0, 1),
    blend = t * t * (3 - 2 * t);
  const mix = (a: number, b: number) => a + (b - a) * blend;
  const mixPose = (a: Pose, b: Pose): Pose => {
    const from = constrain(a).pose,
      to = constrain(b).pose;
    return {
      shoulder: mix(from.shoulder, to.shoulder),
      elbow: mix(from.elbow, to.elbow),
      wrist: mix(from.wrist, to.wrist),
    };
  };
  return {
    name: `${start.name} → ${end.name}`,
    left: mixPose(start.left, end.left),
    right: mixPose(start.right, end.right),
    leftHand: t < 0.5 ? start.leftHand : end.leftHand,
    rightHand: t < 0.5 ? start.rightHand : end.rightHand,
    parent: {
      rotation: mix(start.parent.rotation, end.parent.rotation),
      scale: mix(start.parent.scale, end.parent.scale),
      breath: mix(start.parent.breath, end.parent.breath),
    },
  };
}
