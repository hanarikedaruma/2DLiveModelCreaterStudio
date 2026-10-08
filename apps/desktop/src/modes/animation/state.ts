// アニメーション画面の表示の状態（カード46）。選んでいるアニメーション・時刻・プレビューの再生・選んだキーフレーム。
// プロジェクトには入れない（Undo の対象にしない）。左・中央・右の部品で同じものを使う
import { useSyncExternalStore } from 'react';
import type { Animation, Project } from '@app/schema';
import { sameTime } from './keyframes';

export type Playback = 'stopped' | 'once' | 'loop';

export interface AnimationEditorState {
  seekRevision?: number; // 手動シーク。連続再生の刻みでは増やさない
  animationId: string | null; // 選んでいるアニメーション（無ければ一覧の先頭）
  time: number; // 秒
  playback: Playback; // プレビューの再生
  selectedKey: { parameterId: string; time: number } | null;
}

export interface AnimationEditorStore {
  get(): AnimationEditorState;
  set(patch: Partial<AnimationEditorState>): void;
  advance(time: number): void;
  subscribe(listener: () => void): () => void;
  reset(): void;
}

function initialState(): AnimationEditorState {
  return { animationId: null, time: 0, playback: 'stopped', selectedKey: null };
}

export function createAnimationEditorStore(): AnimationEditorStore {
  let state = initialState();
  const listeners = new Set<() => void>();
  const emit = () => {
    for (const l of [...listeners]) l();
  };
  return {
    get: () => state,
    set(patch) {
      const keys = Object.keys(patch) as (keyof AnimationEditorState)[];
      if (keys.every((k) => Object.is(state[k], patch[k]))) return;
      state = { ...state, ...patch, ...('time' in patch ? { seekRevision: (state.seekRevision ?? 0) + 1 } : {}) };
      emit();
    },
    advance(time) {
      if (time === state.time) return;
      state = { ...state, time };
      emit();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    reset() {
      state = initialState();
      emit();
    },
  };
}

export const animationEditor = createAnimationEditorStore();

export function useAnimationEditor(): [AnimationEditorState, (patch: Partial<AnimationEditorState>) => void] {
  const state = useSyncExternalStore(animationEditor.subscribe, animationEditor.get);
  return [state, animationEditor.set];
}

// 選んでいるアニメーション。消えていたら一覧の先頭、無ければ null
export function selectedAnimation(project: Project, state: AnimationEditorState): Animation | null {
  return project.animations.find((a) => a.id === state.animationId) ?? project.animations[0] ?? null;
}

// 選んだキーフレームが今のアニメーションにあれば、その場所
export function selectedKeyframe(
  animation: Animation | null,
  state: AnimationEditorState,
): { parameterId: string; time: number } | null {
  const sel = state.selectedKey;
  if (!animation || !sel) return null;
  const track = animation.tracks.find((t) => t.parameterId === sel.parameterId);
  const key = track?.keyframes.find((k) => sameTime(k.time, sel.time));
  return key ? { parameterId: sel.parameterId, time: key.time } : null;
}

// プレビューの再生で時刻を dt 秒（速度を掛けたもの）進める。ループでなければ終わりで止まる
export function advanceTime(
  time: number,
  dt: number,
  duration: number,
  loop: boolean,
): { time: number; ended: boolean } {
  const next = time + Math.max(0, dt);
  if (next < duration) return { time: next, ended: false };
  if (!loop || duration <= 0) return { time: duration, ended: true };
  return { time: next % duration, ended: false };
}
