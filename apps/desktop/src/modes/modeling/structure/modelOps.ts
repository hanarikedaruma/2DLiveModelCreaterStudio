// パーツの木（parentId）を扱う純粋な関数。カード17（割り当ての解除）とカード20（構造の編集）で使う
import { newId } from '@app/schema';
import type { Asset, Model, Part, Project, Vec2 } from '@app/schema';

// 子の並び（兄弟の順）は model.parts の中の順番。parentId が null か、親が見つからないものを根とする
export function childrenOf(model: Model, parentId: string | null): Part[] {
  if (parentId === null) {
    const ids = new Set(model.parts.map((p) => p.id));
    return model.parts.filter((p) => p.parentId === null || !ids.has(p.parentId));
  }
  return model.parts.filter((p) => p.parentId === parentId);
}

// 子孫の id（自身は含まない）。親子が輪になっていても止まる
export function descendantIds(model: Model, id: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>([id]);
  const queue = [id];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const p of model.parts) {
      if (p.parentId === current && !seen.has(p.id)) {
        seen.add(p.id);
        out.push(p.id);
        queue.push(p.id);
      }
    }
  }
  return out;
}

// ids と、その子孫すべて
export function subtreeIds(model: Model, ids: readonly string[]): Set<string> {
  const exists = new Set(model.parts.map((p) => p.id));
  const out = new Set<string>();
  for (const id of ids) {
    if (!exists.has(id) || out.has(id)) continue;
    out.add(id);
    for (const d of descendantIds(model, id)) out.add(d);
  }
  return out;
}

// id が ancestorId 自身か、その子孫か
export function isInside(model: Model, id: string, ancestorId: string): boolean {
  return id === ancestorId || descendantIds(model, ancestorId).includes(id);
}

// 祖先も ids に入っているものを除く（parts の順）
export function topMost(model: Model, ids: readonly string[]): string[] {
  const set = new Set(ids);
  const byId = new Map(model.parts.map((p) => [p.id, p]));
  return model.parts
    .filter((p) => {
      if (!set.has(p.id)) return false;
      const seen = new Set<string>([p.id]);
      let parent = p.parentId ? byId.get(p.parentId) : undefined;
      while (parent && !seen.has(parent.id)) {
        if (set.has(parent.id)) return false;
        seen.add(parent.id);
        parent = parent.parentId ? byId.get(parent.parentId) : undefined;
      }
      return true;
    })
    .map((p) => p.id);
}

// ids（グループなら子孫も）に含まれる画像パーツの id を drawOrder の順（背面 → 前面）で返す
export function drawOrderBlock(model: Model, ids: readonly string[]): string[] {
  const subtree = subtreeIds(model, ids);
  const images = new Set(model.parts.filter((p) => subtree.has(p.id) && p.kind === 'image').map((p) => p.id));
  return model.drawOrder.filter((id) => images.has(id));
}

// 素材の矩形を合わせた外接矩形の中心。素材が無ければ null
export function assetsCenter(assets: readonly Asset[]): Vec2 | null {
  if (assets.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const a of assets) {
    minX = Math.min(minX, a.offset.x);
    minY = Math.min(minY, a.offset.y);
    maxX = Math.max(maxX, a.offset.x + a.width);
    maxY = Math.max(maxY, a.offset.y + a.height);
  }
  return { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
}

// パーツ（グループなら子孫の画像パーツ）の素材を合わせた中心
export function partsCenter(project: Project, ids: readonly string[]): Vec2 | null {
  const subtree = subtreeIds(project.model, ids);
  const assetIds = new Set(
    project.model.parts.filter((p) => subtree.has(p.id) && p.kind === 'image' && p.assetId).map((p) => p.assetId!),
  );
  return assetsCenter(project.assets.filter((a) => assetIds.has(a.id)));
}

// パーツを子孫ごと消す。メッシュ・ワープ・関係するバインディング・drawOrder・マスクの参照・物理も消す
export function removeParts(project: Project, ids: readonly string[]): Project {
  const { model } = project;
  const removed = subtreeIds(model, ids);
  if (removed.size === 0) return project;
  const removedMeshes = new Set(
    model.parts.filter((p) => removed.has(p.id) && p.meshId !== null).map((p) => p.meshId!),
  );
  const removedWarps = new Set(model.warps.filter((w) => removed.has(w.partId)).map((w) => w.id));
  const removedPhysics = new Set(project.physics.filter((ph) => removed.has(ph.partId)).map((ph) => ph.id));
  const removedColliders = new Set(
    (model.shoulderColliders ?? [])
      .filter((c) => removed.has(c.partId) || removedMeshes.has(c.meshId))
      .map((c) => c.id),
  );

  const parts = model.parts
    .filter((p) => !removed.has(p.id))
    .map((p) => {
      let next = p;
      if (p.mask && p.mask.sourcePartIds.some((id) => removed.has(id))) {
        const sourcePartIds = p.mask.sourcePartIds.filter((id) => !removed.has(id));
        next = { ...next, mask: sourcePartIds.length > 0 ? { ...p.mask, sourcePartIds } : null };
      }
      if (p.physicsId !== null && removedPhysics.has(p.physicsId)) next = { ...next, physicsId: null };
      return next;
    });

  const bindings = model.bindings.filter((b) => {
    if (b.target.type === 'part') return !removed.has(b.target.id);
    if (b.target.type === 'mesh') return !removedMeshes.has(b.target.id);
    return !removedWarps.has(b.target.id);
  });

  const nextModel: Model = {
    ...model,
    parts,
    meshes: model.meshes.filter((m) => !removedMeshes.has(m.id)),
    warps: model.warps.filter((w) => !removedWarps.has(w.id)),
    drawOrder: model.drawOrder.filter((id) => !removed.has(id)),
    bindings,
    ...(model.curveGuides
      ? {
          curveGuides: model.curveGuides
            .filter((g) => !removed.has(g.partId) && !removedMeshes.has(g.meshId))
            .map((g) =>
              g.collision?.colliderIds.some((id) => removedColliders.has(id))
                ? {
                    ...g,
                    collision: {
                      ...g.collision,
                      colliderIds: g.collision.colliderIds.filter((id) => !removedColliders.has(id)),
                    },
                  }
                : g,
            ),
        }
      : {}),
    ...(model.shoulderColliders
      ? { shoulderColliders: model.shoulderColliders.filter((c) => !removedColliders.has(c.id)) }
      : {}),
    // 輪郭線（I-068）: 消したパーツの線を消し、一緒に動かすパーツから消したパーツを外す
    ...(model.contourLines
      ? {
          contourLines: model.contourLines
            .filter((l) => !removed.has(l.partId))
            .map((l) =>
              l.withPartIds.some((id) => removed.has(id))
                ? { ...l, withPartIds: l.withPartIds.filter((id) => !removed.has(id)) }
                : l,
            ),
        }
      : {}),
  };
  return {
    ...project,
    model: nextModel,
    physics: removedPhysics.size > 0 ? project.physics.filter((ph) => !removedPhysics.has(ph.id)) : project.physics,
  };
}

// コマンドの中で使う id の列。同じ順に呼べば同じ id を返すので、apply を何度呼んでも結果が同じになる
export function idSequence(create: () => string = newId): () => () => string {
  const pool: string[] = [];
  return () => {
    let i = 0;
    return () => (pool[i++] ??= create());
  };
}

// パーツの初期値（kind・id・name 以外）
export function basePart(fields: Pick<Part, 'id' | 'name' | 'kind'> & Partial<Part>): Part {
  return {
    standardType: null,
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
    ...fields,
  };
}
