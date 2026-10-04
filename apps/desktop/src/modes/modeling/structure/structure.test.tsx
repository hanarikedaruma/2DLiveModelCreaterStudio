import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Services } from '@app/contracts';
import { registerPanelSection } from '../../../shell/api';
import { registry } from '../../../shell/registry';
import { register as registerAssets } from '../assets';
import { dragTo, pngBytes, renderShell, stubRect, testServices } from '../assets/testShell';
import { register as registerStructure } from './index';
import { setPngFlipper } from './mirrorCopy';
import { childrenOf } from './modelOps';
import { REPLACE_CONFIRM_MESSAGE } from './replaceAsset';
import { makeAsset, makeBinding, makeMesh, makePart, makeProject } from './testing';

beforeEach(() => {
  registry.reset();
  registerAssets();
  registerStructure();
});
afterEach(() => setPngFlipper(null));

const quad = (x: number, y: number, w: number, h: number) =>
  makeMesh('', {
    vertices: [
      { x, y },
      { x: x + w, y },
      { x: x + w, y: y + h },
      { x, y: y + h },
    ],
    uvs: [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
    ],
    triangles: [
      [0, 1, 2],
      [0, 2, 3],
    ],
  });

// 頭 ─┬ 顔
//     └ 白目 L
// 前髪
function sampleProject() {
  return makeProject({
    assets: [
      makeAsset('A', { offset: { x: 450, y: 100 }, width: 100, height: 50, canvasSize: { width: 1000, height: 1000 } }),
      makeAsset('B', { offset: { x: 600, y: 300 }, width: 40, height: 20, canvasSize: { width: 1000, height: 1000 } }),
      makeAsset('C', { offset: { x: 650, y: 300 }, width: 40, height: 20, source: { kind: 'png', file: '白目2.png' } }),
      makeAsset('D', {
        offset: { x: 590, y: 290 },
        width: 80,
        height: 30,
        source: { kind: 'png', file: '白目大.png' },
      }),
    ],
    parts: [
      makePart('head', { kind: 'group', name: '頭' }),
      makePart('face', { parentId: 'head', name: '顔', standardType: 'face', assetId: 'A', meshId: 'mf' }),
      makePart('eyeL', { parentId: 'head', name: '白目 L', standardType: 'eyeWhiteL', assetId: 'B', meshId: 'me' }),
      makePart('hair', { name: '前髪', standardType: 'frontHair', assetId: 'C' }),
    ],
    drawOrder: ['face', 'eyeL', 'hair'],
    meshes: [
      { ...quad(450, 100, 100, 50), id: 'mf' },
      { ...quad(600, 300, 40, 20), id: 'me' },
    ],
    bindings: [
      makeBinding('bv', {
        target: { type: 'mesh', id: 'me' },
        channel: 'vertices',
        parameterIds: ['EyeOpenL'],
        keyValues: [[0, 1]],
        keys: [
          {
            coords: [0],
            delta: [
              { x: 1, y: 2 },
              { x: 3, y: 4 },
              { x: 0, y: 0 },
              { x: -5, y: 0 },
            ],
            source: 'manual',
            locked: false,
          },
        ],
      }),
      makeBinding('bt', {
        target: { type: 'part', id: 'eyeL' },
        parameterIds: ['EyeOpenL'],
        keyValues: [[0, 1]],
        keys: [
          {
            coords: [0],
            delta: { position: { x: 7, y: -1 }, rotation: 3, scale: { x: 1, y: 1 }, opacity: 1 },
            source: 'manual',
            locked: false,
          },
        ],
      }),
    ],
  });
}

async function setup() {
  const services = testServices();
  renderShell(services);
  const project = sampleProject();
  await act(async () => {
    await Promise.all(project.assets.map((a) => services.assets.put(a.id, pngBytes(a.width, a.height))));
    services.store.load(project);
  });
  return { services, initial: project };
}

const treeRow = (id: string) => document.querySelector(`[role="tree"] [data-part-id="${id}"]`)!;
const orderRow = (id: string) => document.querySelector(`[aria-label="描画順"] [data-part-id="${id}"]`)!;
const orderIds = () =>
  [...document.querySelectorAll('[aria-label="描画順"] [data-part-id]')].map((el) => el.getAttribute('data-part-id'));
const partOf = (services: Services, id: string) => services.store.get().model.parts.find((p) => p.id === id);

