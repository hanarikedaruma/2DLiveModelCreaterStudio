import type { ArmPose, ArmRig, Vec2 } from '@app/schema';
import type { ArmIKInput, ArmIKResult, ArmLimitReason } from '@app/contracts';
import { armFeasiblePolygon, armPoseInLimits, clampArmNumber, constrainArmPose } from './constraints';

const RAD = Math.PI / 180;
const distance = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.y - b.y);
const safePoint = (p: Vec2) => [p.x, p.y].every((n) => Number.isFinite(n) && Math.abs(n) < 1e12);
type Geometry = Pick<ArmRig, 'lengths' | 'bendSign'>;

// 肩原点、外側+x、下+y。モデル左右への配置はforwardArmInModelだけで行う。
export function forwardArm(rig: Geometry, pose: ArmPose): { elbow: Vec2; wrist: Vec2 } {
  const a = pose.shoulder * RAD,
    b = (pose.shoulder + rig.bendSign * pose.elbow) * RAD;
  const elbow = { x: rig.lengths.upper * Math.sin(a), y: rig.lengths.upper * Math.cos(a) };
  return {
    elbow,
    wrist: { x: elbow.x + rig.lengths.lower * Math.sin(b), y: elbow.y + rig.lengths.lower * Math.cos(b) },
  };
}
export function forwardArmInModel(rig: ArmRig, pose: ArmPose): { shoulder: Vec2; elbow: Vec2; wrist: Vec2 } {
  const { elbow, wrist } = forwardArm(rig, pose),
    shoulder = rig.joints.shoulder,
    sign = rig.side === 'L' ? 1 : -1;
  const place = (p: Vec2) => ({ x: shoulder.x + sign * p.x, y: shoulder.y + p.y });
  return { shoulder: { ...shoulder }, elbow: place(elbow), wrist: place(wrist) };
}

