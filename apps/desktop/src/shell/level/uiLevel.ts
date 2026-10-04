// かんたん/詳細（カード27）。状態は EditorState.uiLevel にモードごとに持ち、
// Environment.uiLevel（environment.json）との同期は Shell が行う
import { useCallback } from 'react';
import type { ModeId, UiLevel } from '@app/schema';
import type { EditorStore } from '@app/contracts';
import { useEditor, useServices } from '../api';

export const UI_LEVELS: { id: UiLevel; label: string }[] = [
  { id: 'easy', label: 'かんたん' },
  { id: 'detail', label: '詳細' },
];

// mode の uiLevel だけを変えた新しい Record を返す（ほかのモードはそのまま。変わらなければ同じオブジェクト）
export function withLevel(levels: Record<ModeId, UiLevel>, mode: ModeId, level: UiLevel): Record<ModeId, UiLevel> {
  if (levels[mode] === level) return levels;
  return { ...levels, [mode]: level };
}

// 今のモードの uiLevel だけを変える。プロジェクトの値には触れない（詳細でだけ変えられる値も消さず、表示を隠すだけ）
export function setCurrentLevel(editor: EditorStore, level: UiLevel): void {
  const state = editor.get();
  const next = withLevel(state.uiLevel, state.mode, level);
  if (next !== state.uiLevel) editor.set({ uiLevel: next });
}

// 今のモードの uiLevel と、それを変える関数
export function useUiLevel(): [UiLevel, (level: UiLevel) => void] {
  const { editor: store } = useServices();
  const [editor] = useEditor();
  const setLevel = useCallback((level: UiLevel) => setCurrentLevel(store, level), [store]);
  return [editor.uiLevel[editor.mode], setLevel];
}
