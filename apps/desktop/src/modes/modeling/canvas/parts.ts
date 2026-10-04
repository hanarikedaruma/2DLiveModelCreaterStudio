// パーツの木をたどる計算（実際の姿勢・親までの変形・ロック・選択枠）。純粋関数
import type { Model, Part, TransformDelta, Vec2 } from '@app/schema';
import type { DeformedModel, ParamValues } from '@app/contracts';
import {
  IDENTITY,
  applyAffine,
  boxFrame,
  itemPoints,
  multiply,
  poseMatrix,
  selectionBox,
  type Affine,
  type Pose,
  type SelectionBox,
} from './geometry';

export type Transforms = Record<string, TransformDelta>;

// 無いパラメータはデフォルト値
export function paramValuesOf(model: Model, editorValues: ParamValues): ParamValues {
  const out: ParamValues = {};
  for (const p of model.parameters) out[p.id] = editorValues[p.id] ?? p.default;
  return out;
}

export function partById(model: Model, id: string): Part | undefined {
  return model.parts.find((p) => p.id === id);
}

// 親から順にルートまで（自身は含めない）。輪になっていても止まる
export function ancestorsOf(model: Model, partId: string): Part[] {
  const out: Part[] = [];
  const seen = new Set<string>([partId]);
  let parentId = partById(model, partId)?.parentId ?? null;
  while (parentId && !seen.has(parentId)) {
    seen.add(parentId);
    const parent = partById(model, parentId);
    if (!parent) break;
    out.push(parent);
    parentId = parent.parentId;
  }
  return out;
}

// 自身か親のどれかがロックされている
export function isLockedDeep(model: Model, partId: string): boolean {
  const part = partById(model, partId);
  if (!part) return true;
  return part.locked || ancestorsOf(model, partId).some((p) => p.locked);
}

// 自身と子孫のうち画像パーツの id
export function imageDescendants(model: Model, partId: string): string[] {
  const out: string[] = [];
  const visit = (id: string, depth: number) => {
    const part = partById(model, id);
    if (!part || depth > 64) return;
    if (part.kind === 'image') out.push(id);
    for (const child of model.parts) if (child.parentId === id) visit(child.id, depth + 1);
  };
  visit(partId, 0);
  return out;
}

// 実際に使う値: position・rotation は加算、scale は倍率
export function effectivePose(part: Part, delta?: TransformDelta): Pose {
  if (!delta) return { position: part.position, rotation: part.rotation, scale: part.scale, pivot: part.pivot };
  return {
    position: { x: part.position.x + delta.position.x, y: part.position.y + delta.position.y },
    rotation: part.rotation + delta.rotation,
    scale: { x: part.scale.x * delta.scale.x, y: part.scale.y * delta.scale.y },
    pivot: part.pivot,
  };
}

// 親（ルートまで）の変形を掛ける行列。ワープは含めない
export function ancestorMatrix(model: Model, transforms: Transforms, partId: string): Affine {
  let m = IDENTITY;
  for (const parent of ancestorsOf(model, partId))
    m = multiply(poseMatrix(effectivePose(parent, transforms[parent.id])), m);
  return m;
}

// 自身と親の変形（基準の位置 → キャンバス上の位置）
export function partMatrix(model: Model, transforms: Transforms, partId: string): Affine {
  const part = partById(model, partId);
  const parent = ancestorMatrix(model, transforms, partId);
  return part ? multiply(parent, poseMatrix(effectivePose(part, transforms[partId]))) : parent;
}

export interface TargetPose {
  partId: string;
  parent: Affine; // 親までの変形
  pose: Pose; // 実際の値（基準 + 差分）
  pivot: Vec2; // ピボットのキャンバス上の位置
}

export function targetPose(model: Model, transforms: Transforms, part: Part): TargetPose {
  const parent = ancestorMatrix(model, transforms, part.id);
  const pose = effectivePose(part, transforms[part.id]);
  return {
    partId: part.id,
    parent,
    pose,
    pivot: applyAffine(parent, { x: pose.position.x + pose.pivot.x, y: pose.position.y + pose.pivot.y }),
  };
}

export interface SelectionInfo {
  targets: TargetPose[]; // 動かすパーツ（先頭が主）。ロックと、祖先も選ばれているものは除く
  box: SelectionBox | null; // 主のパーツの向きの枠
}

export function selectionInfo(
  model: Model,
  transforms: Transforms,
  deformed: DeformedModel | null,
  selectedIds: string[],
): SelectionInfo {
  const selected = new Set(selectedIds);
  const parts: Part[] = [];
  for (const id of selectedIds) {
    const part = partById(model, id);
    if (!part || parts.includes(part) || isLockedDeep(model, id)) continue;
    if (ancestorsOf(model, id).some((p) => selected.has(p.id))) continue;
    parts.push(part);
  }
  const targets = parts.map((p) => targetPose(model, transforms, p));
  const primary = targets[0];
  if (!primary || !deformed) return { targets, box: null };
  const points = targets.flatMap((t) =>
    imageDescendants(model, t.partId).flatMap((id) => {
      const item = deformed.byPartId[id];
      return item ? itemPoints(item) : [];
    }),
  );
  return { targets, box: selectionBox(boxFrame(primary.parent, primary.pose), points) };
}
