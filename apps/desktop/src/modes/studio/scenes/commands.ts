// シーンの一覧を書き換えるコマンド（追加・複製・名前の変更・削除・並べ替え・切り替え・表情）。
// apply を純粋にするため、新しいシーン（id）は呼ぶ側で先に作って渡す
import { createEmptyScene, newId, type Project, type Scene } from '@app/schema';
import type { Command } from '@app/contracts';
import { activeScene, updateActiveScene } from '../scene';

function withStudio(p: Project, patch: Partial<Project['studio']>): Project {
  return { ...p, studio: { ...p.studio, ...patch } };
}

// まだ使っていない「シーン N」（N はシーンの数 + 1 から）
export function nextSceneName(scenes: readonly Scene[]): string {
  const names = new Set(scenes.map((s) => s.name));
  let n = scenes.length + 1;
  while (names.has(`シーン ${n}`)) n += 1;
  return `シーン ${n}`;
}

// 「元の名前 のコピー」。重なれば「元の名前 のコピー 2」…
export function copyName(name: string, scenes: readonly Scene[]): string {
  const names = new Set(scenes.map((s) => s.name));
  const base = `${name} のコピー`;
  if (!names.has(base)) return base;
  let n = 2;
  while (names.has(`${base} ${n}`)) n += 1;
  return `${base} ${n}`;
}

export function cloneScene(scene: Scene, id: string, name: string): Scene {
  return {
    ...scene,
    id,
    name,
    background: { ...scene.background },
    modelTransform: { position: { ...scene.modelTransform.position }, scale: scene.modelTransform.scale },
    expressionIds: [...scene.expressionIds],
    periodicAnimationIds: [...scene.periodicAnimationIds],
  };
}

// 新しいシーン（空）を作る。名前はプロジェクトの中で重ならないもの
export function newScene(project: Project): Scene {
  return createEmptyScene(nextSceneName(project.studio.scenes));
}

// 使うシーンを変える。無いシーン・いまのシーンなら何もしない
export function selectSceneCommand(sceneId: string): Command {
  return {
    label: 'シーンを切り替える',
    apply(p) {
      if (!p.studio.scenes.some((s) => s.id === sceneId) || activeScene(p)?.id === sceneId) return p;
      return withStudio(p, { activeSceneId: sceneId });
    },
  };
}

// 末尾に足して、そのシーンに切り替える
export function addSceneCommand(scene: Scene): Command {
  return {
    label: 'シーンを追加',
    apply(p) {
      if (p.studio.scenes.some((s) => s.id === scene.id)) return p;
      return withStudio(p, { scenes: [...p.studio.scenes, scene], activeSceneId: scene.id });
    },
  };
}

// 元のシーンのすぐ後ろに写しを置き、写しに切り替える
export function duplicateSceneCommand(sourceId: string, copyId: string = newId()): Command {
  return {
    label: 'シーンを複製',
    apply(p) {
      const { scenes } = p.studio;
      const i = scenes.findIndex((s) => s.id === sourceId);
      if (i < 0 || scenes.some((s) => s.id === copyId)) return p;
      const copy = cloneScene(scenes[i]!, copyId, copyName(scenes[i]!.name, scenes));
      return withStudio(p, {
        scenes: [...scenes.slice(0, i + 1), copy, ...scenes.slice(i + 1)],
        activeSceneId: copyId,
      });
    },
  };
}

// 前後の空白を除く。空・同じ名前なら何もしない
export function renameSceneCommand(sceneId: string, name: string): Command {
  const trimmed = name.trim();
  return {
    label: 'シーンの名前を変える',
    apply(p) {
      const scene = p.studio.scenes.find((s) => s.id === sceneId);
      if (!scene || trimmed === '' || scene.name === trimmed) return p;
      return withStudio(p, { scenes: p.studio.scenes.map((s) => (s.id === sceneId ? { ...s, name: trimmed } : s)) });
    },
  };
}

// 使っているシーンを消したら、すぐ後ろ（無ければすぐ前）のシーンに切り替える。全部消すと activeSceneId は null
export function removeSceneCommand(sceneId: string): Command {
  return {
    label: 'シーンを削除',
    apply(p) {
      const { scenes } = p.studio;
      const i = scenes.findIndex((s) => s.id === sceneId);
      if (i < 0) return p;
      const rest = scenes.filter((s) => s.id !== sceneId);
      const wasActive = activeScene(p)?.id === sceneId;
      const activeSceneId = wasActive ? ((rest[i] ?? rest[i - 1])?.id ?? null) : p.studio.activeSceneId;
      return withStudio(p, {
        scenes: rest,
        activeSceneId,
        hotkeys: p.studio.hotkeys.filter((h) => h.action !== 'scene' || h.targetId !== sceneId),
      });
    },
  };
}

// toIndex（0 から。範囲の外は端にする）へ動かす
export function moveSceneCommand(sceneId: string, toIndex: number): Command {
  return {
    label: 'シーンを並べ替える',
    apply(p) {
      const { scenes } = p.studio;
      const from = scenes.findIndex((s) => s.id === sceneId);
      const to = Math.max(0, Math.min(scenes.length - 1, Math.trunc(toIndex)));
      if (from < 0 || from === to) return p;
      const next = scenes.slice();
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved!);
      return withStudio(p, { scenes: next });
    },
  };
}

// 使っているシーンに切り替えたときに適用する表情。STEP1 の表情は1つだけなので [id] か []
export function setSceneExpressionCommand(expressionId: string | null): Command {
  const ids = expressionId === null ? [] : [expressionId];
  return updateActiveScene('シーンの表情を変える', (scene) =>
    scene.expressionIds.length === ids.length && scene.expressionIds.every((id, i) => id === ids[i])
      ? scene
      : { ...scene, expressionIds: ids },
  );
}

// シーンに切り替えたときに適用する表情（expressionIds のうち、プロジェクトにある先頭のもの）。無ければ null
export function sceneExpressionId(project: Project, scene: Scene | null): string | null {
  if (!scene) return null;
  return scene.expressionIds.find((id) => project.expressions.some((e) => e.id === id)) ?? null;
}
