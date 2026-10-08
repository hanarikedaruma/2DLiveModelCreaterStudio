// パーツ構造・描画順・マスクのコマンド（純粋関数）。親子（parentId と兄弟の順）と描画順（drawOrder）は別々に変える
import {
  curveMeshSignature,
  modelCommand,
  patchPart,
  bounceBinding,
  bounceFrame,
  createBindingEvaluator,
} from '@app/core';
import type { Binding, CurveGuide, Mesh, Model, Part, Physics, Project, ShoulderCollider, Vec2 } from '@app/schema';
import type { Command } from '@app/contracts';
import { basePart, childrenOf, idSequence, isInside, partsCenter, removeParts, subtreeIds, topMost } from './modelOps';

// ---- 親子と兄弟の順 ----

// 木の中の置き場所。beforeId の兄弟の前に入れる（null なら末尾）
export interface TreeTarget {
  parentId: string | null;
  beforeId: string | null;
}

// 胸は呼吸の変換も引き継ぐため、胴体の画像を親にできる。自身や子孫の下には動かせない。
export function canMoveTo(model: Model, ids: readonly string[], parentId: string | null): boolean {
  if (parentId === null) return true;
  const parent = model.parts.find((p) => p.id === parentId);
  if (!parent) return false;
  if (
    parent.kind !== 'group' &&
    !(
      parent.standardType === 'torso' &&
      topMost(model, ids).every((id) => {
        const part = model.parts.find((p) => p.id === id);
        return (
          part?.standardType === 'chest' ||
          model.bindings.some((b) => b.target.id === part?.meshId && b.vertexSpace === 'model')
        );
      })
    )
  )
    return false;
  return !topMost(model, ids).some((id) => isInside(model, parentId, id));
}

// 行に落としたときの置き場所。into はグループの中の末尾、before / after はその行の兄弟として前 / 後ろ
export function treeTargetFor(
  model: Model,
  movingIds: readonly string[],
  overId: string,
  zone: 'before' | 'into' | 'after',
): TreeTarget | null {
  const over = model.parts.find((p) => p.id === overId);
  if (!over || subtreeIds(model, movingIds).has(overId)) return null;
  let target: TreeTarget;
  if (zone === 'into') {
    target = { parentId: over.id, beforeId: null };
  } else {
    const parentId = over.parentId !== null && model.parts.some((p) => p.id === over.parentId) ? over.parentId : null;
    if (zone === 'before') {
      target = { parentId, beforeId: over.id };
    } else {
      const moving = new Set(movingIds);
      const siblings = childrenOf(model, parentId).filter((p) => !moving.has(p.id));
      const next = siblings[siblings.indexOf(over) + 1];
      target = { parentId, beforeId: next?.id ?? null };
    }
  }
  return canMoveTo(model, movingIds, target.parentId) ? target : null;
}

// 親の変更と兄弟の並び替え。drawOrder は変えない
export function moveParts(ids: readonly string[], target: TreeTarget): Command {
  return modelCommand('パーツの移動', (model) => {
    const moving = topMost(model, ids);
    if (moving.length === 0 || !canMoveTo(model, moving, target.parentId)) return model;
    const set = new Set(moving);
    if (target.beforeId !== null && set.has(target.beforeId)) return model;
    const rest = model.parts.filter((p) => !set.has(p.id));
    const moved = model.parts
      .filter((p) => set.has(p.id))
      .map((p) => (p.parentId === target.parentId ? p : { ...p, parentId: target.parentId }));
    const at = target.beforeId === null ? -1 : rest.findIndex((p) => p.id === target.beforeId);
    const index = at < 0 ? rest.length : at;
    const parts = [...rest.slice(0, index), ...moved, ...rest.slice(index)];
    if (parts.every((p, i) => p === model.parts[i])) return model;
    return { ...model, parts };
  });
}

// グループ化。親がみな同じならその下に、違えば根に作る。drawOrder は変えない
export function groupParts(ids: readonly string[], options: { name?: string; newId?: () => string } = {}): Command {
  const seq = idSequence(options.newId);
  return {
    label: 'グループ化',
    apply(project) {
      const { model } = project;
      const moving = topMost(model, ids);
      if (moving.length === 0) return project;
      const groupId = seq()();
      const set = new Set(moving);
      const members = model.parts.filter((p) => set.has(p.id));
      const first = members[0]!;
      const parentId = members.every((p) => p.parentId === first.parentId) ? first.parentId : null;
      const group = basePart({
        id: groupId,
        name: options.name ?? 'グループ',
        kind: 'group',
        parentId,
        pivot: partsCenter(project, moving) ?? first.pivot,
      });
      const parts = model.parts.flatMap((p) => {
        const next = set.has(p.id) ? { ...p, parentId: groupId } : p;
        return p === first ? [group, next] : [next];
      });
      return { ...project, model: { ...model, parts } };
    },
  };
}

