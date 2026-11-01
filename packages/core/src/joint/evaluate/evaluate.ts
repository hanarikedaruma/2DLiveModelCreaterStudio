import { HAND_SHAPES, inspectArmRigs, type ArmRig, type HandShape, type Model, type Vec2 } from '@app/schema';
import type { ArmRigEvaluation, ParamValues } from '@app/contracts';
import { constrainArmPose } from '../math';

const finiteValue = (values: ParamValues, key: string, fallback: number) =>
  Number.isFinite(values[key]) ? values[key]! : fallback;
const descendants = (model: Model, root: string): string[] => {
  const result = new Set([root]);
  for (let changed = true; changed;) {
    changed = false;
    for (const p of model.parts)
      if (p.parentId !== null && result.has(p.parentId) && !result.has(p.id)) {
        result.add(p.id);
        changed = true;
      }
  }
  return [...result];
};
export function armOwnedParts(model: Model, rig: ArmRig): string[] {
  return [...new Set(Object.values(rig.groups).flatMap((id) => descendants(model, id)))];
}

export function selectArmHand(rig: ArmRig, values: ParamValues): HandShape | null {
  const available = HAND_SHAPES.filter((h) => (rig.hands[h]?.partIds.length ?? 0) > 0);
  const rest = available.includes(rig.restHand) ? rig.restHand : (available[0] ?? null);
  let selected = rest,
    highest = 0;
  for (const shape of available) {
    const weight = Math.min(1, Math.max(0, finiteValue(values, rig.parameters.shapes[shape], 0)));
    if (weight > highest) {
      highest = weight;
      selected = shape;
    }
  }
  return selected;
}

// パラメータ合成後に呼ぶ純粋な評価。追跡・時計・以前の頂点には依存しない。
export function evaluateArmRigs(model: Model, values: ParamValues): ArmRigEvaluation {
  const issues = inspectArmRigs(model);
  const out: ArmRigEvaluation = { joints: [], hands: [], opacityGates: {}, poses: {}, issues };
  for (const rig of model.armRigs ?? []) {
    if (issues.some((i) => i.rigId === rig.id && i.severity === 'error')) {
      // 制約を適用できない腕を反転・逆曲がりのまま配信しない。保存した素材は残す。
      for (const id of armOwnedParts(model, rig)) out.opacityGates[id] = 0;
      continue;
    }
    const selected = rig.enabled ? selectArmHand(rig, values) : rig.restHand;
    for (const shape of HAND_SHAPES)
      for (const id of rig.hands[shape]?.partIds ?? []) out.opacityGates[id] = shape === selected ? 1 : 0;
    if (!rig.enabled) continue;
    const requested = {
      shoulder: finiteValue(values, rig.parameters.shoulder, rig.restPose.shoulder),
      elbow: finiteValue(values, rig.parameters.elbow, rig.restPose.elbow),
      wrist: finiteValue(values, rig.parameters.wrist, rig.restPose.wrist),
    };
    let pose;
    try {
      pose = constrainArmPose(requested, rig.limits, rig.bendSign, rig.restPose);
    } catch {
      for (const id of armOwnedParts(model, rig)) out.opacityGates[id] = 0;
      continue;
    }
    out.poses[rig.side] = pose;
    const sign = rig.side === 'L' ? -1 : 1;
    for (const key of ['shoulder', 'elbow', 'wrist'] as const)
      out.joints.push({
        partId: rig.groups[key],
        pivot: rig.joints[key],
        rotation: sign * (key === 'elbow' ? rig.bendSign : 1) * (pose[key] - rig.referencePose[key]),
      });
    const angle =
      ((rig.referencePose.shoulder + rig.bendSign * rig.referencePose.elbow + rig.referencePose.wrist) * Math.PI) / 180;
    const desired: Vec2 = { x: -sign * Math.sin(angle), y: Math.cos(angle) };
    for (const hand of Object.values(rig.hands)) {
      const a = Math.atan2(desired.y, desired.x) - Math.atan2(hand.fingerDirection.y, hand.fingerDirection.x);
      out.hands.push({
        partIds: [...hand.partIds],
        from: { ...hand.wrist },
        to: { ...rig.joints.wrist },
        rotation: (a * 180) / Math.PI,
      });
    }
  }
  return out;
}
