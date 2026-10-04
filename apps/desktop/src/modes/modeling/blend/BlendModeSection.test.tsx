import { act, fireEvent, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Part } from '@app/schema';
import type { ProjectStoreWithHistory } from '@app/core';
import { registry } from '../../../shell/registry';
import { register as registerTransform } from '../canvas';
import { openSample, renderShell, sampleProject, stubSize } from '../canvas/testUtils';
import { basePart } from '../structure/modelOps';
import { register } from './index';

let restoreSize: () => void = () => {};
beforeEach(() => {
  registry.reset();
  registerTransform();
  register();
  restoreSize = stubSize(800, 600);
});
afterEach(() => restoreSize());

// サンプルに空のグループを1つ足したもの
function projectWithGroup() {
  const p = sampleProject();
  const group = basePart({ id: 'group-1', name: 'まとめ', kind: 'group' });
  return { ...p, model: { ...p.model, parts: [...p.model.parts, group] } };
}

async function open() {
  const shell = renderShell();
  await openSample(shell, projectWithGroup());
  const store = shell.services.store as ProjectStoreWithHistory;
  const part = (id: string): Part => store.get().model.parts.find((p) => p.id === id)!;
  const panel = () => within(document.querySelector<HTMLElement>('[data-panel-id="transform"]')!);
  const select = (ids: string[]) => act(() => shell.services.editor.set({ selectedPartIds: ids }));
  const blendSelect = () => panel().getByLabelText('合成モード') as HTMLSelectElement;
  return { ...shell, store, part, panel, select, blendSelect };
}

describe('合成モードのセクション（Transform パネル）', () => {
  it('パーツを選んでいないときは出さない', async () => {
    const { panel } = await open();
    expect(panel().queryByLabelText('合成モード')).toBeNull();
  });

  it('通常・乗算・スクリーン・加算から選び、パーツと描画に反映される（Undo できる）', async () => {
    const { select, blendSelect, part, store, canvas } = await open();
    select(['part-face']);
    const options = Array.from(blendSelect().options).map((o) => [o.value, o.textContent]);
    expect(options).toEqual([
      ['normal', '通常'],
      ['multiply', '乗算'],
      ['screen', 'スクリーン'],
      ['add', '加算'],
    ]);
    expect(blendSelect().value).toBe('normal');

    fireEvent.change(blendSelect(), { target: { value: 'multiply' } });
    expect(part('part-face').blendMode).toBe('multiply');
    expect(blendSelect().value).toBe('multiply');
    // 変形の結果（レンダラーに渡すもの）にも入る
    await waitFor(() => expect(canvas.lastDeformed()?.byPartId['part-face']?.blendMode).toBe('multiply'));

    fireEvent.change(blendSelect(), { target: { value: 'add' } });
    expect(part('part-face').blendMode).toBe('add');
    act(() => store.undo());
    expect(part('part-face').blendMode).toBe('multiply');
  });

  it('複数選ぶとそろえて変え（1回の Undo）、ばらばらなら「混在」と出す', async () => {
    const { select, blendSelect, part, store } = await open();
    select(['part-irisL']);
    fireEvent.change(blendSelect(), { target: { value: 'screen' } });
    select(['part-irisL', 'part-irisR']);
    expect(blendSelect().value).toBe('mixed');
    expect(within(blendSelect()).getByText('（混在）')).toBeTruthy();

    fireEvent.change(blendSelect(), { target: { value: 'add' } });
    expect([part('part-irisL').blendMode, part('part-irisR').blendMode]).toEqual(['add', 'add']);
    expect(blendSelect().value).toBe('add');
    act(() => store.undo());
    expect([part('part-irisL').blendMode, part('part-irisR').blendMode]).toEqual(['screen', 'normal']);
  });

  it('グループだけを選ぶと選べない（グループは合成モードを使わない）。混ざっていれば画像パーツだけ変える', async () => {
    const { select, blendSelect, panel, part } = await open();
    select(['group-1']);
    expect(blendSelect().disabled).toBe(true);
    expect(panel().getByText('グループには合成モードが無い（画像パーツを選ぶ）')).toBeTruthy();

    select(['group-1', 'part-neck']);
    expect(blendSelect().disabled).toBe(false);
    fireEvent.change(blendSelect(), { target: { value: 'screen' } });
    expect(part('part-neck').blendMode).toBe('screen');
    expect(part('group-1').blendMode).toBe('normal');
  });
});