export function solveArmIK(input: ArmIKInput): ArmIKResult {
  const { rig } = input,
    l = rig.limits,
    sign = rig.bendSign;
  const invalid = (): ArmIKResult => ({
    valid: false,
    pose: { shoulder: 0, elbow: 0, wrist: 0 },
    elbow: { x: 0, y: 0 },
    wrist: { x: 0, y: 0 },
    wristError: 0,
    reasons: ['invalid-rig'],
  });
  if ([rig.lengths.upper, rig.lengths.lower].some((n) => !Number.isFinite(n) || n < 1e-6 || n > 1e9)) return invalid();
  let polygon: Vec2[], rest: ArmPose;
  try {
    polygon = armFeasiblePolygon(l, sign);
    rest = constrainArmPose(rig.restPose, l, sign, { shoulder: 0, elbow: 0, wrist: 0 });
  } catch {
    return invalid();
  }
  if (
    !safePoint(input.wrist) ||
    (input.elbow !== null && !safePoint(input.elbow)) ||
    (input.wristAngle !== null && !Number.isFinite(input.wristAngle))
  )
    return { valid: true, pose: rest, ...forwardArm(rig, rest), wristError: 0, reasons: ['invalid-input'] };
  const previous = input.previous && armPoseInLimits(input.previous, l, sign) ? input.previous : null;
  const requestedWrist = input.wristAngle ?? previous?.wrist ?? rest.wrist;
  const length = rig.lengths.upper + rig.lengths.lower;
  let best = rest,
    bestCost = Infinity;
  const score = (p: ArmPose): number => {
    const fk = forwardArm(rig, p);
    const wristCost = (distance(fk.wrist, input.wrist) / length) ** 2;
    const elbowCost = input.elbow ? 0.08 * (distance(fk.elbow, input.elbow) / length) ** 2 : 0;
    const continuity = previous
      ? 0.0005 * (((p.shoulder - previous.shoulder) / 180) ** 2 + ((p.elbow - previous.elbow) / 180) ** 2)
      : 0;
    return wristCost + elbowCost + continuity;
  };
  const project = (s: number, e: number): Vec2 => {
    const f = s + sign * e;
    if (
      s >= l.shoulder.min &&
      s <= l.shoulder.max &&
      e >= l.elbow.min &&
      e <= l.elbow.max &&
      f >= Math.max(l.forearm.min, l.hand.min - l.wrist.max) &&
      f <= Math.min(l.forearm.max, l.hand.max - l.wrist.min)
    )
      return { x: s, y: e };
    let point = polygon[0]!,
      cost = Infinity;
    for (let i = 0; i < polygon.length; i++) {
      const a = polygon[i]!,
        b = polygon[(i + 1) % polygon.length]!,
        dx = b.x - a.x,
        dy = b.y - a.y;
      const t =
        dx * dx + dy * dy > 0 ? clampArmNumber(((s - a.x) * dx + (e - a.y) * dy) / (dx * dx + dy * dy), 0, 1) : 0;
      const q = { x: a.x + t * dx, y: a.y + t * dy },
        c = (q.x - s) ** 2 + (q.y - e) ** 2;
      if (c < cost) {
        point = q;
        cost = c;
      }
    }
    return point;
  };
  const consider = (s: number, e: number) => {
    const q = project(s, e),
      f = q.x + sign * q.y;
    const pose = {
      shoulder: q.x,
      elbow: q.y,
      wrist: clampArmNumber(
        requestedWrist,
        Math.max(l.wrist.min, l.hand.min - f),
        Math.min(l.wrist.max, l.hand.max - f),
      ),
    };
    const cost = score(pose);
    if (cost < bestCost - 1e-16) {
      bestCost = cost;
      best = pose;
    }
  };
  consider(rest.shoulder, rest.elbow);
  if (previous) consider(previous.shoulder, previous.elbow);
  // 固定した肘の枝の解析解。±180度境界は許可区間に入る同じ向きの候補だけを作る。
  const u = rig.lengths.upper,
    v = rig.lengths.lower;
  const e = Math.acos(clampArmNumber((input.wrist.x ** 2 + input.wrist.y ** 2 - u * u - v * v) / (2 * u * v), -1, 1));
  const s = (Math.atan2(input.wrist.x, input.wrist.y) - Math.atan2(sign * v * Math.sin(e), u + v * Math.cos(e))) / RAD;
  const k = Math.floor((l.shoulder.min - s) / 360);
  for (let n = k; n <= k + 2; n++) consider(s + n * 360, e / RAD);
  // 境界と内部を有界に探索する。単独クランプだけでは届く点を取り逃がすため。
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i]!,
      b = polygon[(i + 1) % polygon.length]!;
    const steps = Math.max(1, Math.ceil(distance(a, b) / 6));
    for (let j = 0; j <= steps; j++) consider(a.x + ((b.x - a.x) * j) / steps, a.y + ((b.y - a.y) * j) / steps);
  }
  for (let a = l.shoulder.min; a <= l.shoulder.max; a += 12)
    for (let b = l.elbow.min; b <= l.elbow.max; b += 12) consider(a, b);
  for (let step = 6; step >= 0.001; step /= 4) {
    for (let iteration = 0; iteration < 20; iteration++) {
      const center = best,
        old = bestCost;
      for (const ds of [-step, 0, step])
        for (const de of [-step, 0, step]) consider(center.shoulder + ds, center.elbow + de);
      if (bestCost === old) break;
    }
  }
  best = constrainArmPose(best, l, sign, rest);
  const fk = forwardArm(rig, best),
    wristError = distance(fk.wrist, input.wrist);
  const reasons: ArmLimitReason[] = [];
  const values = {
    ...best,
    forearm: best.shoulder + sign * best.elbow,
    hand: best.shoulder + sign * best.elbow + best.wrist,
  };
  for (const key of ['shoulder', 'elbow', 'wrist', 'forearm', 'hand'] as const)
    if (Math.abs(values[key] - l[key].min) < 0.01 || Math.abs(values[key] - l[key].max) < 0.01) reasons.push(key);
  if (wristError > 0.5) reasons.push('unreachable');
  return { valid: true, pose: best, ...fk, wristError, reasons };
}
