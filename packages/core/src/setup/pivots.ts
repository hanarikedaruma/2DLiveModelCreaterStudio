import type { Model, Part, Vec2 } from '@app/schema';
import { rectBottomCenter, rectCenter, rectTopCenter, unionRects, type Rect } from '../generate/bounds';
import { imageTypeOf, groupTypeOf, indexStandardParts, type GroupType, type ImageType } from './standardParts';

const HAIR: ReadonlySet<ImageType> = new Set(['frontHair', 'sideHairL', 'sideHairR', 'backHair']);
const EYE_WHITE: ReadonlySet<ImageType> = new Set(['eyeWhiteL', 'eyeWhiteR']);

// 標準の画像パーツのピボット。髪 = 上端中央、白目 = 下端中央、その他 = 中心
export function imagePivot(type: ImageType, rect: Rect): Vec2 {
  if (HAIR.has(type)) return rectTopCenter(rect);
  if (EYE_WHITE.has(type)) return rectBottomCenter(rect);
  return rectCenter(rect);
}

export type BoundsOf = (part: Part) => Rect | null;

// ピボットを決める。標準の画像パーツと変形グループだけを変え、自由パーツと決められないものはそのまま
export function computePivots(
  model: Model,
  boundsOf: BoundsOf,
  canvas: { width: number; height: number } | null,
): Model {
  const index = indexStandardParts(model.parts);
  const children = new Map<string, Part[]>();
  for (const p of model.parts) {
    if (p.parentId !== null) children.set(p.parentId, [...(children.get(p.parentId) ?? []), p]);
  }
  // 子孫の画像パーツの外接矩形
  const descendantRect = (root: Part): Rect | null => {
    const rects: (Rect | null)[] = [];
    const seen = new Set<string>([root.id]);
    const stack = [...(children.get(root.id) ?? [])];
    while (stack.length) {
      const p = stack.pop()!;
      if (seen.has(p.id)) continue;
      seen.add(p.id);
      if (p.kind === 'image') rects.push(boundsOf(p));
      stack.push(...(children.get(p.id) ?? []));
    }
    return unionRects(rects);
  };
  const rectOf = (type: ImageType): Rect | null => {
    const part = index.first(type);
    return part ? boundsOf(part) : null;
  };
  const firstOf = <T>(...candidates: (() => T | null | undefined)[]): T | null => {
    for (const c of candidates) {
      const v = c();
      if (v) return v;
    }
    return null;
  };
  const map = <T>(v: T | null, f: (v: T) => Vec2): Vec2 | null => (v ? f(v) : null);

  const groupPivot = (type: GroupType, part: Part): Vec2 | null => {
    switch (type) {
      case 'bodyRoot':
        // 胴体の下端中央。無ければキャンバスの下端中央
        return firstOf(
          () => map(rectOf('torso'), rectBottomCenter),
          () => (canvas ? { x: canvas.width / 2, y: canvas.height } : null),
          () => map(descendantRect(part), rectBottomCenter),
        );
      case 'armRootL':
        return firstOf(() => map(rectOf('armL'), rectTopCenter));
      case 'armRootR':
        return firstOf(() => map(rectOf('armR'), rectTopCenter));
      case 'neckRoot':
        // 首の下端中央。無ければ顔の下端中央
        return firstOf(
          () => map(rectOf('neck'), rectBottomCenter),
          () => map(rectOf('face'), rectBottomCenter),
          () => map(descendantRect(part), rectBottomCenter),
        );
      case 'headRoot':
        // 首の上端中央。無ければ顔の下端中央
        return firstOf(
          () => map(rectOf('neck'), rectTopCenter),
          () => map(rectOf('face'), rectBottomCenter),
          () => map(descendantRect(part), rectBottomCenter),
        );
      case 'faceGroup':
      case 'eyeGroupL':
      case 'eyeGroupR':
      case 'mouthGroup':
        // 子の外接矩形の中心
        return map(descendantRect(part), rectCenter);
    }
  };

  let changed = false;
  const parts = model.parts.map((part) => {
    const image = imageTypeOf(part);
    const group = groupTypeOf(part);
    let pivot: Vec2 | null = null;
    if (image) pivot = map(boundsOf(part), (r) => imagePivot(image, r));
    else if (group) pivot = groupPivot(group, part);
    if (!pivot || (pivot.x === part.pivot.x && pivot.y === part.pivot.y)) return part;
    changed = true;
    return { ...part, pivot };
  });
  return changed ? { ...model, parts } : model;
}
