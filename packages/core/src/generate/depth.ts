import { depthParallaxOffset, type Binding, type Model, type ParameterKey, type Part } from '@app/schema';
import { unionRects, type Rect } from './bounds';
import { findTransformBindingIndex, rebuildTransformBinding, transformDelta, type KeySpec } from './keys';

export type FaceAngleParameter = 'FaceAngleX' | 'FaceAngleY';

// 顔の向きのキーの位置
export const FACE_ANGLE_KEY_VALUES = [-30, 0, 30];
// 顔の輪郭の横の縮み（30度で 4%）
export const FACE_SQUEEZE = 0.04;

// standardType 'headRoot' のグループの子孫にある画像パーツ（parts の順）
export function headImageParts(model: Model): Part[] {
  const heads = new Set(
    model.parts.filter((p) => p.kind === 'group' && p.standardType === 'headRoot').map((p) => p.id),
  );
  if (heads.size === 0) return [];
  const byId = new Map(model.parts.map((p) => [p.id, p]));
  return model.parts.filter((p) => p.kind === 'image' && hasAncestorIn(p, heads, byId));
}

function hasAncestorIn(part: Part, ids: Set<string>, byId: Map<string, Part>): boolean {
  const seen = new Set<string>([part.id]);
  let id = part.parentId;
  while (id !== null && !seen.has(id)) {
    if (ids.has(id)) return true;
    seen.add(id);
    id = byId.get(id)?.parentId ?? null;
  }
  return false;
}

// 顔の幅。'face' の素材の幅、無ければ headRoot 配下の外接矩形の幅。分からなければ 0
export function faceWidthOf(model: Model, boundsOf: (part: Part) => Rect | null): number {
  const face = model.parts.find((p) => p.kind === 'image' && p.standardType === 'face');
  const faceRect = face ? boundsOf(face) : null;
  if (faceRect && faceRect.width > 0) return faceRect.width;
  return unionRects(headImageParts(model).map(boundsOf))?.width ?? 0;
}

// 奥行きによる1つのキーの差分。'face' は FaceAngleX のとき横に縮める
export function depthKeyDelta(part: Part, parameterId: FaceAngleParameter, value: number, faceWidth: number) {
  if (parameterId === 'FaceAngleX') {
    const squeeze = part.standardType === 'face' ? 1 - (FACE_SQUEEZE * Math.abs(value)) / 30 : 1;
    return transformDelta({ x: depthParallaxOffset(part.depth, value, faceWidth, 'x'), scaleX: squeeze });
  }
  return transformDelta({ y: depthParallaxOffset(part.depth, value, faceWidth, 'y') });
}

export function depthKeySpecs(part: Part, parameterId: FaceAngleParameter, faceWidth: number): KeySpec[] {
  return FACE_ANGLE_KEY_VALUES.map((value) => ({
    coord: value,
    delta: depthKeyDelta(part, parameterId, value, faceWidth),
  }));
}

export interface DepthOptions {
  faceWidth: number;
  keep: (key: ParameterKey) => boolean; // 残す既存のキー
  newId: () => string;
}

// headRoot 配下の画像パーツごとに、奥行きの transform バインディングを作り直す（無ければ作る）
export function depthBindings(model: Model, parameterId: FaceAngleParameter, options: DepthOptions): Binding[] {
  return headImageParts(model).map((part) =>
    rebuildTransformBinding({
      existing: model.bindings[findTransformBindingIndex(model.bindings, part.id, parameterId)],
      partId: part.id,
      parameterId,
      keys: depthKeySpecs(part, parameterId, options.faceWidth),
      keep: options.keep,
      generation: 'depth',
      newId: options.newId,
      defaultCoord: model.parameters.find((p) => p.id === parameterId)?.default ?? 0,
      opacityBase: part.opacity,
    }),
  );
}
