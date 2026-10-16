import { act, fireEvent, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MemoryFileSystem, type Services } from '@app/contracts';
import { createProjectIO } from '@app/io';
import type { Project } from '@app/schema';
import { registry } from '../../../shell/registry';
import { pngBytes, renderShell, testServices } from '../assets/testShell';
import {
  openSample,
  renderShell as renderCanvasShell,
  sampleProject as fixtureProject,
  stubSize,
} from '../canvas/testUtils';
import { register as registerStructure } from './index';
import { MASK_HINT } from './MaskPanel';
import { makeAsset, makePart, makeProject } from './testing';

beforeEach(() => {
  registry.reset();
  registerStructure();
});

// 頭 ─┬ 顔
//     ├ 白目
//     └ 瞳 ── ハイライト（画像の子）
// 前髪
function maskProject(): Project {
  return makeProject({
    assets: ['A', 'B', 'C', 'D', 'E'].map((id, i) =>
      makeAsset(id, { offset: { x: 100 * i, y: 100 }, width: 40, height: 20 }),
    ),
    parts: [
      makePart('head', { kind: 'group', name: '頭' }),
      makePart('face', { parentId: 'head', name: '顔', assetId: 'A' }),
      makePart('white', { parentId: 'head', name: '白目', assetId: 'B' }),
      makePart('iris', { parentId: 'head', name: '瞳', assetId: 'C' }),
      makePart('hl', { parentId: 'iris', name: 'ハイライト', assetId: 'D' }),
      makePart('hair', { name: '前髪', assetId: 'E' }),
    ],
    drawOrder: ['face', 'white', 'iris', 'hl', 'hair'],
  });
}

async function setup(project = maskProject(), overrides: Partial<Services> = {}) {
  const services = testServices(overrides);
  renderShell(services);
  const pngs = Object.fromEntries(project.assets.map((a) => [a.id, pngBytes(a.width, a.height)]));
  await act(async () => {
    await Promise.all(project.assets.map((a) => services.assets.put(a.id, pngs[a.id]!)));
    services.store.load(project);
  });
  const panel = () => within(document.querySelector<HTMLElement>('[data-panel-id="partSettings"]')!);
  const select = (id: string) => act(() => services.editor.set({ selectedPartIds: [id] }));

  const maskOf = (id: string) => services.store.get().model.parts.find((p) => p.id === id)!.mask;
  const sources = () => panel().getByRole('group', { name: 'マスク元' });
  const sourceNames = () =>
    within(sources())
      .queryAllByRole('checkbox')
      .map((el) => el.parentElement!.textContent);
  const source = (name: string) => within(sources()).getByRole('checkbox', { name }) as HTMLInputElement;
  const invert = () => panel().getByRole('checkbox', { name: '反転（範囲の外を表示）' }) as HTMLInputElement;
  return { services, initial: project, pngs, panel, select, maskOf, sources, sourceNames, source, invert };
}

describe('詳細: 複数のマスク元と反転', () => {
  it('マスク元の一覧（チェック）と [反転] と説明を出す。ドロップダウンは出さない', async () => {
    const { panel, select, sourceNames, invert } = await setup();

    select('iris');
    expect(panel().queryByLabelText('マスク')).toBeNull();
    expect(panel().queryByRole('button', { name: /複数のマスク元・反転/ })).toBeNull();
    // 自身（瞳）・子孫（ハイライト）・グループ（頭）は出さない。前面から順
    expect(sourceNames()).toEqual(['前髪', '白目', '顔']);
    expect(invert().checked).toBe(false);
    expect(invert().disabled).toBe(true); // マスク元が無いうちは反転できない
    expect(panel().getByText(MASK_HINT)).toBeTruthy();
    expect(MASK_HINT).toBe('複数選ぶと、どれかの範囲を表示します。反転すると、その外側を表示します');
    expect(panel().getByTestId('mask-summary').textContent).toBe('なし');
  });

  it('ほかのパーツでも、自身と子孫と画像でないパーツは出ない', async () => {
    const { panel, select, sourceNames } = await setup();

    select('hair');
    expect(sourceNames()).toEqual(['ハイライト', '瞳', '白目', '顔']);
    select('hl');
    expect(sourceNames()).toEqual(['前髪', '瞳', '白目', '顔']);
    // グループにはマスクを出さない
    select('head');
    expect(panel().queryByRole('group', { name: 'マスク元' })).toBeNull();
    expect(panel().queryByRole('checkbox', { name: '反転（範囲の外を表示）' })).toBeNull();
  });

  it('複数選び、反転すると保存され、外すと「なし」に戻る', async () => {
    const { panel, select, maskOf, source, invert } = await setup();

    select('iris');
    fireEvent.click(source('白目'));
    fireEvent.click(source('前髪'));
    expect(maskOf('iris')).toEqual({ sourcePartIds: ['white', 'hair'], inverted: false });
    expect(source('白目').checked).toBe(true);
    expect(source('前髪').checked).toBe(true);
    expect(source('顔').checked).toBe(false);
    expect(panel().getByTestId('mask-summary').textContent).toBe('前髪、白目');

    expect(invert().disabled).toBe(false);
    fireEvent.click(invert());
    expect(maskOf('iris')).toEqual({ sourcePartIds: ['white', 'hair'], inverted: true });
    expect(invert().checked).toBe(true);

    fireEvent.click(source('白目'));
    expect(maskOf('iris')).toEqual({ sourcePartIds: ['hair'], inverted: true });
    fireEvent.click(source('前髪'));
    expect(maskOf('iris')).toBeNull();
    expect(invert().checked).toBe(false);
    expect(invert().disabled).toBe(true);
  });

  it('マスク元にできるパーツが無ければそう出す', async () => {
    const one = makeProject({ assets: [makeAsset('A')], parts: [makePart('only', { name: 'だけ', assetId: 'A' })] });
    const { panel, select } = await setup(one);

    select('only');
    expect(panel().getByText('マスク元にできる画像パーツが無い')).toBeTruthy();
    expect(
      panel()
        .queryAllByRole('checkbox')
        .map((el) => (el as HTMLInputElement).disabled),
    ).toEqual([true]);
  });

  it('保存したプロジェクトを読み直しても、複数・反転の設定が残る', async () => {
    const io = createProjectIO(new MemoryFileSystem());
    const { services, pngs, select, source, invert } = await setup(maskProject(), { io });

    select('iris');
    fireEvent.click(source('白目'));
    fireEvent.click(source('顔'));
    fireEvent.click(invert());
    await io.save('/work/model', services.store.get(), pngs);
    const { project } = await io.load('/work/model');
    expect(project.model.parts.find((p) => p.id === 'iris')!.mask).toEqual({
      sourcePartIds: ['white', 'face'],
      inverted: true,
    });
  });

  it('1回の操作ごとに Undo で戻る', async () => {
    const { services, initial, select, maskOf, source, invert } = await setup();

    select('iris');
    fireEvent.click(source('白目'));
    fireEvent.click(source('顔'));
    fireEvent.click(invert());
    fireEvent.click(source('白目'));
    expect(maskOf('iris')).toEqual({ sourcePartIds: ['face'], inverted: true });
    act(() => services.store.undo());
    expect(maskOf('iris')).toEqual({ sourcePartIds: ['white', 'face'], inverted: true });
    expect(source('白目').checked).toBe(true);
    act(() => services.store.undo());
    expect(maskOf('iris')).toEqual({ sourcePartIds: ['white', 'face'], inverted: false });
    expect(invert().checked).toBe(false);
    act(() => services.store.undo());
    act(() => services.store.undo());
    expect(services.store.get()).toBe(initial);
    expect(services.store.canUndo()).toBe(false);
  });
});

