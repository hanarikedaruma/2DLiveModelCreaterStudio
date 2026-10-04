import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeImporter, type ImportWarning, type Importer, type Services } from '@app/contracts';
import type { Asset, Project } from '@app/schema';
import { emitAppEvent } from '../../../shell/api';
import { registry } from '../../../shell/registry';
import { register } from './index';
import { importAssetFiles } from './actions';
import { findAssignment } from './commands';
import { WARNING_TEXT, groupWarnings } from './warnings';
import { dragTo, pngBytes, renderShell, testServices } from './testShell';

beforeEach(() => {
  registry.reset();
  register();
});

const file = (name: string, w: number, h: number) => new File([pngBytes(w, h)], name, { type: 'image/png' });

// FakeImporter に警告を足したもの
function importerWithWarnings(): Importer {
  const inner = new FakeImporter();
  return {
    async importFiles(files) {
      const result = await inner.importFiles(files);
      const ids = result.assets.map((a) => a.asset.id);
      const warnings: ImportWarning[] = [
        { kind: 'needsMerge', assetIds: ids.slice(0, 1), layerNames: ['影（乗算）'], message: '' },
        { kind: 'canvasMismatch', assetIds: ids.slice(1), layerNames: [], message: '' },
        { kind: 'needsMerge', assetIds: [], layerNames: ['光（加算）', '影（乗算）'], message: '' },
      ];
      return { ...result, warnings };
    },
  };
}

// PSD を取り込んだことにする（グループ・非表示の印の確認用）
function psdImporter(): Importer {
  return {
    async importFiles() {
      const asset = (id: string, layerName: string, layerPath: string[], hidden = false): Asset => ({
        id,
        path: `assets/${id}.png`,
        hash: id,
        width: 10,
        height: 10,
        offset: { x: 5, y: 5 },
        canvasSize: { width: 100, height: 100 },
        source: { kind: 'psd', file: 'model.psd', layerName, layerPath, hidden },
        sourceBlendMode: 'normal',
        sourceOpacity: 1,
      });
      return {
        assets: [
          { asset: asset('w', '白目', ['顔', '目']), png: pngBytes(10, 10) },
          { asset: asset('i', '瞳', ['顔', '目'], true), png: pngBytes(10, 10, 1) },
          { asset: asset('f', '輪郭', ['顔']), png: pngBytes(10, 10, 2) },
        ],
        warnings: [],
      };
    },
  };
}

async function withAssets(services: Services, specs: [string, number, number][]) {
  const files = specs.map(([name, w, h], i) => ({ name, data: pngBytes(w, h, i) }));
  await act(async () => {
    await importAssetFiles(services, files);
  });
  return services.store.get().assets;
}

const rowOf = (assetId: string) => document.querySelector(`[data-asset-id="${assetId}"]`)!;
const slotOf = (type: string) => document.querySelector(`[data-slot="${type}"]`)!;

