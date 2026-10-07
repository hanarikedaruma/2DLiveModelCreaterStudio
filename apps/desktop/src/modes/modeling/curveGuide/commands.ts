import type { CurveGuide, Model, Project } from '@app/schema';
import type { Command } from '@app/contracts';
import { curveMeshSignature } from '@app/core';
import { isLockedDeep } from '../canvas/parts';
import { disablePhysicsCommand, physicsOfPart } from '../physics/commands';

export const guideOfPart = (model: Model, partId: string): CurveGuide | undefined =>
  model.curveGuides?.find((g) => g.partId === partId);

export function editableGuide(model: Model, guide: CurveGuide): boolean {
  const part = model.parts.find((p) => p.id === guide.partId);
  const mesh = model.meshes.find((m) => m.id === guide.meshId);
  return (
    !!part &&
    part.meshId === guide.meshId &&
    !!mesh &&
    !isLockedDeep(model, part.id) &&
    !model.parts.some((p) => p.parentId === part.id) &&
    curveMeshSignature(mesh) === guide.meshSignature
  );
}

export function setGuideCommand(guide: CurveGuide): Command {
  return {
    label: '流れ線を描く',
    apply(project) {
      if (!editableGuide(project.model, guide)) return project;
      return {
        ...project,
        model: {
          ...project.model,
          curveGuides: [...(project.model.curveGuides ?? []).filter((g) => g.partId !== guide.partId), guide],
        },
      };
    },
  };
}

export function patchGuideCommand(
  id: string,
  patch: Partial<Pick<CurveGuide, 'points' | 'radius' | 'rootFraction' | 'enabled' | 'gravity'>>,
): Command {
  return {
    label: '流れ線の編集',
    apply(project) {
      const guide = project.model.curveGuides?.find((g) => g.id === id);
      if (!guide || !editableGuide(project.model, guide)) return project;
      if (Object.entries(patch).every(([key, value]) => Object.is(guide[key as keyof CurveGuide], value)))
        return project;
      const updated = { ...guide, ...patch };
      const next =
        updated.enabled && updated.gravity && physicsOfPart(project, guide.partId)
          ? disablePhysicsCommand(guide.partId).apply(project)
          : project;
      return {
        ...next,
        model: { ...next.model, curveGuides: next.model.curveGuides!.map((g) => (g.id === guide.id ? updated : g)) },
      };
    },
  };
}

export function removeGuideCommand(id: string): Command {
  return {
    label: '流れ線を削除',
    apply(project) {
      const guide = project.model.curveGuides?.find((g) => g.id === id);
      if (!guide || isLockedDeep(project.model, guide.partId)) return project;
      return {
        ...project,
        model: { ...project.model, curveGuides: project.model.curveGuides!.filter((g) => g !== guide) },
      };
    },
  };
}

export function gravityGuideCommand(id: string, gravity: boolean): Command {
  return {
    label: gravity ? '髪を重力に沿わせる' : '髪の重力を解除',
    apply(project) {
      const guide = project.model.curveGuides?.find((g) => g.id === id);
      if (!guide || !editableGuide(project.model, guide)) return project;
      const next: Project =
        gravity && physicsOfPart(project, guide.partId) ? disablePhysicsCommand(guide.partId).apply(project) : project;
      return patchGuideCommand(id, { gravity, enabled: true }).apply(next);
    },
  };
}
