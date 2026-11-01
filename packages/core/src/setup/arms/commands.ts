import {
  IDENTITY,
  armParameterIds,
  armParameters,
  armRigSchema,
  defaultArmLimits,
  inspectArmRigs,
  multiplyAffine,
  newId,
  partAffine,
  transformVec,
  type Affine,
  type ArmHandAttachment,
  type ArmLimits,
  type ArmPose,
  type ArmRig,
  type ArmSide,
  type HandShape,
  type Model,
  type Part,
  type Project,
  type Vec2,
} from '@app/schema';
import type { Command } from '@app/contracts';
import { createPointTargetMapper } from '../../deform/inverse';
import { armOwnedParts } from '../../joint/evaluate';

export interface ArmSetupInput {
  side: ArmSide;
  parentPartId: string | null;
  upperPartIds: string[];
  forearmPartIds: string[];
  joints: ArmRig['joints'];
  hands: Partial<Record<HandShape, ArmHandAttachment>>;
  referenceWristAngle?: number; // 基準画像の前腕に対する手の角度。省略は延長方向の0度。
  acknowledgeLegacy?: boolean;
}
export interface ArmSetupPlan {
  command: Command | null;
  rig: ArmRig | null;
  errors: string[];
  warnings: string[];
}
const wrap = (n: number) => ((((n + 180) % 360) + 360) % 360) - 180;
export function armReferenceFromJoints(
  side: ArmSide,
  joints: ArmRig['joints'],
  wristAngle = 0,
): Pick<ArmRig, 'lengths' | 'referencePose' | 'bendSign'> {
  const sign = side === 'L' ? 1 : -1;
  const { shoulder: s, elbow: e, wrist: w } = joints;
  const a = (Math.atan2(sign * (e.x - s.x), e.y - s.y) * 180) / Math.PI;
  const b = (Math.atan2(sign * (w.x - e.x), w.y - e.y) * 180) / Math.PI;
  const bend = wrap(b - a);
  return {
    lengths: { upper: Math.hypot(e.x - s.x, e.y - s.y), lower: Math.hypot(w.x - e.x, w.y - e.y) },
    referencePose: { shoulder: a, elbow: Math.abs(bend), wrist: wristAngle },
    bendSign: bend < -1e-6 ? -1 : 1,
  };
}
function inverse(m: Affine): Affine {
  const d = m.a * m.d - m.b * m.c;
  if (!(d > 1e-10)) throw new Error('親の変換を逆にできない（反転・倍率0）');
  return {
    a: m.d / d,
    b: -m.b / d,
    c: -m.c / d,
    d: m.a / d,
    e: (m.c * m.f - m.d * m.e) / d,
    f: (m.b * m.e - m.a * m.f) / d,
  };
}
export function armParentTransform(model: Model, parentId: string | null): Affine {
  let m: Affine = { ...IDENTITY };
  const seen = new Set<string>();
  for (let at = parentId; at !== null;) {
    if (seen.has(at)) throw new Error('親の参照が循環している');
    seen.add(at);
    const p = model.parts.find((p) => p.id === at);
    if (!p) throw new Error('親のパーツが無い');
    if (model.warps.some((w) => w.partId === at) || p.scale.x <= 0 || Math.abs(p.scale.x - p.scale.y) > 1e-6)
      throw new Error('腕の親はワープ無し・正の等倍率にする');
    m = multiplyAffine(partAffine(p, undefined), m);
    at = p.parentId;
  }
  return m;
}
// 既存の逆変換ソルバーで、表示位置を親の基準空間へ戻す。
export function armSetupPointMapper(
  model: Model,
  parentId: string | null,
  initial: Vec2[],
): (targets: Vec2[]) => Vec2[] | null {
  const m = armParentTransform(model, parentId);
  return createPointTargetMapper((points) => points.map((p) => transformVec(m, p)), initial);
}
function reparent(model: Model, part: Part, parentId: string, parentMatrix: Affine): Part {
  const world = multiplyAffine(armParentTransform(model, part.parentId), partAffine(part, undefined));
  const local = multiplyAffine(inverse(parentMatrix), world);
  const scale = Math.hypot(local.a, local.b),
    rotation = (Math.atan2(local.b, local.a) * 180) / Math.PI;
  const { x, y } = part.pivot;
  return {
    ...part,
    parentId,
    rotation,
    scale: { x: scale, y: scale },
    position: { x: local.e - x + local.a * x + local.c * y, y: local.f - y + local.b * x + local.d * y },
  };
}
function group(id: string, parentId: string | null, pivot: Vec2, name: string): Part {
  return {
    id,
    parentId,
    pivot,
    name,
    kind: 'group',
    standardType: null,
    assetId: null,
    meshId: null,
    position: { x: 0, y: 0 },
    rotation: 0,
    scale: { x: 1, y: 1 },
    opacity: 1,
    blendMode: 'normal',
    depth: 0,
    mask: null,
    physicsId: null,
    visible: true,
    locked: false,
  };
}
function withRig(project: Project, rig: ArmRig): Project {
  const parameters = armParameters(rig),
    ids = new Set(parameters.map((p) => p.id));
  return {
    ...project,
    model: {
      ...project.model,
      armRigs: [...(project.model.armRigs ?? []).filter((r) => r.id !== rig.id), rig],
      parameters: [...project.model.parameters.filter((p) => !ids.has(p.id)), ...parameters],
    },
  };
}
export function planArmSetup(project: Project, input: ArmSetupInput): ArmSetupPlan {
  const errors: string[] = [],
    warnings: string[] = [],
    model = project.model;
  if (model.armRigs?.some((r) => r.side === input.side))
    errors.push('この側の腕は設定済み。既存の設定を編集するか解除する');
  const assignments = [
    ...input.upperPartIds,
    ...input.forearmPartIds,
    ...Object.values(input.hands).flatMap((h) => h.partIds),
  ];
  if (!input.upperPartIds.length || !input.forearmPartIds.length) errors.push('上腕と前腕の素材をそれぞれ選ぶ');
  if (new Set(assignments).size !== assignments.length) errors.push('同じ素材を複数の関節・手形へ割り当てない');
  if (!input.hands.open?.partIds.length) errors.push('休止形に使うパーの素材を選ぶ');
  const selected = model.parts.filter((p) => assignments.includes(p.id));
  if (selected.length !== assignments.length) errors.push('選んだ素材が見つからない');
  if (selected.some((p) => p.locked)) errors.push('ロックされた素材がある。配置を変更する前にロックを解除する');
  if (assignments.includes(input.parentPartId ?? '')) errors.push('腕の素材自身を体側の親にできない');
  for (const p of selected) {
    if (!(p.scale.x > 0 && Math.abs(p.scale.x - p.scale.y) < 1e-6))
      errors.push(`素材の倍率は正の等倍率にする（${p.name}）`);
    if (p.kind !== 'image') errors.push(`画像パーツを選ぶ（${p.name}）`);
    if (
      model.warps.some((w) => w.partId === p.id) ||
      model.bindings.some((b) => b.target.id === p.id || (p.meshId !== null && b.target.id === p.meshId))
    )
      errors.push(`既存のキー・ワープを分離した素材を選ぶ（${p.name}）。キーは削除しない`);
    if (model.armRigs?.some((r) => armOwnedParts(model, r).includes(p.id)))
      errors.push(`別の腕が使用している素材（${p.name}）`);
    let at = p.parentId;
    const seen = new Set<string>();
    while (at !== null && at !== input.parentPartId && !seen.has(at)) {
      seen.add(at);
      const keys = model.bindings.filter((b) => b.target.type === 'part' && b.target.id === at);
      if (keys.some((b) => b.parameterIds.some((id) => id === 'ArmL' || id === 'ArmR')))
        warnings.push('旧ArmL/Rのグループから専用関節へ付け替える。元のグループとキーは残る');
      if (keys.some((b) => b.parameterIds.some((id) => id !== 'ArmL' && id !== 'ArmR')))
        errors.push('移動元の親に別の動きのキーがある。専用素材へ分離してから設定する');
      at = model.parts.find((p) => p.id === at)?.parentId ?? null;
    }
  }
  if (warnings.length && !input.acknowledgeLegacy) errors.push('旧ArmL/Rからの付け替えを確認する');
  const prefix = `arm-${input.side}-${newId()}`;
  const groups = { shoulder: `${prefix}-shoulder`, elbow: `${prefix}-elbow`, wrist: `${prefix}-wrist` };
  const rig: ArmRig = {
    id: prefix,
    side: input.side,
    enabled: true,
    parentPartId: input.parentPartId,
    groups,
    joints: structuredClone(input.joints),
    ...armReferenceFromJoints(input.side, input.joints, input.referenceWristAngle),
    restPose: { shoulder: 8, elbow: 12, wrist: 0 },
    limits: defaultArmLimits(),
    hands: structuredClone(input.hands),
    restHand: 'open',
    parameters: armParameterIds(input.side),
  };
  const reserved = Object.values(rig.parameters).flatMap((v) => (typeof v === 'string' ? [v] : Object.values(v)));
  if (model.parameters.some((p) => reserved.includes(p.id) && !p.standard))
    errors.push('腕の標準パラメータIDに独自のパラメータがある。既存設定を確認する');
  let next: Project;
  try {
    const parentMatrix = armParentTransform(model, input.parentPartId);
    const parentFor = (id: string) =>
      input.upperPartIds.includes(id)
        ? groups.shoulder
        : input.forearmPartIds.includes(id)
          ? groups.elbow
          : groups.wrist;
    const handImages = new Set(Object.values(rig.hands).flatMap((h) => h.partIds));
    const parts = model.parts.map((p) =>
      assignments.includes(p.id)
        ? { ...reparent(model, p, parentFor(p.id), parentMatrix), visible: handImages.has(p.id) ? true : p.visible }
        : p,
    );
    parts.push(
      group(groups.shoulder, input.parentPartId, rig.joints.shoulder, `肩 ${input.side}`),
      group(groups.elbow, groups.shoulder, rig.joints.elbow, `肘 ${input.side}`),
      group(groups.wrist, groups.elbow, rig.joints.wrist, `手首 ${input.side}`),
    );
    next = withRig({ ...project, model: { ...model, parts } }, rig);
    errors.push(
      ...inspectArmRigs(next.model)
        .filter((i) => i.rigId === rig.id && i.severity === 'error')
        .map((i) => i.message),
    );
    armRigSchema.parse(rig);
  } catch (e) {
    errors.push(e instanceof Error ? e.message : String(e));
    next = project;
  }
  if (errors.length) return { rig, command: null, errors: [...new Set(errors)], warnings: [...new Set(warnings)] };
  const expected = project.model;
  return {
    rig,
    errors: [],
    warnings: [...new Set(warnings)],
    command: {
      label: `${input.side === 'L' ? '左' : '右'}腕の関節を設定`,
      apply: (p) => (p.model === expected ? { ...p, model: next.model } : p),
    },
  };
}
export function changeArmRig(project: Project, rig: ArmRig): ArmSetupPlan {
  const next = withRig(project, rig),
    errors = inspectArmRigs(next.model)
      .filter((i) => i.rigId === rig.id && i.severity === 'error')
      .map((i) => i.message);
  try {
    armRigSchema.parse(rig);
  } catch (e) {
    errors.push(e instanceof Error ? e.message : String(e));
  }
  return {
    rig,
    warnings: [],
    errors: [...new Set(errors)],
    command: errors.length
      ? null
      : { label: '腕の設定を変更', apply: (p) => (p.model === project.model ? { ...p, model: next.model } : p) },
  };
}
export function armInFront(rigId: string): Command {
  return {
    label: '前腕と手を顔より前に配置',
    apply: (p) => {
      const rig = p.model.armRigs?.find((r) => r.id === rigId);
      if (!rig) return p;
      const front = new Set<string>([rig.groups.elbow, rig.groups.wrist]);
      for (let changed = true; changed;) {
        changed = false;
        for (const part of p.model.parts)
          if (part.parentId && front.has(part.parentId) && !front.has(part.id)) {
            front.add(part.id);
            changed = true;
          }
      }
      const order = [
        ...p.model.drawOrder,
        ...p.model.parts
          .filter((part) => part.kind === 'image' && !p.model.drawOrder.includes(part.id))
          .map((part) => part.id),
      ];
      return {
        ...p,
        model: {
          ...p.model,
          drawOrder: [...order.filter((id) => !front.has(id)), ...order.filter((id) => front.has(id))],
        },
      };
    },
  };
}
export function releaseArmRig(rigId: string): Command {
  return {
    label: '腕の関節設定を解除',
    apply: (p) => {
      const rig = p.model.armRigs?.find((r) => r.id === rigId);
      if (!rig) return p;
      const groups = new Set(Object.values(rig.groups));
      const handIds = new Set(Object.values(rig.hands).flatMap((h) => h.partIds)),
        restIds = new Set(rig.hands[rig.restHand]?.partIds ?? []);
      const parts = p.model.parts
        .filter((part) => !groups.has(part.id))
        .map((part) => ({
          ...part,
          parentId: part.parentId && groups.has(part.parentId) ? rig.parentPartId : part.parentId,
          visible: handIds.has(part.id) ? restIds.has(part.id) : part.visible,
        }));
      return {
        ...p,
        model: { ...p.model, parts, armRigs: p.model.armRigs!.filter((r) => r.id !== rigId) },
        ...(p.armTracking
          ? {
              armTracking: {
                ...p.armTracking,
                sides: { ...p.armTracking.sides, [rig.side]: { ...p.armTracking.sides[rig.side], enabled: false } },
              },
            }
          : {}),
      };
    },
  };
}
export type ArmEditableSettings = { restPose: ArmPose; limits: ArmLimits };
