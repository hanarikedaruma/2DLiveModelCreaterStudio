import { describe, expect, it } from 'vitest';
import { createEmptyProject, createEmptyScene, type Project } from '@app/schema';
import {
  activeScene,
  sceneBackground,
  sceneModelTransform,
  setBackgroundCommand,
  setModelTransformCommand,
} from './scene';

function withScenes(project: Project, names: string[], activeIndex: number | null): Project {
  const scenes = names.map((n) => createEmptyScene(n));
  return {
    ...project,
    studio: { ...project.studio, scenes, activeSceneId: activeIndex === null ? null : scenes[activeIndex]!.id },
  };
}

describe('使うシーン', () => {
  it('activeSceneId のシーン、無ければ scenes[0]、それも無ければ null', () => {
    const base = createEmptyProject('p');
    expect(activeScene(withScenes(base, ['A', 'B'], 1))?.name).toBe('B');
    expect(activeScene(withScenes(base, ['A', 'B'], null))?.name).toBe('A');
    const none = withScenes(base, [], null);
    expect(activeScene(none)).toBeNull();
    expect(sceneBackground(none)).toEqual({ type: 'transparent' });
    expect(sceneModelTransform(none)).toEqual({ position: { x: 0, y: 0 }, scale: 1 });
  });

  it('背景と配置を使っているシーンに保存する', () => {
    const project = withScenes(createEmptyProject('p'), ['A', 'B'], 1);
    const next = setBackgroundCommand({ type: 'color', color: '#00ff00' }).apply(project);
    expect(next.studio.scenes[1]!.background).toEqual({ type: 'color', color: '#00ff00' });
    expect(next.studio.scenes[0]!.background).toEqual({ type: 'transparent' });
    const moved = setModelTransformCommand({ position: { x: 5, y: 6 }, scale: 1.5 }).apply(next);
    expect(moved.studio.scenes[1]!.modelTransform).toEqual({ position: { x: 5, y: 6 }, scale: 1.5 });
    expect(project.studio.scenes[1]!.background).toEqual({ type: 'transparent' }); // 元は変えない
  });

  it('シーンが1つも無ければ作って、それを使うシーンにする', () => {
    const project = withScenes(createEmptyProject('p'), [], null);
    const command = setBackgroundCommand({ type: 'image', path: 'backgrounds/x.png' });
    const next = command.apply(project);
    expect(next.studio.scenes).toHaveLength(1);
    expect(next.studio.activeSceneId).toBe(next.studio.scenes[0]!.id);
    expect(next.studio.scenes[0]!.background).toEqual({ type: 'image', path: 'backgrounds/x.png' });
    // 同じコマンドは同じ結果（純粋）
    expect(command.apply(project)).toEqual(next);
  });

  it('値が同じなら同じ参照を返す（Undo の履歴に積まない）', () => {
    const project = withScenes(createEmptyProject('p'), ['A'], 0);
    expect(setBackgroundCommand({ type: 'transparent' }).apply(project)).toBe(project);
    expect(setModelTransformCommand({ position: { x: 0, y: 0 }, scale: 1 }).apply(project)).toBe(project);
    const green = setBackgroundCommand({ type: 'color', color: '#00FF00' }).apply(project);
    expect(setBackgroundCommand({ type: 'color', color: '#00ff00' }).apply(green)).toBe(green);
  });
});