describe('取り込み', () => {
  it('仮実装で、セットアップ画面へのドロップ → 素材トレイに並び、警告が種類ごとに出る', async () => {
    const services = testServices({ importer: importerWithWarnings() });
    renderShell(services);
    expect(screen.getByText('素材を読み込む')).toBeTruthy();
    expect(screen.getByText('素材はまだ無い')).toBeTruthy();
    // セットアップ画面の右側に割り当ての枠が出ている
    expect(slotOf('eyeWhiteL')).toBeTruthy();

    fireEvent.drop(screen.getByTestId('setup-drop'), {
      dataTransfer: { files: [file('face.png', 40, 30), file('eye.png', 20, 10)], types: ['Files'] },
    });

    await waitFor(() => expect(document.querySelectorAll('.asset-row')).toHaveLength(2));
    expect(screen.getByText('face')).toBeTruthy();
    expect(screen.getByText('eye')).toBeTruthy();
    // 取り込んだら中央はキャンバスになる
    expect(screen.queryByText('素材を読み込む')).toBeNull();
    expect(screen.getByTestId('canvas-main')).toBeTruthy();
    // PNG は assets.put で登録してある
    const [face, eye] = services.store.get().assets;
    expect(services.assets.getPng(face!.id)).toBeDefined();
    expect(services.assets.getImageData(eye!.id)).toMatchObject({ width: 20, height: 10 });
    // 警告は種類ごと。needsMerge はレイヤー名の一覧つき
    const alert = screen.getByRole('alert', { name: '取り込みの警告' });
    expect(within(alert).getByText(WARNING_TEXT.needsMerge)).toBeTruthy();
    expect(within(alert).getByText(WARNING_TEXT.canvasMismatch)).toBeTruthy();
    expect(within(alert).getAllByText('影（乗算）')).toHaveLength(1);
    expect(within(alert).getByText('光（加算）')).toBeTruthy();
    expect(screen.getByText('素材を 2 個取り込んだ')).toBeTruthy();
    // プロジェクトを開き直したら警告は消える
    act(() => emitAppEvent('projectLoaded', services.store.get()));
    expect(screen.queryByRole('alert', { name: '取り込みの警告' })).toBeNull();

    // 取り込みは Undo できる（セットアップ画面に戻る）
    act(() => services.store.undo());
    expect(services.store.get().assets).toEqual([]);
    expect(screen.getByText('素材を読み込む')).toBeTruthy();
  });

  it('[素材を追加] から取り込める。PNG でないものだけなら知らせる', async () => {
    const services = testServices();
    renderShell(services);
    const input = screen.getByLabelText('素材を追加');
    fireEvent.change(input, { target: { files: [file('a.png', 8, 8)] } });
    await waitFor(() => expect(services.store.get().assets).toHaveLength(1));
    fireEvent.change(input, { target: { files: [new File([new Uint8Array([1, 2, 3])], 'x.txt')] } });
    await waitFor(() => expect(screen.getByText('取り込める素材が無かった')).toBeTruthy());
    expect(services.store.get().assets).toHaveLength(1);
  });

  it('PSD のグループごとに折りたためて、非表示の印が付く', async () => {
    const services = testServices({ importer: psdImporter() });
    renderShell(services);
    fireEvent.change(screen.getByLabelText('ファイルを選ぶ'), { target: { files: [file('model.psd', 1, 1)] } });
    await waitFor(() => expect(document.querySelectorAll('.asset-row')).toHaveLength(3));
    expect(within(rowOf('i') as HTMLElement).getByText('非表示')).toBeTruthy();
    expect(within(rowOf('w') as HTMLElement).queryByText('非表示')).toBeNull();
    const eyes = screen.getByRole('button', { name: /目$/ });
    expect(eyes.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(eyes);
    expect(document.querySelectorAll('.asset-row')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: /model\.psd$/ }));
    expect(document.querySelectorAll('.asset-row')).toHaveLength(0);
  });

  it('警告のまとめ方', () => {
    expect(
      groupWarnings([
        { kind: 'needsMerge', assetIds: [], layerNames: ['b', 'a'], message: '' },
        { kind: 'resolution', assetIds: [], layerNames: [], message: '' },
        { kind: 'needsMerge', assetIds: [], layerNames: ['a', 'c'], message: '' },
      ]),
    ).toEqual([
      { kind: 'resolution', text: WARNING_TEXT.resolution, layerNames: [] },
      { kind: 'needsMerge', text: WARNING_TEXT.needsMerge, layerNames: ['b', 'a', 'c'] },
    ]);
  });
});