describe('I-088: 常に表示するマスクの設定', () => {
  it('単一選択欄は外し、複数のマスク元と反転を直接操作できる。全部外すとなしに戻る', async () => {
    const { panel, select, maskOf, sourceNames, source, invert } = await setup();
    select('iris');
    expect(panel().queryByRole('combobox', { name: 'マスク' })).toBeNull();
    expect(sourceNames()).toEqual(['前髪', '白目', '顔']);
    fireEvent.click(source('白目'));
    fireEvent.click(source('顔'));
    fireEvent.click(invert());
    expect(maskOf('iris')).toEqual({ sourcePartIds: ['white', 'face'], inverted: true });
    fireEvent.click(source('白目'));
    fireEvent.click(source('顔'));
    expect(maskOf('iris')).toBeNull();
    expect(invert().disabled).toBe(true);
  });

  it('複数・反転の設定は選択を変えて戻しても表示と値が残る', async () => {
    const { select, maskOf, source, invert } = await setup();
    select('iris');
    fireEvent.click(source('白目'));
    fireEvent.click(source('前髪'));
    fireEvent.click(invert());
    select('face');
    select('iris');
    expect(maskOf('iris')).toEqual({ sourcePartIds: ['white', 'hair'], inverted: true });
    expect(source('白目').checked).toBe(true);
    expect(source('前髪').checked).toBe(true);
    expect(invert().checked).toBe(true);
  });
});
describe('描画への反映', () => {
  let restoreSize: () => void = () => {};
  beforeEach(() => {
    restoreSize = stubSize(800, 600);
  });
  afterEach(() => restoreSize());

  it('複数・反転の設定が変形の結果とレンダラーに渡るものに入る', async () => {
    const shell = renderCanvasShell();
    await openSample(shell, fixtureProject());
    const { services, canvas, renderer } = shell;

    act(() => services.editor.set({ selectedPartIds: ['part-irisL'] }));
    const panel = within(document.querySelector<HTMLElement>('[data-panel-id="partSettings"]')!);
    const sources = within(panel.getByRole('group', { name: 'マスク元' }));
    // サンプルの画像パーツ 28 個から自身を除く
    expect(sources.getAllByRole('checkbox')).toHaveLength(27);
    expect(sources.queryByRole('checkbox', { name: '瞳 L' })).toBeNull();

    fireEvent.click(sources.getByRole('checkbox', { name: '白目 L' }));
    fireEvent.click(sources.getByRole('checkbox', { name: '白目 R' }));
    fireEvent.click(panel.getByRole('checkbox', { name: '反転（範囲の外を表示）' }));
    const expected = { sourcePartIds: ['part-eyeWhiteL', 'part-eyeWhiteR'], inverted: true };
    await waitFor(() => expect(canvas.lastDeformed()?.byPartId['part-irisL']?.mask).toEqual(expected));
    await waitFor(() => expect(renderer.renders.at(-1)?.model.byPartId['part-irisL']?.mask).toEqual(expected));
    expect(renderer.renders.at(-1)?.model.byPartId['part-eyeWhiteL']?.mask).toBeNull();

    act(() => services.store.undo());
    await waitFor(() =>
      expect(renderer.renders.at(-1)?.model.byPartId['part-irisL']?.mask).toEqual({ ...expected, inverted: false }),
    );
  });
});
