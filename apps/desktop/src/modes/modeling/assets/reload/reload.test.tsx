import { act, fireEvent, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { newId, type Asset, type Binding, type Vec2 } from '@app/schema';
import type { Command, ImportWarning, ImportedAsset, Importer, Services } from '@app/contracts';
import { registry } from '../../../../shell/registry';
import { emitAppEvent } from '../../../../shell/api';
import { register as registerAssets } from '../index';
import { assignAssets, importAssetFiles } from '../actions';
import { importWarningsOf } from '../warnings';
import { pngBytes, renderShell, testServices } from '../testShell';
import { register } from './index';
import { reloadPsd } from './actions';

beforeEach(() => {
  registry.reset();
  registerAssets();
  register();
});

// ---- 仮の PSD の取り込み（PSD の中身は io のテストで確かめる。ここではファイル名ごとに決めたレイヤーを返す） ----

interface FakeLayer {
  name: string;
  path?: string[];
  rect: [x: number, y: number, width: number, height: number];
  hash: string;
  blend?: Asset['sourceBlendMode'];
}

const PSD_HEAD = [0x38, 0x42, 0x50, 0x53]; // '8BPS'
const psdBytes = () => new Uint8Array([...PSD_HEAD, 0, 1]);
const psdFile = (name: string) => new File([psdBytes()], name);

function fakePsdImporter(files: Record<string, FakeLayer[]>, warnings: ImportWarning[] = []): Importer {
  return {
    async importFiles(list) {
      const assets: ImportedAsset[] = [];
      for (const file of list) {
        for (const [i, l] of (files[file.name] ?? []).entries()) {
          const id = newId();
          const [x, y, width, height] = l.rect;
          assets.push({
            asset: {
              id,
              path: `assets/${id}.png`,
              hash: l.hash,
              width,
              height,
              offset: { x, y },
              canvasSize: { width: 1200, height: 1000 },
              source: { kind: 'psd', file: file.name, layerName: l.name, layerPath: l.path ?? ['顔'], hidden: false },
              sourceBlendMode: l.blend ?? 'normal',
              sourceOpacity: 1,
            },
            png: pngBytes(width, height, i),
          });
        }
      }
      const ids = assets.map((a) => a.asset.id);
      return { assets, warnings: warnings.map((w) => ({ ...w, assetIds: ids.slice(0, 1) })) };
    },
  };
}

const V1: FakeLayer[] = [
  { name: '白目', rect: [600, 300, 10, 10], hash: 'white' },
  { name: '瞳', rect: [602, 302, 6, 6], hash: 'iris' },
  { name: '口', rect: [650, 400, 30, 10], hash: 'mouth' },
  { name: '消える', rect: [0, 900, 5, 5], hash: 'gone' },
];
// 白目はそのまま、瞳は絵だけ、口は大きさを変えた。眉を足し、「消える」を消した
const V2: FakeLayer[] = [
  { name: '白目', rect: [600, 300, 10, 10], hash: 'white' },
  { name: '瞳', rect: [602, 302, 6, 6], hash: 'iris-2' },
  { name: '口', rect: [650, 400, 40, 12], hash: 'mouth-2' },
  { name: '眉', rect: [600, 250, 12, 3], hash: 'brow' },
];
const BODY: FakeLayer[] = [{ name: '体', path: [], rect: [100, 200, 20, 30], hash: 'body' }];

const DELTAS: Vec2[] = [
  { x: 1, y: 0 },
  { x: 2, y: 0 },
  { x: 2, y: 3 },
  { x: 1, y: 3 },
];

// 頂点のキーを足す
function addVertexKeys(meshId: string): Command {
  const binding: Binding = {
    id: 'bMouth',
    target: { type: 'mesh', id: meshId },
    channel: 'vertices',
    parameterIds: ['MouthOpenY'],
    keyValues: [[0, 1]],
    keys: [{ coords: [1], delta: DELTAS, source: 'manual', locked: false }],
    generation: 'linear',
    divisions: null,
  };
  return {
    label: 'キー',
    apply: (p) => ({ ...p, model: { ...p.model, bindings: [...p.model.bindings, binding] } }),
  };
}

const byName = (services: Services, name: string, file = 'model.psd') =>
  services.store.get().assets.find((a) => a.source.layerName === name && a.source.file === file)!;
const partOf = (services: Services, assetId: string) =>
  services.store.get().model.parts.find((p) => p.assetId === assetId)!;

// model.psd（と body.psd）を取り込み、白目・瞳・口・消えるを枠に割り当て、口のメッシュに頂点のキーを付ける
async function setup(options: { warnings?: ImportWarning[]; withBody?: boolean } = {}) {
  const services = testServices({
    importer: fakePsdImporter(
      { 'model.psd': V1, 'model_v2.psd': V2, 'body.psd': BODY, 'body_v2.psd': BODY, 'other.psd': BODY },
      options.warnings,
    ),
  });
  const files = [{ name: 'model.psd', data: psdBytes() }];
  if (options.withBody) files.push({ name: 'body.psd', data: psdBytes() });
  await importAssetFiles(services, files);
  importWarningsOf(services).set([]);
  assignAssets(services, { kind: 'standard', type: 'eyeWhiteL' }, [byName(services, '白目').id]);
  assignAssets(services, { kind: 'standard', type: 'irisL' }, [byName(services, '瞳').id]);
  assignAssets(services, { kind: 'standard', type: 'mouthInside' }, [byName(services, '口').id]);
  assignAssets(services, { kind: 'standard', type: 'browL' }, [byName(services, '消える').id]);
  services.store.dispatch(addVertexKeys(partOf(services, byName(services, '口').id).meshId!));
  return services;
}

describe('reloadPsd（操作）', () => {
  it('同じサイズ・違うサイズ・追加・削除を扱い、結果の一覧を返す', async () => {
    const services = await setup();
    const before = services.store.get();
    const old = Object.fromEntries(before.assets.map((a) => [a.source.layerName!, a])) as Record<string, Asset>;
    const parts = {
      white: partOf(services, old['白目']!.id),
      iris: partOf(services, old['瞳']!.id),
      mouth: partOf(services, old['口']!.id),
      gone: partOf(services, old['消える']!.id),
    };

    const outcome = await reloadPsd(services, { name: 'model_v2.psd', data: psdBytes() }, 'model.psd');
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const after = services.store.get();
    const now = (name: string) => after.assets.find((a) => a.source.layerName === name)!;

    // 結果の一覧
    expect(outcome.summary).toEqual({
      file: 'model_v2.psd',
      updated: [
        { assetId: now('瞳').id, name: '瞳', parts: 1, change: 'image' },
        { assetId: now('口').id, name: '口', parts: 1, change: 'resized' },
      ],
      unchanged: 1,
      added: [{ assetId: now('眉').id, name: '眉', parts: 0 }],
      missing: [{ assetId: old['消える']!.id, name: '消える', parts: 1 }],
      warnings: 0,
    });

    // 素材: 同じ場所で置き換え、眉を最後に足し、消えるは残す
    expect(after.assets.map((a) => [a.source.layerName, a.source.file])).toEqual([
      ['白目', 'model_v2.psd'],
      ['瞳', 'model_v2.psd'],
      ['口', 'model_v2.psd'],
      ['消える', 'model.psd'],
      ['眉', 'model_v2.psd'],
    ]);
    expect(now('白目').id).toBe(old['白目']!.id);
    expect(now('瞳').id).not.toBe(old['瞳']!.id);
    expect(services.assets.getPng(now('瞳').id)).toBeDefined();
    expect(services.assets.getPng(now('眉').id)).toBeDefined();

    // 同じサイズ: assetId だけ。メッシュはそのまま
    expect(partOf(services, now('瞳').id)).toEqual({ ...parts.iris, assetId: now('瞳').id });
    expect(after.model.meshes.find((m) => m.id === parts.iris.meshId)).toBe(
      before.model.meshes.find((m) => m.id === parts.iris.meshId),
    );
    expect(partOf(services, old['白目']!.id)).toBe(parts.white);
    // 違うサイズ: 新しい位置でメッシュを作り直し（仮実装のメッシュ生成は素材の四角形）、キーを転写
    expect(partOf(services, now('口').id)).toEqual({ ...parts.mouth, assetId: now('口').id });
    const mouthMesh = after.model.meshes.find((m) => m.id === parts.mouth.meshId)!;
    expect(mouthMesh.vertices).toEqual([
      { x: 650, y: 400 },
      { x: 690, y: 400 },
      { x: 690, y: 412 },
      { x: 650, y: 412 },
    ]);
    const deltas = after.model.bindings.find((b) => b.id === 'bMouth')!.keys[0]!.delta as Vec2[];
    expect(deltas).toHaveLength(4);
    expect(deltas[0]).toEqual(DELTAS[0]);
    expect(deltas[2]).toEqual(DELTAS[2]);
    // 無くなったレイヤーのパーツは消さない
    expect(partOf(services, old['消える']!.id)).toBe(parts.gone);
    // 新しいレイヤーはトレイに足すだけ（パーツは作らない）
    expect(after.model.parts).toHaveLength(before.model.parts.length);
  });

  it('全体が1回の Undo で戻り、Redo でやり直せる（前の素材の PNG は置き場に残る）', async () => {
    const services = await setup();
    const before = services.store.get();
    const pngs = Object.fromEntries(before.assets.map((a) => [a.id, services.assets.getPng(a.id)]));
    await reloadPsd(services, { name: 'model_v2.psd', data: psdBytes() }, 'model.psd');
    const after = services.store.get();
    expect(after).not.toBe(before);

    services.store.undo();
    expect(services.store.get()).toBe(before);
    for (const a of before.assets) expect(services.assets.getPng(a.id)).toBe(pngs[a.id]);
    services.store.redo();
    expect(services.store.get()).toBe(after);
    services.store.undo();
    expect(services.store.get()).toBe(before);
  });

  it('取り込みの警告をトレイの警告にする', async () => {
    const warning: ImportWarning = { kind: 'needsMerge', assetIds: [], layerNames: ['模様'], message: '' };
    const services = await setup({ warnings: [warning] });
    const outcome = await reloadPsd(services, { name: 'model_v2.psd', data: psdBytes() }, 'model.psd');
    expect(outcome.ok && outcome.summary.warnings).toBe(1);
    expect(
      importWarningsOf(services)
        .get()
        .map((w) => w.layerNames),
    ).toEqual([['模様']]);
  });

  it('選んだ PSD から取り込んだ素材だけを対象にする', async () => {
    const services = await setup({ withBody: true });
    const body = byName(services, '体', 'body.psd');
    const outcome = await reloadPsd(services, { name: 'model_v2.psd', data: psdBytes() }, 'model.psd');
    expect(outcome.ok && outcome.summary.missing.map((m) => m.name)).toEqual(['消える']);
    expect(byName(services, '体', 'body.psd')).toBe(body);
  });

  it('PSD でない・その PSD の素材が無い・同じレイヤーが1つも無いときは何も変えずに理由を返す', async () => {
    const services = await setup();
    const before = services.store.get();
    const png = await reloadPsd(services, { name: 'a.png', data: pngBytes(2, 2) }, 'model.psd');
    expect(png).toEqual({ ok: false, error: expect.stringContaining('PSD ではない') });
    const none = await reloadPsd(services, { name: 'model_v2.psd', data: psdBytes() }, 'nothing.psd');
    expect(none).toEqual({ ok: false, error: 'nothing.psd から取り込んだ素材が無い' });
    const other = await reloadPsd(services, { name: 'other.psd', data: psdBytes() }, 'model.psd');
    expect(other).toEqual({ ok: false, error: expect.stringContaining('同じレイヤーが無い') });
    expect(services.store.get()).toBe(before);
    expect(services.store.canRedo()).toBe(false);
  });

  it('作り直すメッシュの画像が無ければ何も変えない', async () => {
    const services = await setup();
    const before = services.store.get();
    const known = new Set(before.assets.map((a) => a.id));
    const repo = services.assets;
    const noImage: Services = {
      ...services,
      assets: { ...repo, getImageData: (id: string) => (known.has(id) ? repo.getImageData(id) : undefined) },
    };
    const outcome = await reloadPsd(noImage, { name: 'model_v2.psd', data: psdBytes() }, 'model.psd');
    expect(outcome).toEqual({ ok: false, error: '素材の画像を読み込めなかった: 口' });
    expect(services.store.get()).toBe(before);
  });
});

// ---- 画面 ----

const reloadButton = () => screen.queryByRole('button', { name: 'PSD を読み込み直す' });
const pickPsd = (name: string) =>
  fireEvent.change(screen.getByLabelText('読み込み直す PSD ファイル'), { target: { files: [psdFile(name)] } });

describe('素材トレイの [PSD を読み込み直す]', () => {
  it('PSD の素材が無ければ出さない', async () => {
    const services = testServices();
    renderShell(services);
    await act(async () => {
      await importAssetFiles(services, [{ name: 'a.png', data: pngBytes(8, 8) }]);
    });
    expect(document.querySelectorAll('.asset-row')).toHaveLength(1);
    expect(reloadButton()).toBeNull();
  });

  it('読み込み直すと結果（更新・追加・見つからない）を出し、トレイが新しくなる。1回の Undo で戻る', async () => {
    const services = await setup();
    const before = services.store.get();
    renderShell(services);
    expect(reloadButton()).toBeTruthy();
    expect(screen.queryByRole('combobox', { name: '読み込み直す PSD' })).toBeNull();

    pickPsd('model_v2.psd');
    const result = await screen.findByRole('status', { name: '再読み込みの結果' });
    expect(within(result).getByText('model_v2.psd を読み込み直した')).toBeTruthy();
    const group = (kind: string) => result.querySelector(`[data-reload-group="${kind}"]`) as HTMLElement;
    expect(within(group('updated')).getByText('更新')).toBeTruthy();
    expect(group('updated').textContent).toContain('瞳：絵を差し替えた');
    expect(group('updated').textContent).toContain('口：大きさが変わった（メッシュを作り直して変形を移した）');
    expect(group('added').textContent).toContain('眉');
    expect(group('missing').textContent).toContain('消える：パーツ 1 個で使っている');
    expect(within(result).getByText('変わらない: 1 個')).toBeTruthy();

    // トレイの並び（新しいファイル名のフォルダと、残った前のファイルのフォルダ）
    const rows = () => [...document.querySelectorAll('.asset-row .asset-name')].map((e) => e.textContent);
    expect(rows()).toEqual(['白目', '瞳', '口', '眉', '消える']);
    expect(screen.getByRole('button', { name: /model_v2\.psd$/ })).toBeTruthy();

    act(() => services.store.undo());
    expect(services.store.get()).toBe(before);
    expect(rows()).toEqual(['白目', '瞳', '口', '消える']);

    fireEvent.click(within(result).getByRole('button', { name: '結果を閉じる' }));
    expect(screen.queryByRole('status', { name: '再読み込みの結果' })).toBeNull();
  });

  it('PSD が2つ以上なら、読み込み直す PSD を選べる', async () => {
    const services = await setup({ withBody: true });
    renderShell(services);
    const select = screen.getByRole('combobox', { name: '読み込み直す PSD' }) as HTMLSelectElement;
    expect([...select.options].map((o) => o.value)).toEqual(['model.psd', 'body.psd']);
    fireEvent.change(select, { target: { value: 'body.psd' } });
    pickPsd('body_v2.psd');
    const result = await screen.findByRole('status', { name: '再読み込みの結果' });
    expect(within(result).getByText('body_v2.psd を読み込み直した')).toBeTruthy();
    expect(within(result).getByText('変わらない: 1 個')).toBeTruthy();
    expect(services.store.get().assets.map((a) => a.source.file)).toEqual([
      'model.psd',
      'model.psd',
      'model.psd',
      'model.psd',
      'body_v2.psd',
    ]);
    // 素材は新しいファイル名になるので、次もそれを選んでおく
    expect([...select.options].map((o) => o.value)).toEqual(['model.psd', 'body_v2.psd']);
    expect(select.value).toBe('body_v2.psd');
    // 選んでいた PSD の素材が無くなったら（Undo など）、最初の PSD にする
    act(() => services.store.undo());
    expect([...select.options].map((o) => o.value)).toEqual(['model.psd', 'body.psd']);
    expect(select.value).toBe('model.psd');
  });

  it('読み込み直せないときは通知で知らせ、何も変えない。開き直したら結果を消す', async () => {
    const services = await setup();
    const before = services.store.get();
    renderShell(services);
    pickPsd('other.psd');
    expect(await screen.findByText(/同じレイヤーが無い/)).toBeTruthy();
    expect(services.store.get()).toBe(before);

    pickPsd('model_v2.psd');
    await screen.findByRole('status', { name: '再読み込みの結果' });
    act(() => emitAppEvent('projectLoaded', services.store.get()));
    expect(screen.queryByRole('status', { name: '再読み込みの結果' })).toBeNull();
  });
});
