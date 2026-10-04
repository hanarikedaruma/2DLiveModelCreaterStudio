import { createEmptyProject, type Part, type Project } from '@app/schema';
import type { Command } from '@app/contracts';
import { describe, expect, it, vi } from 'vitest';
import { HISTORY_LIMIT, createProjectStore, modelCommand, patchPart } from './projectStore';

const rename = (name: string): Command => ({ label: `名前を ${name} に`, apply: (p) => ({ ...p, name }) });
const noop: Command = { label: '何もしない', apply: (p) => p };

function part(id: string): Part {
  return {
    id,
    name: id,
    kind: 'image',
    standardType: null,
    assetId: null,
    meshId: null,
    parentId: null,
    position: { x: 0, y: 0 },
    rotation: 0,
    scale: { x: 1, y: 1 },
    pivot: { x: 0, y: 0 },
    opacity: 1,
    blendMode: 'normal',
    depth: 0,
    mask: null,
    physicsId: null,
    visible: true,
    locked: false,
  };
}

function projectWithParts(): Project {
  const p = createEmptyProject('t');
  return { ...p, model: { ...p.model, parts: [part('a'), part('b')] } };
}

describe('createProjectStore', () => {
  it('dispatch → undo → redo で状態が行き来する', () => {
    const initial = createEmptyProject('最初');
    const store = createProjectStore(initial);
    expect(store.canUndo()).toBe(false);
    store.dispatch(rename('二番'));
    const second = store.get();
    expect(second.name).toBe('二番');
    expect(store.canUndo()).toBe(true);
    expect(store.undoLabel()).toBe('名前を 二番 に');
    store.undo();
    expect(store.get()).toBe(initial);
    expect(store.canRedo()).toBe(true);
    store.redo();
    expect(store.get()).toBe(second);
    expect(store.canRedo()).toBe(false);
  });

  it('結果が同じ参照なら何もしない（履歴も通知も増えない）', () => {
    const store = createProjectStore(createEmptyProject('t'));
    const listener = vi.fn();
    store.subscribe(listener);
    store.dispatch(noop);
    expect(store.canUndo()).toBe(false);
    expect(listener).not.toHaveBeenCalled();
  });

  it('変わるたびに同期で通知し、解除できる', () => {
    const store = createProjectStore(createEmptyProject('t'));
    const seen: string[] = [];
    const off = store.subscribe((p) => seen.push(p.name));
    store.dispatch(rename('a'));
    store.undo();
    store.redo();
    off();
    store.dispatch(rename('b'));
    expect(seen).toEqual(['a', 't', 'a']);
  });

  it('transaction が1回の Undo になる', () => {
    const initial = createEmptyProject('t');
    const store = createProjectStore(initial);
    store.transaction('まとめて', (dispatch) => {
      dispatch(rename('a'));
      dispatch(rename('b'));
      dispatch(rename('c'));
    });
    expect(store.get().name).toBe('c');
    expect(store.undoLabel()).toBe('まとめて');
    store.undo();
    expect(store.get()).toBe(initial);
    expect(store.canUndo()).toBe(false);
  });

  it('入れ子はいちばん外側にまとめる', () => {
    const initial = createEmptyProject('t');
    const store = createProjectStore(initial);
    store.transaction('外', (dispatch) => {
      dispatch(rename('a'));
      store.transaction('内', (inner) => inner(rename('b')));
      store.dispatch(rename('c'));
    });
    expect(store.undoLabel()).toBe('外');
    store.undo();
    expect(store.get()).toBe(initial);
    expect(store.canUndo()).toBe(false);
  });

  it('transaction の中で例外が出たら開始前の状態に戻し、例外を投げ直す', () => {
    const initial = createEmptyProject('t');
    const store = createProjectStore(initial);
    store.dispatch(rename('前'));
    const before = store.get();
    const error = new Error('失敗');
    expect(() =>
      store.transaction('失敗する', (dispatch) => {
        dispatch(rename('途中'));
        throw error;
      }),
    ).toThrow(error);
    expect(store.get()).toBe(before);
    expect(store.undoLabel()).toBe('名前を 前 に');
    // そのあともふつうに使える
    store.dispatch(rename('後'));
    store.undo();
    expect(store.get()).toBe(before);
  });

  it('入れ子の内側の例外を外側で受け止めたら、内側の分だけ戻す', () => {
    const store = createProjectStore(createEmptyProject('t'));
    store.transaction('外', (dispatch) => {
      dispatch(rename('a'));
      try {
        store.transaction('内', (inner) => {
          inner(rename('b'));
          throw new Error('内側');
        });
      } catch {
        // 受け止める
      }
    });
    expect(store.get().name).toBe('a');
    store.undo();
    expect(store.get().name).toBe('t');
  });

  it('何も変えなかった transaction は履歴に残さない', () => {
    const store = createProjectStore(createEmptyProject('t'));
    store.transaction('空', (dispatch) => dispatch(noop));
    expect(store.canUndo()).toBe(false);
  });

  it('新しい dispatch で redo が消える', () => {
    const store = createProjectStore(createEmptyProject('t'));
    store.dispatch(rename('a'));
    store.undo();
    expect(store.canRedo()).toBe(true);
    store.dispatch(rename('b'));
    expect(store.canRedo()).toBe(false);
    store.redo();
    expect(store.get().name).toBe('b');
  });

  it('履歴が200件を超えると古いものから消える', () => {
    const store = createProjectStore(createEmptyProject('0'));
    for (let i = 1; i <= HISTORY_LIMIT + 5; i++) store.dispatch(rename(String(i)));
    let undos = 0;
    while (store.canUndo()) {
      store.undo();
      undos++;
    }
    expect(HISTORY_LIMIT).toBe(200);
    expect(undos).toBe(200);
    expect(store.get().name).toBe('5');
  });

  it('load で履歴が消える', () => {
    const store = createProjectStore(createEmptyProject('t'));
    store.dispatch(rename('a'));
    store.dispatch(rename('b'));
    store.undo();
    const listener = vi.fn();
    store.subscribe(listener);
    const other = createEmptyProject('別');
    store.load(other);
    expect(store.get()).toBe(other);
    expect(store.canUndo()).toBe(false);
    expect(store.canRedo()).toBe(false);
    expect(listener).toHaveBeenCalledWith(other);
  });

  it('transaction の中では undo・load できない', () => {
    const store = createProjectStore(createEmptyProject('t'));
    expect(() => store.transaction('x', () => store.undo())).toThrow();
    expect(() => store.transaction('x', () => store.load(createEmptyProject('y')))).toThrow();
  });
});

