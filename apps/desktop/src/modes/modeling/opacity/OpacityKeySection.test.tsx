// 「Transform」パネルの「不透明度（このキー）」（カード34）。本物の KeyEditor で確かめる
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Part, Project, TransformDelta } from '@app/schema';
import type { ProjectStoreWithHistory } from '@app/core';
import { withStep1Parameters } from '../../../project/step1Params';
import { createKeyEditor } from '../../../services/keyEditor';
import { registry } from '../../../shell/registry';
import { register as registerTransform } from '../canvas';
import { NEEDS_KEY_MESSAGE } from '../canvas/liveEdit';
import { renderShell, sampleProject, stubSize } from '../canvas/testUtils';
import { basePart } from '../structure/modelOps';
import { register } from './index';
import { OPACITY_FLOOR } from './opacityKey';
import { OPACITY_SLIDER_LABEL } from './OpacityKeySection';

let restoreSize: () => void = () => {};
beforeEach(() => {
  registry.reset();
  registerTransform();
  register();
  restoreSize = stubSize(800, 600);
});
afterEach(() => restoreSize());

// サンプルに頬のパーツと STEP1 の標準パラメータを足したもの
function cheekProject(): Project {
  const p = withStep1Parameters(sampleProject());
  const cheek = basePart({ id: 'part-cheek', name: '頬', kind: 'image', standardType: 'cheek' });
  return { ...p, model: { ...p.model, parts: [...p.model.parts, cheek] } };
}

function open() {
  const shell = renderShell(() => ({ keyEditor: createKeyEditor() }));
  act(() => shell.services.store.load(cheekProject()));
  const store = shell.services.store as ProjectStoreWithHistory;
  const part = (id: string): Part => store.get().model.parts.find((p) => p.id === id)!;
  const panel = () => within(document.querySelector<HTMLElement>('[data-panel-id="transform"]')!);
  const slider = () => panel().queryByLabelText(OPACITY_SLIDER_LABEL) as HTMLInputElement | null;
  const editing = (values: Record<string, number>, selected = ['part-cheek']) =>
    act(() =>
      shell.services.editor.set({
        selectedPartIds: selected,
        activeParameterIds: Object.keys(values),
        editorParamValues: values,
      }),
    );
  // スライダーを動かして離す（1回の操作）
  const slide = (...values: number[]) => {
    for (const v of values) fireEvent.change(slider()!, { target: { value: String(v) } });
    fireEvent.pointerUp(slider()!);
  };
  const keyOpacity = (partId: string, value: number) => {
    const b = store.get().model.bindings.find((x) => x.target.id === partId && x.channel === 'transform');
    const key = b?.keys.find((k) => Math.abs(k.coords[0]! - value) < 1e-6);
    return key ? (key.delta as TransformDelta).opacity : undefined;
  };
  return { ...shell, store, part, panel, slider, editing, slide, keyOpacity };
}

describe('不透明度（このキー）のセクション', () => {
  it('パラメータの編集中で、パーツを選んでいるときだけ出す', () => {
    const { slider, editing, services } = open();
    expect(slider()).toBeNull();
    act(() => services.editor.set({ selectedPartIds: ['part-cheek'] }));
    expect(slider()).toBeNull(); // 編集中でない
    editing({ Cheek: 1 }, []);
    expect(slider()).toBeNull(); // パーツを選んでいない
    editing({ Cheek: 1 });
    expect(slider()).not.toBeNull();
    expect(slider()!.value).toBe('1');
  });

  it('頬染めを Cheek で出し入れする: デフォルト値で消し、値 1 のキーで出す（操作ごとに1回の Undo）', () => {
    const { slider, editing, slide, part, store, keyOpacity, panel } = open();
    editing({ Cheek: 0 });
    expect(panel().getByText(/デフォルト値では基準状態の不透明度を変える/)).toBeTruthy();
    slide(0.5, 0.2, 0);
    expect(part('part-cheek').opacity).toBe(OPACITY_FLOOR);
    expect(slider()!.value).toBe(String(OPACITY_FLOOR));
    expect(panel().getByText('0', { selector: 'output' })).toBeTruthy();
    expect(store.undoLabel()).toBe('不透明度の変更');

    editing({ Cheek: 1 });
    slide(0.6, 1);
    expect(keyOpacity('part-cheek', 1)).toBeCloseTo(1 / OPACITY_FLOOR);
    expect(keyOpacity('part-cheek', 0)).toBe(1); // デフォルト値のキーは差分なし
    expect(Number(slider()!.value)).toBeCloseTo(1);
    expect(part('part-cheek').opacity).toBe(OPACITY_FLOOR);

    act(() => store.undo());
    expect(store.get().model.bindings).toHaveLength(0);
    act(() => store.undo());
    expect(part('part-cheek').opacity).toBe(1);
    expect(store.canUndo()).toBe(false);
  });

  it('キーの無い値では、キーを足すか確かめてから記録する（キーの追加と変更で1回の Undo）', async () => {
    const { editing, slide, store, keyOpacity, panel } = open();
    editing({ Cheek: 1 });
    slide(0.2);
    editing({ Cheek: 0.5 });
    expect(panel().getByText(/この値にはキーが無い/)).toBeTruthy();
    const before = store.get();

    slide(0.9);
    const dialog = await screen.findByRole('dialog', { name: NEEDS_KEY_MESSAGE });
    fireEvent.click(within(dialog).getByRole('button', { name: 'OK' }));
    await waitFor(() => expect(keyOpacity('part-cheek', 0.5)).toBeCloseTo(0.9));
    expect(keyOpacity('part-cheek', 1)).toBeCloseTo(0.2);
    act(() => store.undo());
    expect(store.get()).toBe(before);
  });

  it('キーを足さないと答えたら何も変えない', async () => {
    const { editing, slide, store } = open();
    editing({ Cheek: 1 });
    slide(0.2);
    editing({ Cheek: 0.5 });
    const before = store.get();
    slide(0.9);
    const dialog = await screen.findByRole('dialog', { name: NEEDS_KEY_MESSAGE });
    fireEvent.click(within(dialog).getByRole('button', { name: 'キャンセル' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(store.get()).toBe(before);
  });

  it('複数のパーツを選ぶと同じ値を入れる', () => {
    const { editing, slide, panel, keyOpacity } = open();
    editing({ MouthOpen: 1 }, ['part-upperLip', 'part-lowerLip']);
    expect(panel().getByText('選んだ 2 個に同じ値を入れる')).toBeTruthy();
    slide(0.3);
    expect(keyOpacity('part-upperLip', 1)).toBeCloseTo(0.3);
    expect(keyOpacity('part-lowerLip', 1)).toBeCloseTo(0.3);
  });
});
