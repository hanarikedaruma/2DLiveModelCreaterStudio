// アニメーションの一覧と中身を書き換えるコマンド（カード46）。どれも1回の Undo。
// apply を純粋にするため、新しいアニメーション（id）は呼ぶ側で先に作って渡す
import { newId, type Animation, type Project } from '@app/schema';
import type { Command } from '@app/contracts';
import { DEFAULT_DURATION } from './keyframes';
import { createTransition } from './settings';

export function createAnimation(name: string, id: string = newId()): Animation {
  return {
    id,
    name,
    duration: DEFAULT_DURATION,
    speed: 1,
    loop: false,
    periodic: false,
    tracks: [],
    affectedGroups: [],
    restart: 'restart',
    transition: createTransition(),
  };
}

// まだ使っていない「アニメーション N」（N はアニメーションの数 + 1 から）
export function nextAnimationName(animations: readonly Animation[]): string {
  const names = new Set(animations.map((a) => a.name));
  let n = animations.length + 1;
  while (names.has(`アニメーション ${n}`)) n += 1;
  return `アニメーション ${n}`;
}

// 「元の名前 のコピー」。重なれば「元の名前 のコピー 2」…
export function copyAnimationName(name: string, animations: readonly Animation[]): string {
  const names = new Set(animations.map((a) => a.name));
  const base = `${name} のコピー`;
  if (!names.has(base)) return base;
  let n = 2;
  while (names.has(`${base} ${n}`)) n += 1;
  return `${base} ${n}`;
}

export function cloneAnimation(animation: Animation, id: string, name: string): Animation {
  return {
    ...animation,
    id,
    name,
    tracks: animation.tracks.map((t) => ({
      parameterId: t.parameterId,
      keyframes: t.keyframes.map((k) => ({ ...k })),
    })),
    affectedGroups: [...animation.affectedGroups],
    transition: { ...animation.transition },
  };
}

// 末尾に足す（同じ id があれば何もしない）
export function addAnimationCommand(animation: Animation): Command {
  return {
    label: 'アニメーションを追加',
    apply(p) {
      if (p.animations.some((a) => a.id === animation.id)) return p;
      return { ...p, animations: [...p.animations, animation] };
    },
  };
}

// 元のすぐ後ろに写しを置く
export function duplicateAnimationCommand(sourceId: string, copyId: string = newId()): Command {
  return {
    label: 'アニメーションを複製',
    apply(p) {
      const i = p.animations.findIndex((a) => a.id === sourceId);
      if (i < 0 || p.animations.some((a) => a.id === copyId)) return p;
      const source = p.animations[i]!;
      const copy = cloneAnimation(source, copyId, copyAnimationName(source.name, p.animations));
      return { ...p, animations: [...p.animations.slice(0, i + 1), copy, ...p.animations.slice(i + 1)] };
    },
  };
}

// 前後の空白を除く。空・同じ名前なら何もしない
export function renameAnimationCommand(animationId: string, name: string): Command {
  const trimmed = name.trim();
  return {
    label: 'アニメーションの名前を変える',
    apply(p) {
      const current = p.animations.find((a) => a.id === animationId);
      if (!current || trimmed === '' || current.name === trimmed) return p;
      return { ...p, animations: p.animations.map((a) => (a.id === animationId ? { ...a, name: trimmed } : a)) };
    },
  };
}

// 削除する。シーンの周期アニメーション（periodicAnimationIds）からも外す（Undo で戻る）。
// ホットキーの割り当ては残す（表情と同じく、対象が「見つからない」と出る）
export function removeAnimationCommand(animationId: string): Command {
  return {
    label: 'アニメーションを削除',
    apply(p) {
      if (!p.animations.some((a) => a.id === animationId)) return p;
      const uses = p.studio.scenes.some((s) => s.periodicAnimationIds.includes(animationId));
      const scenes = uses
        ? p.studio.scenes.map((s) =>
            s.periodicAnimationIds.includes(animationId)
              ? { ...s, periodicAnimationIds: s.periodicAnimationIds.filter((id) => id !== animationId) }
              : s,
          )
        : p.studio.scenes;
      return {
        ...p,
        animations: p.animations.filter((a) => a.id !== animationId),
        studio: uses ? { ...p.studio, scenes } : p.studio,
      };
    },
  };
}

// 1つのアニメーションを fn で書き換える（keyframes.ts・settings.ts の関数を渡す）。同じ参照が返れば何もしない
export function updateAnimationCommand(label: string, animationId: string, fn: (a: Animation) => Animation): Command {
  return {
    label,
    apply(p: Project) {
      const i = p.animations.findIndex((a) => a.id === animationId);
      if (i < 0) return p;
      const next = fn(p.animations[i]!);
      if (next === p.animations[i]) return p;
      const animations = p.animations.slice();
      animations[i] = next;
      return { ...p, animations };
    },
  };
}
