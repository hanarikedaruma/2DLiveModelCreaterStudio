import { describe, expect, it, vi } from 'vitest';
import { createEmptyProject, type Project } from '@app/schema';
import type { Command } from '@app/contracts';
import { createProjectStore } from '@app/core';
import { beginLiveEdit, NEEDS_KEY_MESSAGE, startKeyedDrag } from './liveEdit';

const rename = (name: string): Command => ({ label: '名前', apply: (p) => ({ ...p, name }) });
const renameBy =
  (suffix: string) =>
  (p: Project): Command =>
    rename(p.name + suffix);

function setup() {
  const store = createProjectStore(createEmptyProject('はじめ'));
  return { store };
}

describe('beginLiveEdit', () => {
  it('何度入れ直しても、ドラッグ開始の状態から作り直し、Undo は1回', () => {
    const { store } = setup();
    const live = beginLiveEdit(store, '名前の変更');
    live.update(renameBy('1'));
    live.update(renameBy('12'));
    live.update(renameBy('123'));
    live.commit();
    expect(store.get().name).toBe('はじめ123');
    store.undo();
    expect(store.get().name).toBe('はじめ');
    expect(store.canUndo()).toBe(false);
  });

  it('null を入れると開始の状態に戻る。cancel で入れた分を戻す', () => {
    const { store } = setup();
    const live = beginLiveEdit(store, '名前の変更');
    live.update(renameBy('x'));
    live.update(() => null);
    expect(store.get().name).toBe('はじめ');
    expect(store.canUndo()).toBe(false);
    live.update(renameBy('y'));
    live.cancel();
    expect(store.get().name).toBe('はじめ');
    expect(store.canUndo()).toBe(false);
    // 終わったあとは何もしない
    live.update(renameBy('z'));
    expect(store.get().name).toBe('はじめ');
  });

  it("'needsKey' なら何も入れない", () => {
    const { store } = setup();
    const live = beginLiveEdit(store, '名前の変更');
    live.update(renameBy('x'));
    expect(live.update(() => 'needsKey')).toBe('needsKey');
    expect(store.get().name).toBe('はじめ');
  });

  it('途中でほかの操作が入ったら、それを消さない', () => {
    const { store } = setup();
    const live = beginLiveEdit(store, '名前の変更');
    live.update(renameBy('x'));
    store.dispatch({ label: 'ほか', apply: (p) => ({ ...p, id: 'other' }) });
    live.update(renameBy('y'));
    live.commit();
    expect(store.get()).toMatchObject({ id: 'other', name: 'はじめxy' });
  });
});

function dialogs(answer: boolean) {
  return { confirm: vi.fn(async () => answer), notify: vi.fn() };
}

// キーが無ければ 'needsKey'。キーは名前の先頭の「鍵」で表す
const keyedEdit = (p: Project, suffix: string) => (p.name.startsWith('鍵') ? rename(p.name + suffix) : 'needsKey');
const addKey: Command = { label: 'キーの追加', apply: (p) => ({ ...p, name: '鍵' + p.name }) };

describe('startKeyedDrag', () => {
  it("'needsKey' なら確認し、承認されたらキーを足してから最新の変更で編集する（1回の Undo）", async () => {
    const { store } = setup();
    const d = dialogs(true);
    const drag = startKeyedDrag<string>({
      store,
      dialogs: d,
      label: '編集',
      edit: keyedEdit,
      addKeys: () => addKey,
    });
    drag.move('a');
    expect(drag.awaitingKey()).toBe(true);
    drag.move('ab'); // 確認の間の動きも覚えておく
    drag.release();
    await drag.settled();
    expect(d.confirm).toHaveBeenCalledWith(NEEDS_KEY_MESSAGE);
    expect(store.get().name).toBe('鍵はじめab');
    expect(drag.active()).toBe(false);
    store.undo();
    expect(store.get().name).toBe('はじめ');
    expect(store.canUndo()).toBe(false);
  });

  it('承認がボタンを離す前なら、そのあとの動きも続けて入る', async () => {
    const { store } = setup();
    const drag = startKeyedDrag<string>({
      store,
      dialogs: dialogs(true),
      label: '編集',
      edit: keyedEdit,
      addKeys: () => addKey,
    });
    drag.move('a');
    await drag.settled();
    expect(store.get().name).toBe('鍵はじめa');
    drag.move('abc');
    drag.release();
    expect(store.get().name).toBe('鍵はじめabc');
    store.undo();
    expect(store.get().name).toBe('はじめ');
  });

  it('断ったら何も変えない', async () => {
    const { store } = setup();
    const drag = startKeyedDrag<string>({
      store,
      dialogs: dialogs(false),
      label: '編集',
      edit: keyedEdit,
      addKeys: () => addKey,
    });
    drag.move('a');
    drag.release();
    await drag.settled();
    expect(store.get().name).toBe('はじめ');
    expect(store.canUndo()).toBe(false);
  });

  it('キーを足しても編集できなければ知らせて戻す', async () => {
    const { store } = setup();
    const d = dialogs(true);
    const drag = startKeyedDrag<string>({
      store,
      dialogs: d,
      label: '編集',
      edit: () => 'needsKey',
      addKeys: () => addKey,
    });
    drag.move('a');
    await drag.settled();
    expect(d.notify).toHaveBeenCalledWith('キーを追加できなかった');
    expect(store.get().name).toBe('はじめ');
  });
});
