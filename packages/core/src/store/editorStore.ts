import type { EditorState, EditorStore } from '@app/contracts';

export function defaultEditorState(): EditorState {
  return {
    mode: 'modeling',
    uiLevel: { modeling: 'easy', animation: 'easy', studio: 'easy' },
    selectedPartIds: [],
    activeParameterIds: [],
    editorParamValues: {},
  };
}

export function createEditorStore(initial?: Partial<EditorState>): EditorStore {
  let state: EditorState = { ...defaultEditorState(), ...initial };
  const listeners = new Set<(s: EditorState) => void>();
  return {
    get: () => state,
    set(patch) {
      const keys = Object.keys(patch) as (keyof EditorState)[];
      if (keys.every((k) => Object.is(state[k], patch[k]))) return;
      state = { ...state, ...patch };
      for (const l of [...listeners]) l(state);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