function openMenu(id: string, item: string) {
  fireEvent.contextMenu(treeRow(id), { clientX: 10, clientY: 10 });
  fireEvent.click(screen.getByRole('menuitem', { name: item }));
}

describe('パーツ構造', () => {
  it('ドラッグで親を変えても描画順が変わらない。兄弟の並び替えもできる', async () => {
    const { services } = await setup();
    const drawOrder = services.store.get().model.drawOrder;
    expect(screen.getAllByRole('treeitem').map((el) => el.textContent)).toEqual(['▾頭', '顔', '白目 L', '前髪']);

    // 前髪を「頭」の行（グループ）に落とすと中に入る
    dragTo(treeRow('hair'), treeRow('head'));
    expect(partOf(services, 'hair')!.parentId).toBe('head');
    expect(services.store.get().model.drawOrder).toBe(drawOrder);

    // 白目 L を顔の行の上側に落とすと、顔の前の兄弟になる
    stubRect(treeRow('face'), { top: 100, height: 20 });
    dragTo(treeRow('eyeL'), treeRow('face'), { clientY: 102 });
    expect(childrenOf(services.store.get().model, 'head').map((p) => p.id)).toEqual(['eyeL', 'face', 'hair']);
    expect(services.store.get().model.drawOrder).toBe(drawOrder);

    // 何も無いところに落とすといちばん上（根）に戻る
    dragTo(treeRow('hair'), screen.getByRole('tree'));
    expect(partOf(services, 'hair')!.parentId).toBeNull();

    // 自身の子孫には動かせない
    const before = services.store.get();
    dragTo(treeRow('head'), treeRow('face'));
    expect(services.store.get()).toBe(before);
  });

  it('右クリックの「親を変更」で選んだグループへ動かす', async () => {
    const { services } = await setup();
    openMenu('hair', '親を変更…');
    const dialog = screen.getByRole('dialog', { name: '親を変更' });
    // 画像パーツは親にできない
    expect(
      within(dialog)
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(['（いちばん上）', '頭', 'キャンセル']);
    fireEvent.click(within(dialog).getByRole('button', { name: '頭' }));
    expect(partOf(services, 'hair')!.parentId).toBe('head');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('表示・ロックの切り替えと名前の変更', async () => {
    const { services } = await setup();
    const row = treeRow('face') as HTMLElement;
    fireEvent.click(within(row).getByRole('button', { name: '表示' }));
    expect(partOf(services, 'face')!.visible).toBe(false);
    fireEvent.click(within(row).getByRole('button', { name: 'ロック' }));
    expect(partOf(services, 'face')!.locked).toBe(true);
    fireEvent.doubleClick(row);
    const input = screen.getByLabelText('パーツの名前');
    fireEvent.change(input, { target: { value: '輪郭' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(partOf(services, 'face')!.name).toBe('輪郭');
    // Escape なら変えない
    fireEvent.doubleClick(treeRow('face'));
    fireEvent.change(screen.getByLabelText('パーツの名前'), { target: { value: 'x' } });
    fireEvent.keyDown(screen.getByLabelText('パーツの名前'), { key: 'Escape' });
    expect(partOf(services, 'face')!.name).toBe('輪郭');
  });

  it('クリックで選び、コピー・グループ化・削除ができる', async () => {
    const { services } = await setup();
    fireEvent.click(treeRow('face'));
    fireEvent.click(treeRow('hair'), { ctrlKey: true });
    expect(services.editor.get().selectedPartIds).toEqual(['face', 'hair']);

    openMenu('hair', 'グループ化');
    const group = services.store.get().model.parts.find((p) => p.name === 'グループ')!;
    expect(childrenOf(services.store.get().model, group.id).map((p) => p.id)).toEqual(['face', 'hair']);
    expect(services.editor.get().selectedPartIds).toEqual([group.id]);

    openMenu('eyeL', 'コピー');
    const copy = services.store.get().model.parts.find((p) => p.name === '白目 Lのコピー')!;
    expect(copy).toMatchObject({ parentId: 'head', assetId: 'B', standardType: null });
    expect(services.editor.get().selectedPartIds).toEqual([copy.id]);

    openMenu(group.id, '削除');
    const model = services.store.get().model;
    expect(model.parts.some((p) => p.id === 'face' || p.id === 'hair' || p.id === group.id)).toBe(false);
    expect(model.drawOrder).toEqual(['eyeL', copy.id]);
  });
});

describe('左右反転コピー', () => {
  it('反転した PNG を作り、差分の符号とパラメータの L / R を入れ替えた複製を作る', async () => {
    const { services } = await setup();
    const flip = vi.fn(async (png: Uint8Array) => png.slice());
    setPngFlipper(flip);
    openMenu('eyeL', '左右反転コピー');
    await waitFor(() => expect(services.store.get().model.parts).toHaveLength(5));
    expect(flip).toHaveBeenCalledTimes(1);
    const model = services.store.get().model;
    const copy = model.parts.find((p) => p.standardType === 'eyeWhiteR')!;
    expect(copy).toMatchObject({ name: '白目 R', parentId: 'head' });
    // 素材は反転した PNG の新しい Asset（中心線はキャンバスの中央 500）
    const asset = services.store.get().assets.find((a) => a.id === copy.assetId)!;
    expect(asset.offset).toEqual({ x: 360, y: 300 });
    expect(services.assets.getPng(asset.id)).toBeDefined();
    const mesh = model.meshes.find((m) => m.id === copy.meshId)!;
    expect(mesh.vertices[0]).toEqual({ x: 400, y: 300 });
    const vertices = model.bindings.find((b) => b.target.id === copy.meshId)!;
    expect(vertices.parameterIds).toEqual(['EyeOpenR']);
    expect((vertices.keys[0]!.delta as { x: number }[]).map((d) => d.x)).toEqual([-1, -3, 0, 5]);
    const transform = model.bindings.find((b) => b.target.id === copy.id)!;
    expect(transform.parameterIds).toEqual(['EyeOpenR']);
    expect(transform.keys[0]!.delta).toMatchObject({ position: { x: -7, y: -1 }, rotation: -3 });
    await waitFor(() => expect(services.editor.get().selectedPartIds).toEqual([copy.id]));
    // Undo で戻る
    act(() => services.store.undo());
    expect(services.store.get().model.parts).toHaveLength(4);
  });

  it('反転できなければ知らせる', async () => {
    const { services } = await setup();
    setPngFlipper(async () => {
      throw new Error('読めない');
    });
    openMenu('eyeL', '左右反転コピー');
    expect(await screen.findByText('左右反転コピーができない: 読めない')).toBeTruthy();
    expect(services.store.get().model.parts).toHaveLength(4);
  });
});

describe('素材を差し替え', () => {
  it('同じ大きさなら assetId だけ、違う大きさは確認してメッシュを作り直す', async () => {
    const { services } = await setup();
    openMenu('eyeL', '素材を差し替え…');
    let dialog = screen.getByRole('dialog', { name: '差し替える素材を選ぶ' });
    fireEvent.click(within(dialog).getByText('白目2'));
    expect(partOf(services, 'eyeL')).toMatchObject({ assetId: 'C', meshId: 'me' });
    expect(services.store.get().model.bindings).toHaveLength(2);

    openMenu('eyeL', '素材を差し替え…');
    dialog = screen.getByRole('dialog', { name: '差し替える素材を選ぶ' });
    fireEvent.click(within(dialog).getByText('白目大'));
    expect(await screen.findByText(REPLACE_CONFIRM_MESSAGE)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    await waitFor(() => expect(partOf(services, 'eyeL')!.assetId).toBe('D'));
    // キャンバス上の位置（新しい素材の offset）でメッシュを作り直し、vertices のキーを新しいメッシュへ移す（カード28）
    const mesh = services.store.get().model.meshes.find((m) => m.id === 'me')!;
    expect(mesh.vertices).toEqual([
      { x: 590, y: 290 },
      { x: 670, y: 290 },
      { x: 670, y: 320 },
      { x: 590, y: 320 },
    ]);
    expect(services.store.get().model.bindings.map((b) => b.id)).toEqual(['bv', 'bt']);

    act(() => services.store.undo());
    expect(partOf(services, 'eyeL')!.assetId).toBe('C');
    expect(services.store.get().model.bindings).toHaveLength(2);
  });

  it('グループには差し替えを出さない', async () => {
    await setup();
    fireEvent.contextMenu(treeRow('head'));
    expect(screen.getByRole('menuitem', { name: '素材を差し替え…' }).hasAttribute('disabled')).toBe(true);
  });
});

describe('描画順', () => {
  it('上が前面。ドラッグで並び替え、親子は変えない', async () => {
    const { services } = await setup();
    fireEvent.click(screen.getByRole('tab', { name: '描画順' }));
    expect(orderIds()).toEqual(['hair', 'eyeL', 'face']);
    const parts = services.store.get().model.parts;
    // 顔を前髪の上半分に落とすと、前髪の前面になる
    stubRect(orderRow('hair'), { top: 0, height: 20 });
    dragTo(orderRow('face'), orderRow('hair'), { clientY: 3 });
    expect(orderIds()).toEqual(['face', 'hair', 'eyeL']);
    expect(services.store.get().model.drawOrder).toEqual(['eyeL', 'hair', 'face']);
    expect(services.store.get().model.parts).toBe(parts);
  });

  it('グループを選ぶと、子孫の画像パーツを相対順のまま一緒に動かす', async () => {
    const { services } = await setup();
    fireEvent.click(screen.getByRole('tab', { name: '描画順' }));
    fireEvent.change(screen.getByLabelText('グループで選ぶ'), { target: { value: 'head' } });
    expect(services.editor.get().selectedPartIds).toEqual(['head']);
    expect(orderRow('face').getAttribute('aria-selected')).toBe('true');
    expect(orderRow('eyeL').getAttribute('aria-selected')).toBe('true');
    expect(orderRow('hair').getAttribute('aria-selected')).toBe('false');
    // 上半分に落とすと前面。顔と白目 L が相対順のまま前髪の前面へ
    stubRect(orderRow('hair'), { top: 0, height: 20 });
    dragTo(orderRow('eyeL'), orderRow('hair'), { clientY: 2 });
    expect(services.store.get().model.drawOrder).toEqual(['hair', 'face', 'eyeL']);
    expect(orderIds()).toEqual(['eyeL', 'face', 'hair']);
    // 下半分に落とすと背面
    stubRect(orderRow('hair'), { top: 0, height: 20 });
    dragTo(orderRow('face'), orderRow('hair'), { clientY: 15 });
    expect(services.store.get().model.drawOrder).toEqual(['face', 'eyeL', 'hair']);
  });
});

describe('マスク', () => {
  it('画像パーツを選ぶとマスク元を選べ、「なし」に戻せる。下にほかのカードのセクションが入る', async () => {
    registerPanelSection({ id: 't.section', panelId: 'partSettings', component: () => <p>ほかのカードの設定</p> });
    const { services } = await setup();
    expect(screen.getByText('パーツを選ぶと設定が出る')).toBeTruthy();
    expect(screen.getByText('ほかのカードの設定')).toBeTruthy();

    fireEvent.click(treeRow('eyeL'));
    const select = screen.getByLabelText('マスク') as HTMLSelectElement;
    // 自身は除き、前面から順
    expect([...select.options].map((o) => o.textContent)).toEqual(['なし', '前髪', '顔']);
    fireEvent.change(select, { target: { value: 'face' } });
    expect(partOf(services, 'eyeL')!.mask).toEqual({ sourcePartIds: ['face'], inverted: false });
    expect((screen.getByLabelText('マスク') as HTMLSelectElement).value).toBe('face');
    fireEvent.change(screen.getByLabelText('マスク'), { target: { value: '' } });
    expect(partOf(services, 'eyeL')!.mask).toBeNull();

    // グループにはマスクを出さない
    fireEvent.click(treeRow('head'));
    expect(screen.queryByLabelText('マスク')).toBeNull();
    expect(screen.getByText('ほかのカードの設定')).toBeTruthy();
  });
});

describe('Undo', () => {
  it('構造・描画順・マスクの操作はすべて Undo で最初に戻る', async () => {
    const { services, initial } = await setup();
    dragTo(treeRow('hair'), treeRow('head'));
    fireEvent.click(within(treeRow('face') as HTMLElement).getByRole('button', { name: '表示' }));
    openMenu('face', 'コピー');
    fireEvent.click(treeRow('eyeL'));
    fireEvent.change(screen.getByLabelText('マスク'), { target: { value: 'face' } });
    openMenu('hair', '削除');
    fireEvent.click(screen.getByRole('tab', { name: '描画順' }));
    dragTo(orderRow('face'), orderRow('eyeL'));
    expect(services.store.get()).not.toBe(initial);
    for (let i = 0; i < 6; i++) act(() => services.store.undo());
    expect(services.store.get()).toBe(initial);
  });
});
