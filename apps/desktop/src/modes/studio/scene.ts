// スタジオで使うシーン（project.studio.activeSceneId のシーン。無ければ scenes[0]）と、それを書き換えるコマンド
import { createEmptyScene, type Project, type Scene } from '@app/schema';
import type { Command } from '@app/contracts';
import { DEFAULT_MODEL_TRANSFORM, sameTransform, type ModelTransform } from './placement';

export type SceneBackground = Scene['background'];

export function activeScene(project: Project): Scene | null {
  const { scenes, activeSceneId } = project.studio;
  return scenes.find((s) => s.id === activeSceneId) ?? scenes[0] ?? null;
}

export function sceneBackground(project: Project): SceneBackground {
  return activeScene(project)?.background ?? { type: 'transparent' };
}

export function sceneModelTransform(project: Project): ModelTransform {
  return activeScene(project)?.modelTransform ?? DEFAULT_MODEL_TRANSFORM;
}

// 使っているシーンを fn で書き換える。シーンが1つも無ければ作る。fn が同じ参照を返したら何もしない
export function updateActiveScene(label: string, fn: (scene: Scene) => Scene): Command {
  const fresh = createEmptyScene('シーン 1'); // apply を純粋にするため、作るシーンは先に用意しておく
  return {
    label,
    apply(project) {
      const current = activeScene(project);
      const scene = current ?? fresh;
      const next = fn(scene);
      if (current && next === current) return project;
      const scenes = current
        ? project.studio.scenes.map((s) => (s.id === current.id ? next : s))
        : [...project.studio.scenes, next];
      return { ...project, studio: { ...project.studio, scenes, activeSceneId: next.id } };
    },
  };
}

export function sameBackground(a: SceneBackground, b: SceneBackground): boolean {
  if (a.type !== b.type) return false;
  if (a.type === 'color' && b.type === 'color') return a.color.toLowerCase() === b.color.toLowerCase();
  if (a.type === 'image' && b.type === 'image') return a.path === b.path;
  return true;
}

export function setBackgroundCommand(background: SceneBackground): Command {
  return updateActiveScene('背景を変える', (scene) =>
    sameBackground(scene.background, background) ? scene : { ...scene, background },
  );
}

export function setModelTransformCommand(t: ModelTransform): Command {
  return updateActiveScene('モデルの配置を変える', (scene) =>
    sameTransform(scene.modelTransform, t)
      ? scene
      : { ...scene, modelTransform: { position: { ...t.position }, scale: t.scale } },
  );
}
