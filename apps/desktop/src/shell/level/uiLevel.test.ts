import { describe, expect, it } from 'vitest';
import type { ModeId, UiLevel } from '@app/schema';
import { createFakeServices } from '../../services';
import { setCurrentLevel, withLevel } from './uiLevel';

const allEasy: Record<ModeId, UiLevel> = { modeling: 'easy', animation: 'easy', studio: 'easy' };

describe('withLevel', () => {
  it('指定したモードだけを変えた新しいオブジェクトを返す', () => {
    const next = withLevel(allEasy, 'modeling', 'detail');
    expect(next).toEqual({ modeling: 'detail', animation: 'easy', studio: 'easy' });
    expect(next).not.toBe(allEasy);
    expect(allEasy.modeling).toBe('easy');
  });

  it('変わらなければ同じオブジェクトを返す', () => {
    expect(withLevel(allEasy, 'studio', 'easy')).toBe(allEasy);
  });
});

describe('setCurrentLevel', () => {
  it('今のモードの uiLevel だけを変え、ほかの EditorState は変えない', () => {
    const { editor } = createFakeServices();
    editor.set({ mode: 'studio', selectedPartIds: ['a'] });
    setCurrentLevel(editor, 'detail');
    expect(editor.get().uiLevel).toEqual({ modeling: 'easy', animation: 'easy', studio: 'detail' });
    expect(editor.get().mode).toBe('studio');
    expect(editor.get().selectedPartIds).toEqual(['a']);
  });

  it('同じ値なら知らせない', () => {
    const { editor } = createFakeServices();
    let calls = 0;
    editor.subscribe(() => calls++);
    setCurrentLevel(editor, 'easy');
    expect(calls).toBe(0);
    setCurrentLevel(editor, 'detail');
    expect(calls).toBe(1);
  });
});