// ---- 描画順 ----

// moving（相対順のまま）を target のすぐ前面（front）か背面（back）へ動かす。変わらなければ同じ配列を返す
export function moveInDrawOrder(
  order: readonly string[],
  moving: readonly string[],
  targetId: string,
  place: 'front' | 'back',
): readonly string[] {
  const set = new Set(moving);
  if (set.has(targetId)) return order;
  const block = order.filter((id) => set.has(id));
  const rest = order.filter((id) => !set.has(id));
  const t = rest.indexOf(targetId);
  if (block.length === 0 || t < 0) return order;
  const at = place === 'front' ? t + 1 : t;
  const next = [...rest.slice(0, at), ...block, ...rest.slice(at)];
  return next.every((id, i) => id === order[i]) ? order : next;
}

export function reorderDrawOrder(moving: readonly string[], targetId: string, place: 'front' | 'back'): Command {
  return modelCommand('描画順の変更', (model) => {
    const drawOrder = moveInDrawOrder(model.drawOrder, moving, targetId, place);
    return drawOrder === model.drawOrder ? model : { ...model, drawOrder: [...drawOrder] };
  });
}

// ---- 表示・ロック・名前・削除・マスク ----

export const setPartVisible = (partId: string, visible: boolean) => patchPart('表示の切り替え', partId, { visible });
export const setPartLocked = (partId: string, locked: boolean) => patchPart('ロックの切り替え', partId, { locked });
export const renamePart = (partId: string, name: string) => patchPart('名前の変更', partId, { name });

// 子孫ごと消し、関係するバインディング・drawOrder・マスクの参照も消す
export function deleteParts(ids: readonly string[]): Command {
  return { label: '削除', apply: (project) => removeParts(project, ids) };
}

// マスク元にできるパーツ（画像パーツのみ。自身と子孫は除く）。前面から順
export function maskSourceOptions(model: Model, partId: string): Part[] {
  const excluded = subtreeIds(model, [partId]);
  const images = model.parts.filter((p) => p.kind === 'image' && !excluded.has(p.id));
  const rank = new Map(model.drawOrder.map((id, i) => [id, i]));
  return images
    .map((p, i) => ({ p, r: rank.get(p.id) ?? -1 - i }))
    .sort((a, b) => b.r - a.r)
    .map((x) => x.p);
}

// マスク元を1つにする。null は「なし」
export function setMask(partId: string, sourceId: string | null): Command {
  return modelCommand('マスクの設定', (model) => {
    const index = model.parts.findIndex((p) => p.id === partId);
    const part = model.parts[index];
    if (!part) return model;
    if (sourceId !== null && !maskSourceOptions(model, partId).some((p) => p.id === sourceId)) return model;
    const current = part.mask;
    if (sourceId === null && current === null) return model;
    if (sourceId !== null && current?.sourcePartIds.length === 1 && current.sourcePartIds[0] === sourceId) return model;
    const mask = sourceId === null ? null : { sourcePartIds: [sourceId], inverted: current?.inverted ?? false };
    const parts = model.parts.slice();
    parts[index] = { ...part, mask };
    return { ...model, parts };
  });
}

// ---- 複製（コピーと左右反転コピーで使う） ----

export interface DuplicateVariant {
  mirror?: boolean;
  part(original: Part, copy: Part, isRoot: boolean): Part;
  mesh(original: Mesh, copy: Mesh): Mesh;
  binding(copy: Binding): Binding; // target は差し替え済み
  assetId(id: string | null): string | null;
  guide?(copy: CurveGuide): CurveGuide;
  collider?(copy: ShoulderCollider): ShoulderCollider;
}

