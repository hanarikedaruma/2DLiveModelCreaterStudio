import { describe, expect, it } from 'vitest';
import { writePsdUint8Array, type Layer } from 'ag-psd';
import type { Asset } from '@app/schema';
import { createImporter } from './importer';
import { decodePng, encodePng } from './png';
import {
  assetsFromPsd,
  hasOpaquePixelsOutsideMesh,
  layerChange,
  layerKey,
  matchLayers,
  planPsdReload,
  psdSourceFiles,
  type PsdReloadPlan,
} from './reload';
import { makeImage, pixelAt, toPixelData, type Rgba } from './testImages';

const RED: Rgba = [255, 0, 0, 255];
const GREEN: Rgba = [0, 255, 0, 255];
const BLUE: Rgba = [0, 0, 255, 255];

function asset(id: string, layerName: string | undefined, layerPath: string[], fields: Partial<Asset> = {}): Asset {
  return {
    id,
    path: `assets/${id}.png`,
    hash: id,
    width: 10,
    height: 10,
    offset: { x: 0, y: 0 },
    canvasSize: { width: 1000, height: 1000 },
    source: { kind: 'psd', file: 'model.psd', ...(layerName !== undefined ? { layerName } : {}), layerPath },
    sourceBlendMode: 'normal',
    sourceOpacity: 1,
    ...fields,
  };
}

const ids = (list: readonly Asset[]) => list.map((a) => a.id);
const pairIds = (pairs: { old: Asset; next: Asset }[]) => pairs.map((p) => [p.old.id, p.next.id]);

describe('再読み込みの画素とメッシュ（カード62）', () => {
  const mesh = {
    vertices: [
      { x: 10, y: 20 },
      { x: 12, y: 20 },
      { x: 10, y: 22 },
    ],
    triangles: [[0, 1, 2] as [number, number, number]],
  };
  it('三角形の外へ描き足した画素を見つけ、透明な余白は知らせない', () => {
    const image = makeImage(2, 2, RED, { x: 0, y: 0, width: 1, height: 1 });
    expect(hasOpaquePixelsOutsideMesh(image, { x: 10, y: 20 }, mesh)).toBe(false);
    image.data[(1 * 2 + 1) * 4 + 3] = 255;
    expect(hasOpaquePixelsOutsideMesh(image, { x: 10, y: 20 }, mesh)).toBe(true);
  });
  it('位置がずれた画像もキャンバス座標で比較し、同じだけずらしたメッシュなら覆う', () => {
    const image = makeImage(2, 2, RED, { x: 0, y: 0, width: 1, height: 1 });
    expect(hasOpaquePixelsOutsideMesh(image, { x: 20, y: 30 }, mesh)).toBe(true);
    expect(
      hasOpaquePixelsOutsideMesh(
        image,
        { x: 20, y: 30 },
        {
          ...mesh,
          vertices: mesh.vertices.map((v) => ({ x: v.x + 10, y: v.y + 10 })),
        },
      ),
    ).toBe(false);
  });
});

describe('matchLayers', () => {
  it('layerPath と layerName が同じものを対応させ、新しいレイヤーと無くなったレイヤーを分ける', () => {
    const old = [asset('a', '体', []), asset('b', '目', ['顔']), asset('c', '消える', ['顔'])];
    const next = [asset('x', '目', ['顔']), asset('y', '体', []), asset('z', '眉', ['顔'])];
    const m = matchLayers(old, next);
    expect(pairIds(m.pairs)).toEqual([
      ['b', 'x'],
      ['a', 'y'],
    ]);
    expect(ids(m.added)).toEqual(['z']);
    expect(ids(m.missing)).toEqual(['c']);
  });

  it('同じ名前でもグループが違えば別のレイヤー', () => {
    const old = [asset('a', '目', ['顔', '左']), asset('b', '目', ['顔', '右'])];
    const next = [asset('x', '目', ['顔', '右']), asset('y', '目', ['顔']), asset('z', '目', ['顔', '左'])];
    const m = matchLayers(old, next);
    expect(pairIds(m.pairs)).toEqual([
      ['b', 'x'],
      ['a', 'z'],
    ]);
    expect(ids(m.added)).toEqual(['y']);
    expect(ids(m.missing)).toEqual([]);
  });

  it('グループの道筋は区切りを含めて比べる（["a/b"] と ["a", "b"] は別）', () => {
    const m = matchLayers([asset('a', '目', ['顔/左'])], [asset('x', '目', ['顔', '左'])]);
    expect(m.pairs).toEqual([]);
    expect(layerKey(asset('a', '目', ['顔/左']))).not.toBe(layerKey(asset('x', '目', ['顔', '左'])));
  });

  it('名前が重なるときは元の順番で対応させ、余りは追加・見つからないにする', () => {
    const old = [asset('a1', 'レイヤー 1', ['髪']), asset('b', '前髪', ['髪']), asset('a2', 'レイヤー 1', ['髪'])];
    const more = [
      asset('x1', 'レイヤー 1', ['髪']),
      asset('x2', 'レイヤー 1', ['髪']),
      asset('y', '前髪', ['髪']),
      asset('x3', 'レイヤー 1', ['髪']),
    ];
    const m = matchLayers(old, more);
    expect(pairIds(m.pairs)).toEqual([
      ['a1', 'x1'],
      ['a2', 'x2'],
      ['b', 'y'],
    ]);
    expect(ids(m.added)).toEqual(['x3']);

    const fewer = matchLayers(old, [asset('x1', 'レイヤー 1', ['髪'])]);
    expect(pairIds(fewer.pairs)).toEqual([['a1', 'x1']]);
    expect(ids(fewer.missing)).toEqual(['b', 'a2']);
  });

  it('レイヤー名の無い素材（レイヤーの無い PSD の統合画像）どうしも対応する', () => {
    const m = matchLayers([asset('a', undefined, [])], [asset('x', undefined, [])]);
    expect(pairIds(m.pairs)).toEqual([['a', 'x']]);
  });

  it('どちらかが空なら、すべて追加かすべて見つからない', () => {
    expect(ids(matchLayers([], [asset('x', '目', [])]).added)).toEqual(['x']);
    expect(ids(matchLayers([asset('a', '目', [])], []).missing)).toEqual(['a']);
  });
});

