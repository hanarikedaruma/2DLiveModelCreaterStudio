import { act, fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { animationEditor } from './state';
import { sampleAnimationData, setupAnimationScreen, step1Project } from './testShell';

// 枠の入力ダイアログに答える
async function answerPrompt(text: string) {
  const dialog = await screen.findByRole('dialog');
  await act(async () => {
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: text } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'OK' }));
  });
}

const names = (list: ReturnType<typeof setupAnimationScreen>['list']) =>
  within(list().getByRole('list', { name: 'アニメーションの一覧' }))
    .getAllByRole('button')
    .map((b) => [b.getAttribute('aria-label'), b.getAttribute('aria-pressed')]);

describe('アニメーションの画面と一覧', () => {
  it('アニメーションのモードに、左の一覧・中央（プレビューとタイムライン）・右の登録の設定が出る', () => {
    const { center } = setupAnimationScreen();
    expect(document.querySelector('[data-area="left"] [data-panel-id="animation.list"]')).toBeTruthy();
    expect(document.querySelector('[data-area="right"] [data-panel-id="animation.settings"]')).toBeTruthy();
    expect(screen.getByTestId('animation-preview')).toBeTruthy();
    expect(center().getByRole('toolbar', { name: '再生' })).toBeTruthy();
    expect(center().getByText(/アニメーションがまだ無い/)).toBeTruthy();
  });

  it('モデリングのモードでは出ない', () => {
    const { editor } = setupAnimationScreen();
    act(() => editor.set({ mode: 'modeling' }));
    expect(document.querySelector('[data-panel-id="animation.list"]')).toBeNull();
    expect(document.querySelector('.anim-center')).toBeNull();
  });

  it('追加すると末尾に足して選ぶ。押すとそれを編集する。Undo で消える', () => {
    const { list, store, click, center } = setupAnimationScreen();
    click(list().getByRole('button', { name: '追加' }));
    click(list().getByRole('button', { name: '追加' }));
    expect(names(list)).toEqual([
      ['アニメーション 1', 'false'],
      ['アニメーション 2', 'true'],
    ]);
    expect(store.get().animations[1]).toMatchObject({ name: 'アニメーション 2', duration: 2, tracks: [] });
    expect(center().getByTestId('animation-time').textContent).toBe('0.00 / 2.00 秒');
    click(list().getByRole('button', { name: 'アニメーション 1' }));
    expect(animationEditor.get().animationId).toBe(store.get().animations[0]!.id);
    act(() => store.undo());
    expect(names(list)).toEqual([['アニメーション 1', 'true']]);
    act(() => store.undo());
    expect(list().getByText(/アニメーションがまだ無い/)).toBeTruthy();
  });

  it('名前の変更（ボタンとダブルクリック）。キャンセルなら変えない。Undo で戻る', async () => {
    const { list, store, click } = setupAnimationScreen(step1Project([sampleAnimationData()]));
    click(list().getByRole('button', { name: '名前の変更' }));
    await answerPrompt('  首ふり  ');
    expect(store.get().animations[0]!.name).toBe('首ふり');
    act(() => {
      fireEvent.doubleClick(list().getByRole('button', { name: '首ふり' }));
    });
    const dialog = await screen.findByRole('dialog');
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'キャンセル' }));
    });
    expect(store.get().animations[0]!.name).toBe('首ふり');
    act(() => store.undo());
    expect(store.get().animations[0]!.name).toBe('うなずき');
  });

  it('複製は元のすぐ後ろに中身ごと写して選ぶ。削除はすぐ後ろ（無ければ前）を選ぶ。それぞれ Undo で戻る', () => {
    const nod = sampleAnimationData('nod', 'うなずき');
    const shake = sampleAnimationData('shake', '首ふり');
    const { list, store, click } = setupAnimationScreen(step1Project([nod, shake]));
    click(list().getByRole('button', { name: 'うなずき' }));
    click(list().getByRole('button', { name: '複製' }));
    expect(names(list)).toEqual([
      ['うなずき', 'false'],
      ['うなずき のコピー', 'true'],
      ['首ふり', 'false'],
    ]);
    const copy = store.get().animations[1]!;
    expect(copy).toEqual({ ...nod, id: copy.id, name: 'うなずき のコピー' });
    expect(copy.id).not.toBe('nod');

    click(list().getByRole('button', { name: '削除' }));
    expect(names(list)).toEqual([
      ['うなずき', 'false'],
      ['首ふり', 'true'],
    ]);
    click(list().getByRole('button', { name: '削除' }));
    expect(names(list)).toEqual([['うなずき', 'true']]);
    act(() => store.undo());
    act(() => store.undo());
    act(() => store.undo());
    expect(store.get().animations.map((a) => a.id)).toEqual(['nod', 'shake']);
  });

  it('アニメーションが無ければ、複製・名前の変更・削除は押せない', () => {
    const { list } = setupAnimationScreen();
    for (const name of ['複製', '名前の変更', '削除']) {
      expect((list().getByRole('button', { name }) as HTMLButtonElement).disabled).toBe(true);
    }
  });
});
