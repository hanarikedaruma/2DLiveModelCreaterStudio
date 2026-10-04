// 周期アニメーション（カード48）のコマンドと、標準の呼吸を作る処理。
// シーンで有効にする周期アニメーションは Scene.periodicAnimationIds、周期アニメーションかどうかは Animation.periodic
import type { Animation, Project, Scene } from '@app/schema';
import type { Command, ProjectStore } from '@app/contracts';
import { withStandardBreathAnimation } from '@app/core';
import { onAppEvent } from '../../../shell/api';
import { updateActiveScene } from '../scene';

export const PROJECT_LOADED_EVENT = 'projectLoaded'; // プロジェクトを開いた・新規に作った（project/actions.ts が出す）

// 周期アニメーション（periodic が true のもの。プロジェクトの順）
export function periodicAnimations(project: Project): Animation[] {
  return project.animations.filter((a) => a.periodic);
}

// シーンで有効にする周期アニメーション: periodicAnimationIds のうち、プロジェクトにある periodic のもの（重なりは除く）
export function scenePeriodicIds(project: Project, scene: Scene | null): string[] {
  if (!scene) return [];
  const out: string[] = [];
  for (const id of scene.periodicAnimationIds) {
    if (!out.includes(id) && project.animations.some((a) => a.id === id && a.periodic)) out.push(id);
  }
  return out;
}

// 使っているシーンで周期アニメーションを有効にする（末尾に足す）/ 外す。変わらなければ何もしない
export function setScenePeriodicCommand(animationId: string, on: boolean): Command {
  return updateActiveScene(on ? '周期アニメーションを有効にする' : '周期アニメーションを外す', (scene) => {
    const ids = scene.periodicAnimationIds;
    if (ids.includes(animationId) === on) return scene;
    return { ...scene, periodicAnimationIds: on ? [...ids, animationId] : ids.filter((id) => id !== animationId) };
  });
}

// アニメーションを周期アニメーションにする / やめる。シーンの periodicAnimationIds は残す（戻せばまた有効になる）
export function setAnimationPeriodicCommand(animationId: string, periodic: boolean): Command {
  return {
    label: periodic ? '周期アニメーションにする' : '周期アニメーションをやめる',
    apply(p) {
      const i = p.animations.findIndex((a) => a.id === animationId);
      if (i < 0 || p.animations[i]!.periodic === periodic) return p;
      const animations = p.animations.slice();
      animations[i] = { ...p.animations[i]!, periodic };
      return { ...p, animations };
    },
  };
}

// 標準の呼吸を作る（呼吸があれば何もしない）。1回の Undo
export function addStandardBreathCommand(): Command {
  return { label: '標準の呼吸を作る', apply: withStandardBreathAnimation };
}

// 呼吸が無ければ標準の呼吸を足す。開いた直後と同じく履歴に積まずに置き換えるので、
// 履歴を消さないよう、Undo / Redo が無いときだけ行う（あるときは足さずに false。画面の［標準の呼吸を作る］で作れる）。
// 足したら true
export function ensureStandardBreath(store: Pick<ProjectStore, 'get' | 'load' | 'canUndo' | 'canRedo'>): boolean {
  const current = store.get();
  const next = withStandardBreathAnimation(current);
  if (next === current || store.canUndo() || store.canRedo()) return false;
  store.load(next);
  return true;
}

// いまのプロジェクトと、以後 'projectLoaded' のたびに標準の呼吸を足す。戻り値で外す。
// 起動時から確実に作るには、registerProject（project/index.ts）で変更の有無の基準を作る前に呼ぶ（結合で使う）
export function connectStandardBreath(store: Pick<ProjectStore, 'get' | 'load' | 'canUndo' | 'canRedo'>): () => void {
  ensureStandardBreath(store);
  return onAppEvent(PROJECT_LOADED_EVENT, () => {
    ensureStandardBreath(store);
  });
}