describe('layerChange', () => {
  const base = asset('a', '目', [], { hash: 'h', width: 10, height: 20, offset: { x: 5, y: 6 } });
  it('大きさ → 位置 → 画素の順に見る', () => {
    expect(layerChange(base, { ...base, id: 'b' })).toBe('unchanged');
    expect(layerChange(base, { ...base, hash: 'g' })).toBe('image');
    expect(layerChange(base, { ...base, offset: { x: 6, y: 6 } })).toBe('moved');
    expect(layerChange(base, { ...base, hash: 'g', offset: { x: 5, y: 7 } })).toBe('moved');
    expect(layerChange(base, { ...base, width: 11, offset: { x: 0, y: 0 } })).toBe('resized');
    expect(layerChange(base, { ...base, height: 19 })).toBe('resized');
  });
});

describe('psdSourceFiles・assetsFromPsd', () => {
  it('PSD のファイル名を並びの順に重なりなく返し、そのファイルの素材だけを選ぶ', () => {
    const png = { ...asset('p', undefined, []), source: { kind: 'png' as const, file: 'a.png' } };
    const list = [
      asset('a', '目', []),
      png,
      { ...asset('b', '体', []), source: { kind: 'psd' as const, file: 'body.psd', layerName: '体', layerPath: [] } },
      asset('c', '口', []),
    ];
    expect(psdSourceFiles(list)).toEqual(['model.psd', 'body.psd']);
    expect(ids(assetsFromPsd(list, 'model.psd'))).toEqual(['a', 'c']);
    expect(ids(assetsFromPsd(list, 'a.png'))).toEqual([]);
  });
});

// ---- 本物の取り込みを通す ----

// 透明なレイヤーの中に塗った矩形を置く
function layer(
  name: string,
  bounds: [left: number, top: number, width: number, height: number],
  color: Rgba,
  extra: Partial<Layer> = {},
): Layer {
  const [left, top, width, height] = bounds;
  return {
    name,
    left,
    top,
    right: left + width,
    bottom: top + height,
    imageData: toPixelData(makeImage(width, height, color)),
    ...extra,
  };
}

function psd(children: Layer[], size = { width: 1200, height: 1000 }): Uint8Array {
  return writePsdUint8Array({ ...size, children });
}

// 前に取り込んだ PSD
const V1 = psd([
  layer('体', [100, 200, 20, 30], RED),
  {
    name: '顔',
    children: [
      layer('目', [600, 300, 10, 10], RED),
      layer('目', [700, 300, 10, 10], RED),
      layer('口', [650, 400, 30, 10], RED),
      layer('模様', [0, 0, 4, 4], RED, { blendMode: 'overlay' }),
    ],
  },
  layer('消える', [0, 900, 5, 5], RED),
]);

// 直した PSD: 体と模様はそのまま、1つめの目は色だけ、2つめの目は位置だけ、口は大きさを変えてクリッピングの影を付けた。
// 眉と、グループの外の目を足し、「消える」を消した
const V2_LAYERS: Layer[] = [
  layer('体', [100, 200, 20, 30], RED),
  {
    name: '顔',
    children: [
      layer('目', [600, 300, 10, 10], GREEN),
      layer('目', [720, 310, 10, 10], RED),
      layer('口', [650, 400, 40, 12], RED),
      layer('口の影', [650, 400, 10, 12], BLUE, { clipping: true }),
      layer('模様', [0, 0, 4, 4], RED, { blendMode: 'overlay' }),
      layer('眉', [600, 250, 12, 3], RED),
    ],
  },
  layer('目', [10, 10, 3, 3], RED),
];

async function importV1(): Promise<Asset[]> {
  const { assets } = await createImporter().importFiles([{ name: 'model.psd', data: V1 }]);
  return assets.map((a) => a.asset);
}

