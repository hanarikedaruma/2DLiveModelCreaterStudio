import { act, fireEvent, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Part } from '@app/schema';
import type { ProjectStoreWithHistory } from '@app/core';
import { registerPanelSection } from '../../../shell/api';
import { registry } from '../../../shell/registry';
import { register } from './index';
import { formatNumber, PREVIEW_OFF_BASE_NOTE } from './TransformPanel';
import { openSample, pointer, renderShell, stubSize } from './testUtils';

let restoreSize: () => void = () => {};
beforeEach(() => {
  registry.reset();
  register();
  restoreSize = stubSize(800, 600);
});
afterEach(() => restoreSize());

async function open() {
  const shell = renderShell();
  await openSample(shell);
  const store = shell.services.store as ProjectStoreWithHistory;
  const part = (id: string): Part => store.get().model.parts.find((p) => p.id === id)!;
  const panel = () => within(document.querySelector<HTMLElement>('[data-panel-id="transform"]')!);
  const select = (ids: string[]) => act(() => shell.services.editor.set({ selectedPartIds: ids }));
  const input = (label: string) => panel().getByLabelText(label) as HTMLInputElement;
  // 入力して Enter（または外す）で確定する
  const type = (label: string, value: string, how: 'enter' | 'blur' = 'blur') => {
    fireEvent.change(input(label), { target: { value } });
    if (how === 'enter') fireEvent.keyDown(input(label), { key: 'Enter' });
    else fireEvent.blur(input(label));
  };
  return { ...shell, store, part, panel, select, input, type };
}

