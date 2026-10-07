import { describe, expect, it } from 'vitest';
import type { Asset, Binding, Vec2 } from '@app/schema';
import { counterIds, makeAsset, makeBinding, makeMesh, makePart, makeProject } from '../../structure/testing';
import { reloadPsdCommand, RELOAD_LABEL, type AssetUpdate } from './commands';

const psd = (id: string, layerName: string, fields: Partial<Asset> = {}, file = 'model.psd'): Asset =>
  makeAsset(id, { source: { kind: 'psd', file, layerName, layerPath: ['顔'] }, hash: `h-${id}`, ...fields });

// 素材 width×height・offset の四角形のメッシュ（仮実装のメッシュ生成と同じ形）
const rect = (offset: Vec2, width: number, height: number) => ({
  vertices: [
    { x: offset.x, y: offset.y },
    { x: offset.x + width, y: offset.y },
    { x: offset.x + width, y: offset.y + height },
    { x: offset.x, y: offset.y + height },
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
  ] as [number, number, number][],
});

const DELTAS: Vec2[] = [
  { x: 1, y: 0 },
  { x: 2, y: 0 },
  { x: 2, y: 3 },
  { x: 1, y: 3 },
];
const keys = (): Binding['keys'] => [{ coords: [1], delta: DELTAS, source: 'manual', locked: false }];

const OLD = {
  eye: psd('eye', '目', { width: 10, height: 10, offset: { x: 600, y: 300 } }),
  mouth: psd('mouth', '口', { width: 30, height: 10, offset: { x: 650, y: 400 } }),
  brow: psd('brow', '眉', { width: 12, height: 4, offset: { x: 600, y: 250 } }),
  body: psd('body', '体', { width: 20, height: 30, offset: { x: 100, y: 200 } }),
  gone: psd('gone', '消える'),
  other: makeAsset('png'),
};

function project() {
  return makeProject({
    assets: Object.values(OLD),
    parts: [
      makePart('pEye', { assetId: 'eye', meshId: 'mEye' }),
      makePart('pMouth', { assetId: 'mouth', meshId: 'mMouth' }),
      makePart('pBrow', { assetId: 'brow', meshId: 'mBrow' }),
      makePart('pBody', { assetId: 'body', meshId: 'mBody' }),
      makePart('pGone', { assetId: 'gone', meshId: null }),
    ],
    meshes: [
      makeMesh('mEye', rect(OLD.eye.offset, 10, 10)),
      makeMesh('mMouth', { ...rect(OLD.mouth.offset, 30, 10), density: 'smooth' }),
      makeMesh('mBrow', { ...rect(OLD.brow.offset, 12, 4), edited: true }),
      makeMesh('mBody', rect(OLD.body.offset, 20, 30)),
    ],
    bindings: [
      makeBinding('bEye', { target: { type: 'mesh', id: 'mEye' }, channel: 'vertices', keys: keys() }),
      makeBinding('bMouth', { target: { type: 'mesh', id: 'mMouth' }, channel: 'vertices', keys: keys() }),
      makeBinding('bBrow', { target: { type: 'mesh', id: 'mBrow' }, channel: 'vertices', keys: keys() }),
    ],
  });
}

const NEXT = {
  eye: psd('eye2', '目', { width: 10, height: 10, offset: { x: 600, y: 300 } }, 'v2.psd'),
  mouth: psd('mouth2', '口', { width: 40, height: 12, offset: { x: 650, y: 400 } }, 'v2.psd'),
  brow: psd('brow2', '眉', { width: 12, height: 4, offset: { x: 620, y: 240 } }, 'v2.psd'),
  body: { ...OLD.body, source: { ...OLD.body.source, file: 'v2.psd' } },
  added: psd('cheek', '頬', {}, 'v2.psd'),
};

const UPDATES: AssetUpdate[] = [
  { oldId: 'eye', next: NEXT.eye, change: 'image' },
  { oldId: 'mouth', next: NEXT.mouth, change: 'resized' },
  { oldId: 'brow', next: NEXT.brow, change: 'moved' },
  { oldId: 'body', next: NEXT.body, change: 'unchanged' },
];
const MOUTH_MESH = { ...rect(NEXT.mouth.offset, 40, 12), density: 'smooth' as const };

const part = (p: ReturnType<typeof project>, id: string) => p.model.parts.find((x) => x.id === id)!;
const mesh = (p: ReturnType<typeof project>, id: string) => p.model.meshes.find((x) => x.id === id)!;
const binding = (p: ReturnType<typeof project>, id: string) => p.model.bindings.find((x) => x.id === id)!;