function layerOf(plan: PsdReloadPlan, oldId: string) {
  const found = plan.layers.find((l) => l.old.id === oldId);
  if (!found) throw new Error(`対応が無い: ${oldId}`);
  return found;
}

describe('planPsdReload（ag-psd で作った PSD）', () => {
  it('同じ処理で取り込み直し、レイヤーごとに変わったところを分ける', async () => {
    const old = await importV1();
    expect(old.map((a) => a.source.layerName)).toEqual(['体', '目', '目', '口', '模様', '消える']);
    const [body, eye1, eye2, mouth, pattern, gone] = old as [Asset, Asset, Asset, Asset, Asset, Asset];

    const plan = await planPsdReload({ name: 'model_v2.psd', data: psd(V2_LAYERS) }, old);
    expect(plan.file).toBe('model_v2.psd');
    expect(plan.layers.map((l) => [l.old.id, l.change])).toEqual([
      [body.id, 'unchanged'],
      [eye1.id, 'image'],
      [eye2.id, 'moved'],
      [mouth.id, 'resized'],
      [pattern.id, 'unchanged'],
    ]);
    expect(plan.added.map((a) => [a.asset.source.layerName, a.asset.source.layerPath])).toEqual([
      ['眉', ['顔']],
      ['目', []],
    ]);
    expect(ids(plan.missing)).toEqual([gone.id]);

    // 変わらないものは id・パス・画素をそのままに、ファイル名だけ新しくする
    const same = layerOf(plan, body.id).next;
    expect(same).toEqual({ ...body, source: { ...body.source, file: 'model_v2.psd' } });

    // 変わったものは新しい id の素材
    const eye = layerOf(plan, eye1.id);
    expect(eye.next.id).not.toBe(eye1.id);
    expect(eye.next.path).toBe(`assets/${eye.next.id}.png`);
    expect(eye.next.source).toEqual({ ...eye1.source, file: 'model_v2.psd' });
    expect(pixelAt(decodePng(eye.png), 0, 0)).toEqual(GREEN);
    expect(layerOf(plan, eye2.id).next.offset).toEqual({ x: 720, y: 310 });

    // クリッピングは最初の取り込みと同じく口に統合されている（口の影は素材にならない）
    const lips = layerOf(plan, mouth.id);
    expect(lips.next).toMatchObject({ width: 40, height: 12, offset: { x: 650, y: 400 } });
    const image = decodePng(lips.png);
    expect(pixelAt(image, 0, 0)).toEqual(BLUE);
    expect(pixelAt(image, 39, 11)).toEqual(RED);
    expect(plan.added.some((a) => a.asset.source.layerName === '口の影')).toBe(false);
  });

  it('警告は取り込みと同じものを出し、変わらない素材は前の id で指す', async () => {
    const old = await importV1();
    const pattern = old.find((a) => a.source.layerName === '模様')!;
    const plan = await planPsdReload({ name: 'model.psd', data: psd(V2_LAYERS) }, old);
    const merge = plan.warnings.find((w) => w.kind === 'needsMerge');
    expect(merge?.assetIds).toEqual([pattern.id]);
    expect(merge?.layerNames).toEqual(['模様']);
    expect(plan.warnings.some((w) => w.kind === 'canvasMismatch')).toBe(false);
  });

  it('キャンバスの大きさが前と違えば canvasMismatch を足す', async () => {
    const old = await importV1();
    const plan = await planPsdReload({ name: 'wide.psd', data: psd(V2_LAYERS, { width: 1300, height: 1000 }) }, old);
    const mismatch = plan.warnings[0]!;
    expect(mismatch.kind).toBe('canvasMismatch');
    expect(mismatch.layerNames).toEqual(['wide.psd']);
    expect(mismatch.message).toContain('1300×1000');
    expect(mismatch.message).toContain('1200×1000');
    expect(mismatch.assetIds).toHaveLength(plan.layers.length + plan.added.length);
    expect(mismatch.assetIds).toContain(old[0]!.id); // 変わらない体は前の id
  });

  it('同じ PSD なら、すべて変わらない', async () => {
    const old = await importV1();
    const plan = await planPsdReload({ name: 'model.psd', data: V1 }, old);
    expect(plan.layers.every((l) => l.change === 'unchanged')).toBe(true);
    expect(plan.layers.map((l) => l.next)).toEqual(old);
    expect(plan.added).toEqual([]);
    expect(plan.missing).toEqual([]);
  });

  it('PSD でなければ読み込み直さない（PNG の再読み込みは無い）', async () => {
    const png = encodePng(makeImage(2, 2, RED));
    await expect(planPsdReload({ name: 'a.png', data: png }, [])).rejects.toThrow('PSD ではない');
  });

  it('渡した importer を使う', async () => {
    const old = await importV1();
    let called = 0;
    const importer = createImporter();
    const plan = await planPsdReload({ name: 'model.psd', data: V1 }, old, {
      importFiles: (files) => {
        called++;
        return importer.importFiles(files);
      },
    });
    expect(called).toBe(1);
    expect(plan.layers).toHaveLength(old.length);
  });
});
