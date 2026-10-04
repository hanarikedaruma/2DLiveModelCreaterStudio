import { STANDARD_PART_NAMES, type Model, type Part } from '@app/schema';
import {
  GROUP_TYPES,
  TREE_PARENT,
  groupChain,
  groupTypeOf,
  imageTypeOf,
  indexStandardParts,
  type GroupType,
} from './standardParts';

// 木の根から頭までの変形グループ。子が無くても作る（自由パーツと顔の傾きの置き場）
const ALWAYS: GroupType[] = ['bodyRoot', 'neckRoot', 'headRoot'];

export function newGroupPart(id: string, type: GroupType): Part {
  return {
    id,
    name: STANDARD_PART_NAMES[type],
    kind: 'group',
    standardType: type,
    assetId: null,
    meshId: null,
    parentId: null,
    position: { x: 0, y: 0 },
    rotation: 0,
    scale: { x: 1, y: 1 },
    pivot: { x: 0, y: 0 },
    opacity: 1,
    blendMode: 'normal',
    depth: 0,
    mask: null,
    physicsId: null,
    visible: true,
    locked: false,
  };
}

// 変形グループを足し（無いものだけ。子の無いグループは作らない）、親を木のとおりにする。
// 親の無い自由パーツは headRoot の子にする。親を変えないパーツは同じ参照のまま
export function buildHierarchy(model: Model, newId: () => string): Model {
  const index = indexStandardParts(model.parts);
  const needed = new Set<GroupType>(ALWAYS);
  for (const part of model.parts) {
    const type = imageTypeOf(part);
    if (type) for (const g of groupChain(type)) needed.add(g);
  }
  const created = GROUP_TYPES.filter((t) => needed.has(t) && !index.group(t)).map((t) => newGroupPart(newId(), t));
  const groupIds = new Map<GroupType, string>();
  for (const t of GROUP_TYPES) {
    const id = index.group(t)?.id ?? created.find((g) => g.standardType === t)?.id;
    if (id) groupIds.set(t, id);
  }
  // 木の親が無ければ、さらに上のグループにする（bodyRoot はかならずある）
  const nearestGroup = (type: GroupType): string | null => {
    for (const g of [type, ...groupChain(type)]) {
      const id = groupIds.get(g);
      if (id) return id;
    }
    return null;
  };
  const headId = groupIds.get('headRoot') ?? null;
  const ids = new Set([...model.parts, ...created].map((p) => p.id));

  const parentOf = (part: Part): string | null => {
    const image = imageTypeOf(part);
    if (image) return nearestGroup(TREE_PARENT[image]);
    const group = groupTypeOf(part);
    if (group) return group === 'bodyRoot' ? null : nearestGroup(TREE_PARENT[group]);
    // 自由パーツ
    if (part.parentId === null || part.parentId === part.id || !ids.has(part.parentId)) return headId;
    return part.parentId;
  };

  const parts = [...model.parts, ...created].map((part) => {
    const parentId = parentOf(part);
    return parentId === part.parentId ? part : { ...part, parentId };
  });
  const changed = created.length > 0 || parts.some((p, i) => p !== model.parts[i]);
  return changed ? { ...model, parts } : model;
}