describe('modelCommand・patchPart', () => {
  it('modelCommand はモデルだけを差し替え、同じ参照なら何もしない', () => {
    const p = projectWithParts();
    const cmd = modelCommand('描画順', (m) => ({ ...m, drawOrder: ['a'] }));
    const out = cmd.apply(p);
    expect(out.model.drawOrder).toEqual(['a']);
    expect(out.assets).toBe(p.assets);
    expect(modelCommand('なし', (m) => m).apply(p)).toBe(p);
  });

  it('patchPart は対象のパーツだけを書き換える', () => {
    const p = projectWithParts();
    const out = patchPart('移動', 'b', { position: { x: 3, y: 4 }, visible: false }).apply(p);
    expect(out.model.parts[1]).toMatchObject({ id: 'b', position: { x: 3, y: 4 }, visible: false });
    expect(out.model.parts[0]).toBe(p.model.parts[0]);
    expect(p.model.parts[1]!.visible).toBe(true);
  });

  it('patchPart は無いパーツや同じ値なら何もしない', () => {
    const p = projectWithParts();
    expect(patchPart('x', 'none', { visible: false }).apply(p)).toBe(p);
    expect(patchPart('x', 'a', { visible: true, name: 'a' }).apply(p)).toBe(p);
    const store = createProjectStore(p);
    store.dispatch(patchPart('x', 'a', { locked: false }));
    expect(store.canUndo()).toBe(false);
  });
});