describe('Transform パネル', () => {
  it('右に出て、選んでいないときは案内を出す', async () => {
    const { panel } = await open();
    expect(
      document.querySelector('[data-panel-id="transform"]')!.closest('[data-area]')!.getAttribute('data-area'),
    ).toBe('right');
    expect(panel().getByText('パーツを選ぶと、位置・回転・拡縮を数値で編集できる')).toBeTruthy();
  });

  it('基準状態の値を表示し、数値の編集が反映される（1つずつ Undo できる）', async () => {
    const { panel, select, input, type, part, store } = await open();
    select(['part-torso']);
    expect(panel().getByText('胴体')).toBeTruthy();
    expect(input('X').value).toBe('0');
    expect(input('回転中心 X').value).toBe('500');
    expect(input('回転中心 Y').value).toBe('1170');
    expect(input('Scale X').value).toBe('1');
    expect(input('Opacity').value).toBe('1');

    type('X', '12.5');
    type('Y', '-4', 'enter');
    type('Rotation', '30', 'enter');
    type('Scale X', '1.5');
    type('Scale Y', '0.5');
    type('回転中心 X', '480');
    type('回転中心 Y', '1200');
    type('Opacity', '0.25');
    expect(part('part-torso')).toMatchObject({
      position: { x: 12.5, y: -4 },
      rotation: 30,
      scale: { x: 1.5, y: 0.5 },
      pivot: { x: 480, y: 1200 },
      opacity: 0.25,
    });
    expect(input('X').value).toBe('12.5');

    act(() => store.undo());
    expect(part('part-torso').opacity).toBe(1);
    expect(part('part-torso').pivot).toEqual({ x: 480, y: 1200 });
  });

  it('おかしな値は入れない（不透明度は 0..1 に収め、拡縮の 0 と数でないものは戻す）', async () => {
    const { select, input, type, part, store } = await open();
    select(['part-torso']);
    type('Opacity', '3');
    expect(part('part-torso').opacity).toBe(1);
    type('Opacity', '-1');
    expect(part('part-torso').opacity).toBe(0);
    type('Scale X', '0');
    type('Rotation', 'abc');
    expect(part('part-torso').scale.x).toBe(1);
    expect(part('part-torso').rotation).toBe(0);
    expect(input('Rotation').value).toBe('0');
    // Escape で入力をやめる
    fireEvent.change(input('X'), { target: { value: '99' } });
    fireEvent.keyDown(input('X'), { key: 'Escape' });
    fireEvent.blur(input('X'));
    expect(part('part-torso').position.x).toBe(0);
    expect(store.undoLabel()).toBe('不透明度の変更');
  });

  it('複数を選んでいれば、すべてに同じ値を入れる（1回の Undo）', async () => {
    const { panel, select, type, part, store } = await open();
    select(['part-torso', 'part-face']);
    expect(panel().getByText('ほか 1 個（同じ値を入れる）')).toBeTruthy();
    type('Y', '7');
    expect(part('part-torso').position.y).toBe(7);
    expect(part('part-face').position.y).toBe(7);
    act(() => store.undo());
    expect(part('part-torso').position.y).toBe(0);
    expect(part('part-face').position.y).toBe(0);
  });

  it('キャンバスでのドラッグの結果が数値に出る', async () => {
    const { select, input, canvas } = await open();
    select(['part-torso']);
    pointer(canvas).drag({ x: 500, y: 1300 }, { x: 540, y: 1300 });
    expect(Number(input('X').value)).toBeCloseTo(40, 1);
  });

  it('前後の位置のスライダー（−1..1）。1回の操作が1回の Undo', async () => {
    const { panel, select, part, store } = await open();
    select(['part-face']);
    const initial = part('part-face').depth;
    const slider = panel().getByLabelText('前後の位置（手前〜奥）') as HTMLInputElement;
    expect(Number(slider.value)).toBe(initial);
    expect(slider.min).toBe('-1');
    expect(slider.max).toBe('1');
    fireEvent.change(slider, { target: { value: '0.3' } });
    fireEvent.change(slider, { target: { value: '0.7' } });
    expect(part('part-face').depth).toBe(0.7);
    fireEvent.pointerUp(slider);
    fireEvent.change(slider, { target: { value: '-0.5' } });
    fireEvent.keyUp(slider, { key: 'ArrowLeft' });
    expect(part('part-face').depth).toBe(-0.5);
    act(() => store.undo());
    expect(part('part-face').depth).toBe(0.7);
    act(() => store.undo());
    expect(part('part-face').depth).toBe(initial);
    expect(store.canUndo()).toBe(false);
  });

  it('編集中のパラメータがあるときは読み取り専用にして案内を出す', async () => {
    const { panel, select, input, type, part, services } = await open();
    select(['part-torso']);
    act(() => services.editor.set({ activeParameterIds: ['FaceAngleX'] }));
    expect(panel().getByText('パラメータ編集中は画面上で操作')).toBeTruthy();
    expect(input('X').readOnly).toBe(true);
    type('X', '50');
    expect(part('part-torso').position.x).toBe(0);
    expect((panel().getByLabelText('前後の位置（手前〜奥）') as HTMLInputElement).disabled).toBe(true);
  });

  it('編集中のパラメータが無く、値だけがデフォルト値でないとき（表情を作っている途中など）も読み取り専用にする（I-029）', async () => {
    const { panel, select, input, type, part, services } = await open();
    select(['part-torso']);
    act(() => services.editor.set({ activeParameterIds: [], editorParamValues: { FaceAngleX: 30 } }));
    expect(panel().getByText(PREVIEW_OFF_BASE_NOTE)).toBeTruthy();
    expect(panel().queryByText('パラメータ編集中は画面上で操作')).toBeNull();
    expect(input('X').readOnly).toBe(true);
    type('X', '50');
    expect(part('part-torso').position.x).toBe(0);
    expect((panel().getByLabelText('前後の位置（手前〜奥）') as HTMLInputElement).disabled).toBe(true);

    // 値をデフォルト値に戻すと編集できる
    act(() => services.editor.set({ editorParamValues: {} }));
    expect(panel().queryByText(PREVIEW_OFF_BASE_NOTE)).toBeNull();
    type('X', '50');
    expect(part('part-torso').position.x).toBe(50);
  });

  it('パネルの下にほかのカードのセクションが入る', async () => {
    registerPanelSection({ id: 't.section', panelId: 'transform', component: () => <span>追加のセクション</span> });
    const { panel } = await open();
    expect(panel().getByText('追加のセクション')).toBeTruthy();
  });

  it('数値の表示は桁を丸め、余分な 0 を付けない', () => {
    expect(formatNumber(12.345678, 2)).toBe('12.35');
    expect(formatNumber(1.5, 3)).toBe('1.5');
    expect(formatNumber(-0.0001, 2)).toBe('0');
  });
});