describe('reloadPsdCommand', () => {
  const before = project();
  const after = reloadPsdCommand({ updates: UPDATES, added: [NEXT.added], meshes: { pMouth: MOUTH_MESH } }).apply(
    before,
  );

  it('素材を同じ場所で置き換え、新しいレイヤーを最後に足す（無くなったレイヤーの素材は残す）', () => {
    expect(RELOAD_LABEL).toBe('PSD の再読み込み');
    expect(after.assets).toEqual([NEXT.eye, NEXT.mouth, NEXT.brow, NEXT.body, OLD.gone, OLD.other, NEXT.added]);
    expect(part(after, 'pGone')).toBe(part(before, 'pGone'));
  });

  it('同じサイズ（位置も同じ）なら assetId だけを替える。メッシュとキーはそのまま', () => {
    expect(part(after, 'pEye')).toEqual({ ...part(before, 'pEye'), assetId: 'eye2' });
    expect(mesh(after, 'mEye')).toBe(mesh(before, 'mEye'));
    expect(binding(after, 'bEye')).toBe(binding(before, 'bEye'));
  });

  it('違うサイズなら新しい位置でメッシュを作り直し、変形を転写する', () => {
    expect(part(after, 'pMouth')).toEqual({ ...part(before, 'pMouth'), assetId: 'mouth2' });
    expect(mesh(after, 'mMouth')).toEqual({ id: 'mMouth', ...MOUTH_MESH, edited: false });
    const deltas = binding(after, 'bMouth').keys[0]!.delta as Vec2[];
    // 旧いメッシュ（650..680 × 400..410）の差分を、同じキャンバスの位置の新しい頂点へ移す（外の点はいちばん近い所）
    expect(deltas).toHaveLength(4);
    expect(deltas[0]).toEqual(DELTAS[0]);
    expect(deltas[2]).toEqual(DELTAS[2]);
  });

  it('同じサイズで位置が違えば、メッシュを位置の差だけずらす（手で編集した形とキーはそのまま）', () => {
    expect(part(after, 'pBrow')).toEqual({ ...part(before, 'pBrow'), assetId: 'brow2', pivot: { x: 20, y: -10 } });
    const shifted = mesh(after, 'mBrow');
    expect(shifted.vertices).toEqual(rect({ x: 620, y: 240 }, 12, 4).vertices);
    expect(shifted.uvs).toBe(mesh(before, 'mBrow').uvs);
    expect(shifted.edited).toBe(true);
    expect(binding(after, 'bBrow')).toBe(binding(before, 'bBrow'));
  });

  it('変わらない素材は id のまま記録だけ新しくし、パーツとメッシュは触らない', () => {
    expect(after.assets[3]).toBe(NEXT.body);
    expect(part(after, 'pBody')).toBe(part(before, 'pBody'));
    expect(mesh(after, 'mBody')).toBe(mesh(before, 'mBody'));
  });

  it('メッシュの無いパーツで大きさが違えば、メッシュを新しく付ける', () => {
    const p = makeProject({ assets: [OLD.mouth], parts: [makePart('q', { assetId: 'mouth', meshId: null })] });
    const next = reloadPsdCommand(
      { updates: [UPDATES[1]!], added: [], meshes: { q: MOUTH_MESH } },
      { newId: counterIds('mesh') },
    ).apply(p);
    expect(part(next, 'q')).toMatchObject({ assetId: 'mouth2', meshId: 'mesh1' });
    expect(next.model.meshes).toEqual([{ id: 'mesh1', ...MOUTH_MESH, edited: false }]);
  });

  it('同じメッシュを使う2つのパーツでも、ずらすのは1回', () => {
    const p = makeProject({
      assets: [OLD.brow],
      parts: [makePart('a', { assetId: 'brow', meshId: 'm' }), makePart('b', { assetId: 'brow', meshId: 'm' })],
      meshes: [makeMesh('m', rect(OLD.brow.offset, 12, 4))],
    });
    const next = reloadPsdCommand({ updates: [UPDATES[2]!], added: [], meshes: {} }).apply(p);
    expect(next.model.parts.map((x) => x.assetId)).toEqual(['brow2', 'brow2']);
    expect(mesh(next, 'm').vertices[0]).toEqual({ x: 620, y: 240 });
  });

  it('パーツの合成モードが前のレイヤーのままなら、新しいレイヤーの合成モードに合わせる（変えてあれば残す）', () => {
    const p = makeProject({
      assets: [OLD.eye, OLD.body],
      parts: [
        makePart('a', { assetId: 'eye', blendMode: 'normal' }),
        makePart('b', { assetId: 'eye', blendMode: 'screen' }),
        makePart('c', { assetId: 'body', blendMode: 'normal' }),
      ],
    });
    const next = reloadPsdCommand({
      updates: [
        { ...UPDATES[0]!, next: { ...NEXT.eye, sourceBlendMode: 'multiply' } },
        { ...UPDATES[3]!, next: { ...NEXT.body, sourceBlendMode: 'add' } },
      ],
      added: [],
      meshes: {},
    }).apply(p);
    expect(next.model.parts.map((x) => [x.assetId, x.blendMode])).toEqual([
      ['eye2', 'multiply'],
      ['eye2', 'screen'],
      ['body', 'add'],
    ]);
  });

  it('プロジェクトに無い素材の更新と、もうある素材の追加は飛ばす。何も無ければ同じプロジェクトを返す', () => {
    const p = makeProject({ assets: [OLD.other] });
    expect(reloadPsdCommand({ updates: UPDATES, added: [OLD.other], meshes: {} }).apply(p)).toBe(p);
  });
});