// パーツ（グループなら子孫ごと）を複製する。複製は元のすぐ後ろの兄弟に入れ、描画順は元のいちばん前面のすぐ前に足す。
// そのパーツ・メッシュを対象にするバインディングも複製する（ワープはまだ扱わない）
export function duplicateParts(
  project: Project,
  ids: readonly string[],
  next: () => string,
  variant: DuplicateVariant,
): Project {
  const { model } = project;
  const roots = topMost(model, ids);
  if (roots.length === 0) return project;
  const partIds = new Map<string, string>();
  const meshIds = new Map<string, string>();
  const meshes = new Map(model.meshes.map((m) => [m.id, m]));
  const subtrees = roots.map((root) => {
    const inside = subtreeIds(model, [root]);
    const list = model.parts.filter((p) => inside.has(p.id) && p.id !== root);
    return [model.parts.find((p) => p.id === root)!, ...list];
  });
  for (const list of subtrees) for (const p of list) partIds.set(p.id, next());
  for (const list of subtrees) {
    for (const p of list) if (p.meshId !== null && meshes.has(p.meshId)) meshIds.set(p.meshId, next());
  }

  const copyOf = (p: Part, isRoot: boolean): Part => {
    const copy: Part = {
      ...p,
      id: partIds.get(p.id)!,
      parentId: isRoot ? p.parentId : (partIds.get(p.parentId ?? '') ?? p.parentId),
      meshId: p.meshId !== null ? (meshIds.get(p.meshId) ?? null) : null,
      assetId: variant.assetId(p.assetId),
      mask: p.mask ? { ...p.mask, sourcePartIds: p.mask.sourcePartIds.map((id) => partIds.get(id) ?? id) } : null,
      physicsId: null,
    };
    return variant.part(p, copy, isRoot);
  };
  const copiesByRoot = new Map(subtrees.map((list) => [list[0]!.id, list.map((p, i) => copyOf(p, i === 0))]));
  const parts = model.parts.flatMap((p) => [p, ...(copiesByRoot.get(p.id) ?? [])]);

  const newMeshes: Mesh[] = [];
  for (const [oldId, newId] of meshIds) {
    const original = meshes.get(oldId)!;
    newMeshes.push(variant.mesh(original, { ...original, id: newId }));
  }

  let newBindings: Binding[] = [];
  const bindingIds = new Map<string, string>();
  for (const b of model.bindings) {
    const mapped =
      b.target.type === 'part'
        ? partIds.get(b.target.id)
        : b.target.type === 'mesh'
          ? meshIds.get(b.target.id)
          : undefined;
    if (mapped === undefined) continue;
    const id = next();
    bindingIds.set(b.id, id);
    newBindings.push(variant.binding({ ...b, id, target: { ...b.target, id: mapped } }));
  }

  const originals = model.drawOrder.filter((id) => partIds.has(id));
  const colliderIds = new Map<string, string>();
  const newColliders: ShoulderCollider[] = [];
  for (const c of model.shoulderColliders ?? []) {
    const partId = partIds.get(c.partId),
      meshId = meshIds.get(c.meshId);
    if (!partId || !meshId) continue;
    const id = next();
    colliderIds.set(c.id, id);
    let copy: ShoulderCollider = {
      ...c,
      id,
      partId,
      meshId,
      points: c.points.map((p) => ({ ...p })),
      meshSignature:
        c.meshSignature === curveMeshSignature(meshes.get(c.meshId)!)
          ? curveMeshSignature(newMeshes.find((m) => m.id === meshId)!)
          : c.meshSignature,
    };
    if (variant.collider) copy = variant.collider(copy);
    newColliders.push(copy);
  }
  const newGuides: CurveGuide[] = [];
  for (const g of model.curveGuides ?? []) {
    const partId = partIds.get(g.partId),
      meshId = meshIds.get(g.meshId);
    if (!partId || !meshId) continue;
    const mesh = newMeshes.find((m) => m.id === meshId)!;
    const originalMesh = meshes.get(g.meshId)!;
    let copy: CurveGuide = {
      ...g,
      id: next(),
      partId,
      meshId,
      reference: g.reference.map((p) => ({ ...p })) as CurveGuide['reference'],
      points: g.points.map((p) => ({ ...p })) as CurveGuide['points'],
      ...(g.dynamics ? { dynamics: { ...g.dynamics } } : {}),
      ...(g.collision
        ? { collision: { ...g.collision, colliderIds: g.collision.colliderIds.map((id) => colliderIds.get(id) ?? id) } }
        : {}),
      meshSignature: g.meshSignature === curveMeshSignature(originalMesh) ? curveMeshSignature(mesh) : g.meshSignature,
    };
    if (variant.guide) copy = variant.guide(copy);
    newGuides.push(copy);
  }
  let drawOrder = model.drawOrder;
  if (originals.length > 0) {
    const last = model.drawOrder.indexOf(originals.at(-1)!);
    const copies = originals.map((id) => partIds.get(id)!);
    drawOrder = [...model.drawOrder.slice(0, last + 1), ...copies, ...model.drawOrder.slice(last + 1)];
  }

  const newPhysics: Physics[] = [];
  const newParameters: Model['parameters'] = [];
  for (const old of project.physics.filter((p) => p.deform === 'bounce' && partIds.has(p.partId) && p.bounce)) {
    if (
      variant.mirror &&
      model.bindings.some(
        (b) =>
          old.bounce!.bindingIds.includes(b.id) &&
          b.keys.some((k) => k.locked || (k.source !== 'auto' && k.source !== 'generated')),
      )
    )
      throw new Error('手編集・ロックした胸のキーは左右反転で作り直せません。');
    const partId = partIds.get(old.partId)!,
      meshId = meshIds.get(old.bounce!.meshId),
      mesh = newMeshes.find((m) => m.id === meshId);
    if (!mesh || !meshId) continue;
    const outputs = [old.outputParameterId, old.verticalOutputParameterId].map((id, axis) => {
      const parameter = model.parameters.find((p) => p.id === id);
      if (!parameter) return null;
      const newId = next();
      newParameters.push({
        ...parameter,
        id: newId,
        standard: false,
        name: `胸 ${parts.find((p) => p.id === partId)!.name} ${axis === 0 ? '左右' : '上下'}`,
      });
      return newId;
    });
    if (!outputs[0] || !outputs[1]) continue;
    const outputMap = new Map([
      [old.outputParameterId, outputs[0]],
      [old.verticalOutputParameterId!, outputs[1]],
    ]);
    newBindings = newBindings.map((b) => ({ ...b, parameterIds: b.parameterIds.map((id) => outputMap.get(id) ?? id) }));
    const original = meshes.get(old.bounce!.meshId)!;
    const centerIndex = original.vertices.findIndex(
      (p) => p.x === old.bounce!.referenceCenter.x && p.y === old.bounce!.referenceCenter.y,
    );
    const b = {
      ...old.bounce!,
      weights: [...old.bounce!.weights],
      bindingIds: old.bounce!.bindingIds.map((id) => bindingIds.get(id) ?? next()) as [string, string],
      meshId,
      referenceCenter: { ...(mesh.vertices[centerIndex] ?? old.bounce!.referenceCenter) },
      referenceBasis: old.bounce!.referenceBasis.map((p) => ({ ...p })) as [Vec2, Vec2],
      meshSignature:
        old.bounce!.meshSignature === curveMeshSignature(original)
          ? curveMeshSignature(mesh)
          : old.bounce!.meshSignature,
    };
    const physics: Physics = {
      ...old,
      id: next(),
      partId,
      outputParameterId: outputs[0],
      verticalOutputParameterId: outputs[1],
      inputs: old.inputs.map((i) => ({ ...i })),
      bounce: b,
    };
    newPhysics.push(physics);
    if (variant.mirror && old.bounce!.meshSignature === curveMeshSignature(original))
      newBindings = newBindings.map((binding) => {
        const axis = b.bindingIds.indexOf(binding.id);
        if (axis < 0) return binding;
        return bounceBinding(
          binding.id,
          meshId,
          outputs[axis]!,
          b.weights,
          b.amplitudes[axis === 0 ? 'x' : 'y'],
          axis === 0 ? 'x' : 'y',
        );
      });
  }
  const result: Project = {
    ...project,
    physics: newPhysics.length ? [...project.physics, ...newPhysics] : project.physics,
    model: {
      ...model,
      parts: parts.map((p) => {
        const item = newPhysics.find((item) => item.partId === p.id);
        return item ? { ...p, physicsId: item.id } : p;
      }),
      parameters: newParameters.length ? [...model.parameters, ...newParameters] : model.parameters,
      meshes: [...model.meshes, ...newMeshes],
      bindings: [...model.bindings, ...newBindings],
      ...(model.curveGuides ? { curveGuides: [...model.curveGuides, ...newGuides] } : {}),
      ...(model.shoulderColliders ? { shoulderColliders: [...model.shoulderColliders, ...newColliders] } : {}),
      drawOrder,
    },
  };
  const evaluator = createBindingEvaluator();
  const excluded = new Set(newPhysics.flatMap((p) => p.bounce!.bindingIds));
  const deltas = evaluator.evaluate(
    { ...result.model, bindings: result.model.bindings.filter((b) => !excluded.has(b.id)) },
    {},
  );
  for (const item of newPhysics) {
    const frame = bounceFrame(result, item, deltas);
    if (frame) item.bounce!.referenceBasis = frame.basis;
  }
  return result;
}

// コピー。複製は standardType を持たない（標準パーツの枠を重ねない）
export function copyParts(ids: readonly string[], options: { newId?: () => string } = {}): Command {
  const seq = idSequence(options.newId);
  return {
    label: 'コピー',
    apply: (project) =>
      duplicateParts(project, ids, seq(), {
        part: (original, copy, isRoot) => ({
          ...copy,
          standardType: null,
          name: isRoot ? `${original.name}のコピー` : copy.name,
        }),
        mesh: (_original, copy) => copy,
        binding: (copy) => copy,
        assetId: (id) => id,
      }),
  };
}

// 操作のあとに増えた根のパーツ（複製したものを選ぶのに使う）
export function addedRootIds(before: Model, after: Model): string[] {
  const had = new Set(before.parts.map((p) => p.id));
  const added = after.parts.filter((p) => !had.has(p.id));
  const addedIds = new Set(added.map((p) => p.id));
  return added.filter((p) => p.parentId === null || !addedIds.has(p.parentId)).map((p) => p.id);
}
