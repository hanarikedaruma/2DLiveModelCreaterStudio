// カード63のテスト担当 CO。右クリックのメニューから実際のパネル・ストアを通して確かめる。
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createKeyGenerator, createProjectStore } from '@app/core';
import type { Services } from '@app/contracts';
import { createFakeServices } from '../../../services';
import { createEnvironmentStore, memoryEnvironmentStorage } from '../../../shell/environment';
import { registry } from '../../../shell/registry';
import { Shell } from '../../../shell/Shell';
import { project63 } from './fixture.c63';
import { register } from './index';

beforeEach(() => {
  registry.reset();
  register();
});
afterEach(() => registry.reset());

function setup(locked = false) {
  const initial = project63(locked);
  const store = createProjectStore(initial);
  const services: Services = {
    ...createFakeServices(),
    store,
    keyGenerator: createKeyGenerator({ parameters: () => store.get().model.parameters }),
    createRenderer: () => ({ init() {}, setTextures() {}, render() {}, dispose() {} }),
  };
  render(<Shell services={services} environment={createEnvironmentStore(memoryEnvironmentStorage())} />);
  act(() => services.editor.set({ selectedPartIds: ['a'] }));
  fireEvent.click(screen.getByRole('button', { name: /^顔 左右/ }));
  const menu = (value: number, action: string) => {
    const mark = document.querySelector(`[data-parameter-id="FaceAngleX"] [data-value="${value}"]`)!;
    fireEvent.contextMenu(mark);
    fireEvent.click(
      within(screen.getByRole('group', { name: /^キー .* の操作$/ })).getByRole('button', { name: action }),
    );
  };
  const keys = () => store.get().model.bindings[0]!.keys;
  return { initial, store, menu, keys, services };
}

async function answer(button: 'OK' | 'キャンセル', input?: string) {
  const dialog = await screen.findByRole('dialog');
  if (input !== undefined) fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: input } });
  await act(async () => fireEvent.click(within(dialog).getByRole('button', { name: button })));
}

describe('カード63: 印のメニューのキー操作', () => {
  it('生成の対象を画面でも区別し、選んだパーツと全パーツそれぞれの結果を知らせる', () => {
    const { initial, store, services } = setup();
    fireEvent.click(screen.getByRole('button', { name: '間を生成' }));
    expect(store.get().model.bindings[0]).not.toBe(initial.model.bindings[0]);
    expect(store.get().model.bindings[1]).toBe(initial.model.bindings[1]);
    expect(screen.getByText('間を生成: 選んだパーツ（1 個）のバインディング 1 個に掛けた')).toBeTruthy();
    act(() => store.undo());
    act(() => services.editor.set({ selectedPartIds: [] }));
    fireEvent.click(screen.getByRole('button', { name: 'すべて再補間' }));
    expect(store.get().model.bindings.every((binding, index) => binding !== initial.model.bindings[index])).toBe(true);
    expect(screen.getByText('すべて再補間: すべてのパーツのバインディング 2 個に掛けた')).toBeTruthy();
  });

  it('選んだパーツの1つのキーを消し、ほかのキーとパーツを保ち、1回のUndoで戻す', () => {
    const { initial, store, menu, keys } = setup();
    menu(10, 'このキーを消す');
    expect(keys().map((k) => k.coords[0])).toEqual([-30, 0, 20, 30]);
    expect(store.get().model.bindings[0]!.keyValues).toEqual([[-30, 0, 20, 30]]);
    expect(keys()).toEqual(initial.model.bindings[0]!.keys.filter((k) => k.coords[0] !== 10));
    expect(store.get().model.bindings[1]).toBe(initial.model.bindings[1]);
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
    expect(store.get()).toBe(initial);
    expect(store.canUndo()).toBe(false);
  });

  it('ロックしたキーを消す前に確認し、取消なら変更せず、承認した削除はUndoで戻す', async () => {
    const { initial, store, menu, keys } = setup(true);
    menu(10, 'このキーを消す');
    expect((await screen.findByRole('dialog')).textContent).toContain('ロックしたキー 1 個');
    await answer('キャンセル');
    expect(store.get()).toBe(initial);
    expect(store.canUndo()).toBe(false);
    menu(10, 'このキーを消す');
    await answer('OK');
    await waitFor(() => expect(keys().some((k) => k.coords[0] === 10)).toBe(false));
    expect(store.get().model.bindings[1]).toBe(initial.model.bindings[1]);
    act(() => store.undo());
    expect(store.get()).toBe(initial);
  });

  it('キーを空いた値へ動かし、差分・ロック・手動の印を保持する。1回のUndoで戻る', async () => {
    const { initial, store, menu, keys } = setup(true);
    const moving = keys().find((k) => k.coords[0] === 10)!;
    menu(10, '別の値へ動かす…');
    await answer('OK', '15');
    await waitFor(() => expect(keys().find((k) => k.coords[0] === 15)).toEqual({ ...moving, coords: [15] }));
    expect(keys().some((k) => k.coords[0] === 10)).toBe(false);
    expect(store.get().model.bindings[0]!.keyValues).toEqual([[-30, 0, 15, 20, 30]]);
    expect(store.get().model.bindings[1]).toBe(initial.model.bindings[1]);
    act(() => store.undo());
    expect(store.get()).toBe(initial);
    expect(store.canUndo()).toBe(false);
  });

  it('動かす先にキーがあれば確認し、取消では両方を残し、承認すると選んだパーツだけ置き換える', async () => {
    const { initial, store, menu, keys } = setup();
    menu(10, '別の値へ動かす…');
    await answer('OK', '20');
    expect((await screen.findByRole('dialog')).textContent).toContain('置き換え');
    await answer('キャンセル');
    expect(store.get()).toBe(initial);
    expect(store.canUndo()).toBe(false);
    menu(10, '別の値へ動かす…');
    await answer('OK', '20');
    await answer('OK');
    await waitFor(() =>
      expect(keys().find((k) => k.coords[0] === 20)?.delta).toEqual(initial.model.bindings[0]!.keys[2]!.delta),
    );
    expect(keys().map((k) => k.coords[0])).toEqual([-30, 0, 20, 30]);
    expect(store.get().model.bindings[1]).toBe(initial.model.bindings[1]);
    act(() => store.undo());
    expect(store.get()).toBe(initial);
  });

  it('ロックのメニューは以前と同じく同じ値のキーをロック・解除し、操作ごとにUndoできる', () => {
    const { initial, store, menu } = setup();
    menu(10, 'ロックする');
    const locked = store.get();
    expect(locked.model.bindings.every((b) => b.keys.find((k) => k.coords[0] === 10)?.locked)).toBe(true);
    menu(10, 'ロックを解除');
    expect(store.get().model.bindings.every((b) => !b.keys.find((k) => k.coords[0] === 10)?.locked)).toBe(true);
    act(() => store.undo());
    expect(store.get()).toBe(locked);
    act(() => store.undo());
    expect(store.get()).toBe(initial);
  });
});
