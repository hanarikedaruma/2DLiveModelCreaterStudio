import { describe, expect, it, vi } from 'vitest';
import { createEditorStore } from './editorStore';

describe('createEditorStore', () => {
  it('初期値', () => {
    expect(createEditorStore().get()).toEqual({
      mode: 'modeling',
      uiLevel: { modeling: 'easy', animation: 'easy', studio: 'easy' },
      selectedPartIds: [],
      activeParameterIds: [],
      editorParamValues: {},
    });
  });

  it('初期値を一部だけ上書きできる', () => {
    expect(createEditorStore({ mode: 'studio' }).get()).toMatchObject({ mode: 'studio', selectedPartIds: [] });
  });

  it('set で新しい状態にして通知する。同じ値なら何もしない', () => {
    const store = createEditorStore();
    const listener = vi.fn();
    const off = store.subscribe(listener);
    const before = store.get();
    store.set({ selectedPartIds: ['p1'] });
    expect(store.get()).not.toBe(before);
    expect(store.get().selectedPartIds).toEqual(['p1']);
    expect(before.selectedPartIds).toEqual([]);
    expect(listener).toHaveBeenCalledTimes(1);
    store.set({ mode: 'modeling' });
    expect(listener).toHaveBeenCalledTimes(1);
    off();
    store.set({ mode: 'studio' });
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