describe('割り当て', () => {
  it('トレイから枠へドラッグするとパーツとメッシュができ、2つ目でグループになる。どれも Undo できる', async () => {
    const services = testServices();
    renderShell(services);
    const [white, white2] = await withAssets(services, [
      ['白目.png', 40, 30],
      ['白目2.png', 20, 10],
    ]);

    dragTo(rowOf(white!.id), slotOf('eyeWhiteL'));
    let model = services.store.get().model;
    const part = model.parts.find((p) => p.standardType === 'eyeWhiteL')!;
    expect(part).toMatchObject({ kind: 'image', name: '白目 L', assetId: white!.id, pivot: { x: 20, y: 15 } });
    // 仮実装のメッシュ生成（素材全体の四角形）で作ったメッシュ
    const mesh = model.meshes.find((m) => m.id === part.meshId)!;
    expect(mesh.vertices).toEqual([
      { x: 0, y: 0 },
      { x: 40, y: 0 },
      { x: 40, y: 30 },
      { x: 0, y: 30 },
    ]);
    expect(model.drawOrder).toEqual([part.id]);
    expect(slotOf('eyeWhiteL').querySelector('.slot-chip-name')!.textContent).toBe('白目');
    // トレイには割り当て先が出る
    expect(within(rowOf(white!.id) as HTMLElement).getByText('白目 L')).toBeTruthy();

    dragTo(rowOf(white2!.id), slotOf('eyeWhiteL'));
    model = services.store.get().model;
    const group = model.parts.find((p) => p.standardType === 'eyeWhiteL')!;
    expect(group.kind).toBe('group');
    expect(model.parts.filter((p) => p.parentId === group.id).map((p) => p.name)).toEqual(['白目', '白目2']);
    expect(model.meshes).toHaveLength(2);

    // 付け替え（ほかの枠へドラッグ）
    dragTo(rowOf(white2!.id), slotOf('eyeWhiteR'));
    model = services.store.get().model;
    expect(findAssignment(model, white2!.id)!.slot.standardType).toBe('eyeWhiteR');
    expect(services.store.get().model.parts.find((p) => p.standardType === 'eyeWhiteL')!.kind).toBe('group');

    // 解除
    fireEvent.click(
      within(slotOf('eyeWhiteR') as HTMLElement).getByRole('button', { name: '「白目2」の割り当てを解除' }),
    );
    expect(findAssignment(services.store.get().model, white2!.id)).toBeNull();

    // すべて Undo で戻る
    act(() => services.store.undo()); // 解除
    expect(findAssignment(services.store.get().model, white2!.id)!.slot.standardType).toBe('eyeWhiteR');
    act(() => services.store.undo()); // 付け替え
    act(() => services.store.undo()); // グループ化
    expect(services.store.get().model.parts.map((p) => p.id)).toEqual([part.id]);
    act(() => services.store.undo()); // 割り当て
    expect(services.store.get().model.parts).toEqual([]);
    expect(services.store.get().model.meshes).toEqual([]);
    expect(services.store.get().assets).toHaveLength(2);
  });

  it('Ctrl+クリックで選んだ素材をまとめてドロップするとグループになる', async () => {
    const services = testServices();
    renderShell(services);
    const [a, b, c] = await withAssets(services, [
      ['上唇.png', 10, 10],
      ['下唇.png', 10, 10],
      ['歯.png', 10, 10],
    ]);
    fireEvent.click(rowOf(a!.id));
    fireEvent.click(rowOf(b!.id), { ctrlKey: true });
    expect(rowOf(b!.id).getAttribute('data-selected')).toBe('true');
    dragTo(rowOf(b!.id), slotOf('mouthWhole'));
    const model = services.store.get().model;
    const group = model.parts.find((p) => p.standardType === 'mouthWhole')!;
    expect(group.kind).toBe('group');
    expect(model.parts.filter((p) => p.parentId === group.id).map((p) => p.assetId)).toEqual([a!.id, b!.id]);
    // 選んでいない素材を運ぶと、その1つだけ
    dragTo(rowOf(c!.id), slotOf('teeth'));
    expect(services.store.get().model.parts.find((p) => p.standardType === 'teeth')!.assetId).toBe(c!.id);
  });

  it('ドラッグは少し動かすまで始まらず、枠の外で離したら何もしない', async () => {
    const services = testServices();
    renderShell(services);
    const [a] = await withAssets(services, [['a.png', 10, 10]]);
    const before = services.store.get();
    fireEvent.pointerDown(rowOf(a!.id), { button: 0, clientX: 0, clientY: 0 });
    fireEvent.pointerMove(slotOf('face'), { clientX: 1, clientY: 1 });
    fireEvent.pointerUp(slotOf('face'), { clientX: 1, clientY: 1 });
    expect(services.store.get()).toBe(before);
    dragTo(rowOf(a!.id), document.body);
    expect(services.store.get()).toBe(before);
    expect(document.querySelector('.dnd-ghost')).toBeNull();
  });

  it('「その他」は名前を入れて自由パーツにする', async () => {
    const services = testServices();
    renderShell(services);
    const [a] = await withAssets(services, [['リボン.png', 10, 10]]);
    dragTo(rowOf(a!.id), slotOf('free'));
    const input = await screen.findByDisplayValue('リボン');
    fireEvent.change(input, { target: { value: '髪飾り' } });
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    await waitFor(() => expect(services.store.get().model.parts).toHaveLength(1));
    expect(services.store.get().model.parts[0]).toMatchObject({ name: '髪飾り', standardType: null, assetId: a!.id });
    expect(document.querySelector('[data-free-slot]')!.textContent).toContain('髪飾り');
  });
});

describe('かんたんセットアップ', () => {
  it('plan が呼ばれ、command を1回の Undo で実行し、警告を通知で出す', async () => {
    const plan = vi.fn((_project: Project) => ({
      command: { label: 'セットアップ', apply: (p: Project) => ({ ...p, name: 'セットアップ済み' }) },
      warnings: ['顔の素材が無い', '口の中が無い'],
    }));
    const services = testServices({ autoSetup: { plan } });
    renderShell(services);
    await withAssets(services, [['a.png', 10, 10]]);
    const before = services.store.get();
    fireEvent.click(screen.getByRole('button', { name: 'かんたんセットアップ' }));
    expect(plan).toHaveBeenCalledWith(before);
    expect(services.store.get().name).toBe('セットアップ済み');
    expect(screen.getByText('顔の素材が無い')).toBeTruthy();
    expect(screen.getByText('口の中が無い')).toBeTruthy();
    act(() => services.store.undo());
    expect(services.store.get()).toBe(before);
  });
});
