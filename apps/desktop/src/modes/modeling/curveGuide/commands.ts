import type { CurveGuide, CurveGuideDynamics, Model, Project } from '@app/schema';
import type { Command, EditorState } from '@app/contracts';
import { axisOutputsFor, curveMeshSignature } from '@app/core';
import { isLockedDeep } from '../canvas/parts';

export const guideOfPart = (model: Model, partId: string): CurveGuide | undefined =>
  model.curveGuides?.find((g) => g.partId === partId);

export function curveBakeEditor(project: Project, editor: EditorState, partId: string): EditorState {
  const axes = new Set(axisOutputsFor(project, partId));
  return {
    ...editor,
    editorParamValues: Object.fromEntries(Object.entries(editor.editorParamValues).filter(([id]) => !axes.has(id))),
  };
}

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
  patch: Partial<Pick<CurveGuide, 'points' | 'radius' | 'rootFraction' | 'enabled' | 'gravity' | 'dynamics'>>,
): Command {
  return {
    label: '流れ線の編集',
    apply(project) {
      const guide = project.model.curveGuides?.find((g) => g.id === id);
      if (!guide || !editableGuide(project.model, guide)) return project;
      if (Object.entries(patch).every(([key, value]) => Object.is(guide[key as keyof CurveGuide], value)))
        return project;
      const updated = { ...guide, ...patch };
      return {
        ...project,
        model: {
          ...project.model,
          curveGuides: project.model.curveGuides!.map((g) => (g.id === guide.id ? updated : g)),
        },
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
      return patchGuideCommand(id, { gravity, enabled: true }).apply(project);
    },
  };
}

export const DEFAULT_FLOW_DYNAMICS: CurveGuideDynamics = {
  enabled: false,
  preset: 'normal',
  strength: 0.5,
  damping: 0.2,
};
export function dynamicsGuideCommand(id: string, patch: Partial<CurveGuideDynamics>): Command {
  return {
    label: '流れ揺れの設定',
    apply(project) {
      const guide = project.model.curveGuides?.find((g) => g.id === id);
      if (!guide || isLockedDeep(project.model, guide.partId)) return project;
      const next = { ...(guide.dynamics ?? DEFAULT_FLOW_DYNAMICS), ...patch };
      if (next.enabled && !editableGuide(project.model, guide)) return project;
      if (
        !Number.isFinite(next.strength + next.damping) ||
        next.strength < 0 ||
        next.strength > 1 ||
        next.damping < 0 ||
        next.damping > 1
      )
        return project;
      if (JSON.stringify(next) === JSON.stringify(guide.dynamics ?? DEFAULT_FLOW_DYNAMICS)) return project;
      return {
        ...project,
        model: {
          ...project.model,
          curveGuides: project.model.curveGuides!.map((g) => (g.id === id ? { ...g, dynamics: next } : g)),
        },
      };
    },
  };
}
