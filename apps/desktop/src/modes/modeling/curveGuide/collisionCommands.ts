import type { HairCollisionSettings, Model, ShoulderCollider } from '@app/schema';
import type { Command } from '@app/contracts';
import { curveMeshSignature, shoulderHostReason } from '@app/core';
import { isLockedDeep } from '../canvas/parts';

export const DEFAULT_HAIR_COLLISION: HairCollisionSettings = { enabled: false, colliderIds: [], thickness: 1 };
export function collisionGuideCommand(id: string, patch: Partial<HairCollisionSettings>): Command {
  return {
    label: '肩との衝突の設定',
    apply(project) {
      const guide = project.model.curveGuides?.find((g) => g.id === id);
      if (!guide || isLockedDeep(project.model, guide.partId)) return project;
      const collision = { ...(guide.collision ?? DEFAULT_HAIR_COLLISION), ...patch };
      if (
        !Number.isFinite(collision.thickness) ||
        collision.thickness < 0.5 ||
        collision.thickness > 2 ||
        new Set(collision.colliderIds).size !== collision.colliderIds.length ||
        collision.colliderIds.some((id) => !project.model.shoulderColliders?.some((c) => c.id === id))
      )
        return project;
      if (JSON.stringify(collision) === JSON.stringify(guide.collision ?? DEFAULT_HAIR_COLLISION)) return project;
      return {
        ...project,
        model: {
          ...project.model,
          curveGuides: project.model.curveGuides!.map((g) => (g.id === id ? { ...g, collision } : g)),
        },
      };
    },
  };
}
export function editableCollider(model: Model, collider: ShoulderCollider) {
  const mesh = model.meshes.find((m) => m.id === collider.meshId);
  return (
    !shoulderHostReason({ model }, collider.partId) &&
    !isLockedDeep(model, collider.partId) &&
    model.parts.some((p) => p.id === collider.partId && p.meshId === collider.meshId) &&
    !!mesh &&
    curveMeshSignature(mesh) === collider.meshSignature
  );
}
export function setColliderCommand(collider: ShoulderCollider, guideId: string): Command {
  return {
    label: '肩の線を描く',
    apply(project) {
      if (!editableCollider(project.model, collider)) return project;
      const guide = project.model.curveGuides?.find((g) => g.id === guideId);
      if (!guide || isLockedDeep(project.model, guide.partId) || collider.partId === guide.partId) return project;
      const collision = guide.collision ?? DEFAULT_HAIR_COLLISION;
      return {
        ...project,
        model: {
          ...project.model,
          shoulderColliders: [...(project.model.shoulderColliders ?? []).filter((c) => c.id !== collider.id), collider],
          curveGuides: project.model.curveGuides!.map((g) =>
            g.id === guideId
              ? {
                  ...g,
                  collision: { ...collision, colliderIds: [...new Set([...collision.colliderIds, collider.id])] },
                }
              : g,
          ),
        },
      };
    },
  };
}
export function patchColliderCommand(
  id: string,
  patch: Partial<Pick<ShoulderCollider, 'name' | 'points' | 'radius' | 'enabled'>>,
): Command {
  return {
    label: '肩の線の編集',
    apply(project) {
      const collider = project.model.shoulderColliders?.find((c) => c.id === id);
      if (!collider || isLockedDeep(project.model, collider.partId)) return project;
      if (patch.points && !editableCollider(project.model, collider)) return project;
      const next = { ...collider, ...patch };
      if (
        !Number.isFinite(next.radius) ||
        next.radius <= 0 ||
        next.points.length < 2 ||
        next.points.length > 8 ||
        next.points.some((p) => !Number.isFinite(p.x + p.y)) ||
        next.points.slice(1).some((p, i) => Math.hypot(p.x - next.points[i]!.x, p.y - next.points[i]!.y) < 1e-6)
      )
        return project;
      if (JSON.stringify(next) === JSON.stringify(collider)) return project;
      return {
        ...project,
        model: {
          ...project.model,
          shoulderColliders: project.model.shoulderColliders!.map((c) => (c.id === id ? next : c)),
        },
      };
    },
  };
}
export function removeColliderCommand(id: string): Command {
  return {
    label: '肩の線を削除',
    apply(project) {
      const collider = project.model.shoulderColliders?.find((c) => c.id === id);
      if (!collider || isLockedDeep(project.model, collider.partId)) return project;
      return {
        ...project,
        model: {
          ...project.model,
          shoulderColliders: project.model.shoulderColliders!.filter((c) => c.id !== id),
          curveGuides: project.model.curveGuides?.map((g) =>
            g.collision?.colliderIds.includes(id)
              ? {
                  ...g,
                  collision: { ...g.collision, colliderIds: g.collision.colliderIds.filter((key) => key !== id) },
                }
              : g,
          ),
        },
      };
    },
  };
}
