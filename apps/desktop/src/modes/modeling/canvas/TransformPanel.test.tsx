import { act, fireEvent, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Part } from '@app/schema';
import type { ProjectStoreWithHistory } from '@app/core';
import { createDeformPipeline } from '@app/core';
import { registerPanelSection } from '../../../shell/api';
import { registry } from '../../../shell/registry';
import { register } from './index';
import { formatNumber, PARAM_EDIT_NOTE, PREVIEW_OFF_BASE_NOTE } from './TransformPanel';
import { makeMesh } from '../structure/testing';
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
    expect(part('part-torso').position).toEqual({ x: 12.5, y: -4 });
    type('回転中心 X', '480');
    type('回転中心 Y', '1200');
    type('Opacity', '0.25');
    expect(part('part-torso')).toMatchObject({
      rotation: 30,
      scale: { x: 1.5, y: 0.5 },
      pivot: { x: 480, y: 1200 },
      opacity: 0.25,
    });
    // 回転中心を変えたあとは、画像を保つために補った位置も欄に反映する。
    expect(input('X').value).toBe('-0.98');

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

  it.each([
    { ids: ['part-torso'], label: '回転中心 X', value: 480, axis: 'x' as const },
    { ids: ['part-face'], label: '回転中心 Y', value: 470, axis: 'y' as const },
    { ids: ['part-torso', 'part-face'], label: '回転中心 Y', value: 1200, axis: 'y' as const },
  ])(
    '$labelを数値で変えても、回転・拡縮した親子の頂点は動かず1回のUndoで戻る（$ids・I-062）',
    async ({ ids, label, value, axis }) => {
      const { select, type, part, store } = await open();
      const project = store.get();
      const mesh = makeMesh('numeric-pivot-mesh');
      act(() =>
        store.load({
          ...project,
          model: {
            ...project.model,
            meshes: [...project.model.meshes, mesh],
            parts: project.model.parts.map((p) =>
              p.id === 'part-torso'
                ? { ...p, meshId: mesh.id, rotation: 30, scale: { x: 1.5, y: 0.5 } }
                : p.id === 'part-face'
                  ? { ...p, meshId: mesh.id, parentId: 'part-torso', rotation: -23, scale: { x: -0.8, y: 1.4 } }
                  : p,
            ),
          },
        }),
      );
      select(ids);
      const before = store.get();
      const pipeline = createDeformPipeline();
      const positions = () =>
        pipeline
          .deform(store.get().model, { transforms: {}, vertices: {}, warpPoints: {} })
          .items.map((item) => ({ id: item.partId, points: Array.from(item.positions) }));
      const original = positions();
      expect(original).toHaveLength(2);

      type(label, String(value), 'enter');
      for (const id of ids) expect(part(id).pivot[axis]).toBe(value);
      const after = positions();
      expect(after.map((item) => item.id)).toEqual(original.map((item) => item.id));
      after.forEach((item, i) => item.points.forEach((v, j) => expect(v).toBeCloseTo(original[i]!.points[j]!, 3)));
      expect(store.get().model.bindings).toBe(before.model.bindings);
      act(() => store.undo());
      expect(store.get()).toBe(before);
      expect(store.canUndo()).toBe(false);
    },
  );

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
    expect(panel().getByText(PARAM_EDIT_NOTE)).toBeTruthy();
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
    expect(panel().queryByText(PARAM_EDIT_NOTE)).toBeNull();
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
