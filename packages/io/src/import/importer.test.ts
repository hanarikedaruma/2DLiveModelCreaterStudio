import { describe, expect, it } from 'vitest';
import { writePsdUint8Array, type Layer } from 'ag-psd';
import { sha256Hex, type ImportedAsset } from '@app/contracts';
import { createImporter } from './importer';
import { decodePng, encodePng } from './png';
import { makeImage, pixelAt, toPixelData, type Rgba } from './testImages';

const RED: Rgba = [255, 0, 0, 255];

// 透明なレイヤーの中に塗った矩形を置く
function rasterLayer(
  name: string,
  bounds: { left: number; top: number; width: number; height: number },
  filled: { x: number; y: number; width: number; height: number },
  extra: Partial<Layer> = {},
): Layer {
  return {
    name,
    left: bounds.left,
    top: bounds.top,
    right: bounds.left + bounds.width,
    bottom: bounds.top + bounds.height,
    imageData: toPixelData(makeImage(bounds.width, bounds.height, RED, filled)),
    ...extra,
  };
}

function find(assets: ImportedAsset[], layerName: string): ImportedAsset {
  const found = assets.find((a) => a.asset.source.layerName === layerName);
  if (!found) throw new Error(`素材が無い: ${layerName}`);
  return found;
}

describe('PSD の取り込み', () => {
  const psd = writePsdUint8Array({
    width: 1200,
    height: 1000,
    children: [
      rasterLayer('体', { left: 100, top: 200, width: 200, height: 200 }, { x: 50, y: 60, width: 20, height: 30 }),
      {
        name: '頭',
        children: [
          {
            name: '目',
            children: [
              rasterLayer(
                '左目',
                { left: 700, top: 300, width: 10, height: 10 },
                { x: 0, y: 0, width: 10, height: 10 },
              ),
            ],
          },
          rasterLayer(
            '非表示',
            { left: 0, top: 0, width: 8, height: 8 },
            { x: 2, y: 2, width: 3, height: 3 },
            { hidden: true },
          ),
        ],
      },
      rasterLayer(
        '乗算',
        { left: 0, top: 0, width: 4, height: 4 },
        { x: 0, y: 0, width: 4, height: 4 },
        { blendMode: 'multiply' },
      ),
      rasterLayer(
        'スクリーン',
        { left: 0, top: 0, width: 4, height: 4 },
        { x: 0, y: 0, width: 4, height: 4 },
        { blendMode: 'screen' },
      ),
      rasterLayer(
        '加算',
        { left: 0, top: 0, width: 4, height: 4 },
        { x: 0, y: 0, width: 4, height: 4 },
        { blendMode: 'linear dodge' },
      ),
      rasterLayer(
        'オーバーレイ',
        { left: 0, top: 0, width: 4, height: 4 },
        { x: 0, y: 0, width: 4, height: 4 },
        { blendMode: 'overlay' },
      ),
      rasterLayer(
        '半透明',
        { left: 0, top: 0, width: 4, height: 4 },
        { x: 0, y: 0, width: 4, height: 4 },
        { opacity: 0.4 },
      ),
      rasterLayer(
        '縁取り',
        { left: 0, top: 0, width: 4, height: 4 },
        { x: 0, y: 0, width: 4, height: 4 },
        {
          effects: { stroke: [{ enabled: true, size: { units: 'Pixels', value: 2 } }] },
        },
      ),
      rasterLayer(
        'スマート',
        { left: 0, top: 0, width: 4, height: 4 },
        { x: 0, y: 0, width: 4, height: 4 },
        {
          placedLayer: {
            id: '20953ddb-9391-11ec-b4f1-c15674f50bc4',
            placed: '20953ddb-9391-11ec-b4f1-c15674f50bc4',
            type: 'raster',
            transform: [0, 0, 4, 0, 4, 4, 0, 4],
            width: 4,
            height: 4,
          },
        },
      ),
      { name: '明るさ', adjustment: { type: 'brightness/contrast', brightness: 10, contrast: 0 } },
      rasterLayer('空', { left: 0, top: 0, width: 4, height: 4 }, { x: 0, y: 0, width: 0, height: 0 }),
    ],
    linkedFiles: [{ id: '20953ddb-9391-11ec-b4f1-c15674f50bc4', name: 'a.png', data: new Uint8Array([1, 2, 3]) }],
  });

  it('レイヤーの位置にトリミングの分を足した位置と、トリミング後の大きさになる', async () => {
    const { assets } = await createImporter().importFiles([{ name: 'model.psd', data: psd }]);
    const body = find(assets, '体');
    expect(body.asset.offset).toEqual({ x: 150, y: 260 });
    expect(body.asset.width).toBe(20);
    expect(body.asset.height).toBe(30);
    expect(body.asset.canvasSize).toEqual({ width: 1200, height: 1000 });
    const png = decodePng(body.png);
    expect([png.width, png.height]).toEqual([20, 30]);
    expect(pixelAt(png, 0, 0)).toEqual(RED);
    expect(pixelAt(png, 19, 29)).toEqual(RED);
  });

  it('非表示のレイヤーも取り込み、hidden を付ける', async () => {
    const { assets } = await createImporter().importFiles([{ name: 'model.psd', data: psd }]);
    const hidden = find(assets, '非表示');
    expect(hidden.asset.source.hidden).toBe(true);
    expect(hidden.asset.offset).toEqual({ x: 2, y: 2 });
    expect(find(assets, '体').asset.source.hidden).toBe(false);
  });

  it('layerPath にグループ名を外側から並べる', async () => {
    const { assets } = await createImporter().importFiles([{ name: 'model.psd', data: psd }]);
    expect(find(assets, '左目').asset.source).toEqual({
      kind: 'psd',
      file: 'model.psd',
      layerName: '左目',
      layerPath: ['頭', '目'],
      hidden: false,
    });
    expect(find(assets, '非表示').asset.source.layerPath).toEqual(['頭']);
    expect(find(assets, '体').asset.source.layerPath).toEqual([]);
  });

  it('合成モードを対応させ、不透明度を写す', async () => {
    const { assets } = await createImporter().importFiles([{ name: 'model.psd', data: psd }]);
    expect(find(assets, '体').asset.sourceBlendMode).toBe('normal');
    expect(find(assets, '乗算').asset.sourceBlendMode).toBe('multiply');
    expect(find(assets, 'スクリーン').asset.sourceBlendMode).toBe('screen');
    expect(find(assets, '加算').asset.sourceBlendMode).toBe('add');
    expect(find(assets, 'オーバーレイ').asset.sourceBlendMode).toBe('normal');
    expect(find(assets, '半透明').asset.sourceOpacity).toBeCloseTo(0.4, 2);
    expect(find(assets, '体').asset.sourceOpacity).toBe(1);
  });

  it('統合が必要なレイヤー（対応していない合成モード・レイヤー効果・スマートオブジェクト・調整レイヤー）を needsMerge にまとめ、取り込みは続ける', async () => {
    const { assets, warnings } = await createImporter().importFiles([{ name: 'model.psd', data: psd }]);
    const merge = warnings.filter((w) => w.kind === 'needsMerge');
    expect(merge).toHaveLength(1);
    // 乗算・スクリーン・加算は合成モードを引き継ぐので挙げない
    const names = ['オーバーレイ', '縁取り', 'スマート', '明るさ'];
    expect(merge[0]!.layerNames).toEqual(names);
    // 画素の無い調整レイヤー以外は素材になっている
    expect(merge[0]!.assetIds).toEqual(names.slice(0, -1).map((n) => find(assets, n).asset.id));
    for (const reason of ['合成モード: overlay', '調整レイヤー', 'レイヤー効果', 'スマートオブジェクト']) {
      expect(merge[0]!.message).toContain(reason);
    }
    expect(merge[0]!.message).not.toContain('体');
    expect(merge[0]!.message).not.toContain('乗算');
  });

  it('すべて透明なレイヤーと画素の無いレイヤーは素材にしない。順番は背面から', async () => {
    const { assets } = await createImporter().importFiles([{ name: 'model.psd', data: psd }]);
    expect(assets.map((a) => a.asset.source.layerName)).toEqual([
      '体',
      '左目',
      '非表示',
      '乗算',
      'スクリーン',
      '加算',
      'オーバーレイ',
      '半透明',
      '縁取り',
      'スマート',
    ]);
  });

  it('普通のレイヤーだけの PSD には needsMerge を出さない', async () => {
    const data = writePsdUint8Array({
      width: 1200,
      height: 1000,
      children: [rasterLayer('体', { left: 0, top: 0, width: 4, height: 4 }, { x: 1, y: 1, width: 1, height: 1 })],
    });
    const { warnings } = await createImporter().importFiles([{ name: 'a.psd', data }]);
    expect(warnings).toEqual([]);
  });
});

describe('PSD のクリッピングの統合', () => {
  it('クリッピングされたレイヤーをクリップ先に重ねた1枚の素材にする（クリップ先の名前・位置・合成モード。needsMerge は出さない）', async () => {
    const SHADOW: Rgba = [0, 0, 255, 255];
    const data = writePsdUint8Array({
      width: 1200,
      height: 1000,
      children: [
        // クリップ先は (100, 200) の 10×10 のレイヤーの中の (2, 3) から 4×5
        rasterLayer(
          '顔',
          { left: 100, top: 200, width: 10, height: 10 },
          { x: 2, y: 3, width: 4, height: 5 },
          { blendMode: 'screen', opacity: 0.6 },
        ),
        {
          name: '顔の影',
          clipping: true,
          blendMode: 'multiply',
          left: 0,
          top: 0,
          right: 104,
          bottom: 1000,
          imageData: toPixelData(makeImage(104, 1000, SHADOW)), // クリップ先の左2列だけに重なる
        },
      ],
    });
    const { assets, warnings } = await createImporter().importFiles([{ name: 'face.psd', data }]);
    expect(warnings).toEqual([]);
    expect(assets).toHaveLength(1);
    const face = assets[0]!;
    expect(face.asset.source.layerName).toBe('顔');
    expect(face.asset.offset).toEqual({ x: 102, y: 203 });
    expect([face.asset.width, face.asset.height]).toEqual([4, 5]);
    expect(face.asset.sourceBlendMode).toBe('screen');
    expect(face.asset.sourceOpacity).toBeCloseTo(0.6, 2);
    // 赤に青を乗算すると黒。クリップ先の外（透明）には広がらない
    const png = decodePng(face.png);
    expect([png.width, png.height]).toEqual([4, 5]);
    expect(pixelAt(png, 0, 0)).toEqual([0, 0, 0, 255]);
    expect(pixelAt(png, 1, 4)).toEqual([0, 0, 0, 255]);
    expect(pixelAt(png, 2, 0)).toEqual(RED);
    expect(pixelAt(png, 3, 4)).toEqual(RED);
  });

  it('統合したレイヤーの理由（対応していない合成モード）は、統合した素材の needsMerge にする', async () => {
    const data = writePsdUint8Array({
      width: 1200,
      height: 1000,
      children: [
        rasterLayer('髪', { left: 0, top: 0, width: 4, height: 4 }, { x: 0, y: 0, width: 4, height: 4 }),
        rasterLayer(
          '髪の艶',
          { left: 0, top: 0, width: 4, height: 4 },
          { x: 0, y: 0, width: 2, height: 2 },
          { clipping: true, blendMode: 'soft light' },
        ),
      ],
    });
    const { assets, warnings } = await createImporter().importFiles([{ name: 'hair.psd', data }]);
    expect(assets.map((a) => a.asset.source.layerName)).toEqual(['髪']);
    expect(warnings).toEqual([
      {
        kind: 'needsMerge',
        assetIds: [assets[0]!.asset.id],
        layerNames: ['髪の艶'],
        message: expect.stringContaining('髪の艶（合成モード: soft light）'),
      },
    ]);
  });
});

describe('PNG の取り込み', () => {
  it('透明な余白をトリミングし、元の画像の大きさを canvasSize にする', async () => {
    const png = encodePng(makeImage(1200, 1000, RED, { x: 300, y: 400, width: 50, height: 60 }));
    const { assets, warnings } = await createImporter().importFiles([{ name: 'hair.png', data: png }]);
    expect(warnings).toEqual([]);
    expect(assets).toHaveLength(1);
    const { asset } = assets[0]!;
    expect(asset.offset).toEqual({ x: 300, y: 400 });
    expect([asset.width, asset.height]).toEqual([50, 60]);
    expect(asset.canvasSize).toEqual({ width: 1200, height: 1000 });
    expect(asset.source).toEqual({ kind: 'png', file: 'hair.png' });
    expect(asset.sourceBlendMode).toBe('normal');
    expect(asset.sourceOpacity).toBe(1);
  });

  it('最初のファイルと大きさの違う PNG に canvasMismatch を出し、位置を (0, 0) にする', async () => {
    const first = encodePng(makeImage(1200, 1000, RED, { x: 10, y: 10, width: 5, height: 5 }));
    const same = encodePng(makeImage(1200, 1000, RED, { x: 20, y: 30, width: 5, height: 5 }));
    const other = encodePng(makeImage(1100, 1000, RED, { x: 40, y: 50, width: 5, height: 5 }));
    const { assets, warnings } = await createImporter().importFiles([
      { name: 'a.png', data: first },
      { name: 'b.png', data: same },
      { name: 'c.png', data: other },
    ]);
    expect(assets.map((a) => a.asset.offset)).toEqual([
      { x: 10, y: 10 },
      { x: 20, y: 30 },
      { x: 0, y: 0 },
    ]);
    expect(assets[2]!.asset.canvasSize).toEqual({ width: 1100, height: 1000 });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({
      kind: 'canvasMismatch',
      assetIds: [assets[2]!.asset.id],
      layerNames: ['c.png'],
    });
    expect(warnings[0]!.message).toContain('1100×1000');
    expect(warnings[0]!.message).toContain('1200×1000');
  });

  it('PSD の後の PSD と大きさの違う PNG にも canvasMismatch を出す', async () => {
    const psd = writePsdUint8Array({
      width: 1200,
      height: 1000,
      children: [rasterLayer('体', { left: 0, top: 0, width: 4, height: 4 }, { x: 0, y: 0, width: 4, height: 4 })],
    });
    const png = encodePng(makeImage(1000, 1000, RED, { x: 40, y: 50, width: 5, height: 5 }));
    const { warnings } = await createImporter().importFiles([
      { name: 'a.psd', data: psd },
      { name: 'b.png', data: png },
    ]);
    expect(warnings.map((w) => w.kind)).toEqual(['canvasMismatch']);
  });

  it('四隅が不透明で 99% 以上が不透明な画像に noTransparency を出す', async () => {
    const opaque = makeImage(1200, 1000, [9, 9, 9, 255]);
    const hole = makeImage(1200, 1000, [9, 9, 9, 255]);
    // 2% を透明にする
    hole.data.fill(0, 0, 1200 * 20 * 4);
    hole.data.set([9, 9, 9, 255], 0); // 左上の隅は不透明に戻す
    hole.data.set([9, 9, 9, 255], 1199 * 4); // 右上の隅も
    const { assets, warnings } = await createImporter().importFiles([
      { name: 'bg.png', data: encodePng(opaque) },
      { name: 'hole.png', data: encodePng(hole) },
    ]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({
      kind: 'noTransparency',
      assetIds: [assets[0]!.asset.id],
      layerNames: ['bg.png'],
    });
  });

  it('長辺が 1000px 未満か 8000px 超なら resolution を出す', async () => {
    const importer = createImporter();
    const small = await importer.importFiles([
      { name: 's.png', data: encodePng(makeImage(999, 500, RED, { x: 1, y: 1, width: 1, height: 1 })) },
    ]);
    expect(small.warnings.map((w) => w.kind)).toEqual(['resolution']);
    expect(small.warnings[0]!.assetIds).toEqual([small.assets[0]!.asset.id]);
    expect(small.warnings[0]!.message).toContain('999px');

    const edge = await importer.importFiles([
      { name: 'e.png', data: encodePng(makeImage(1000, 10, RED, { x: 1, y: 1, width: 1, height: 1 })) },
    ]);
    expect(edge.warnings).toEqual([]);

    const big = await importer.importFiles([
      { name: 'b.png', data: encodePng(makeImage(8001, 1, RED, { x: 1, y: 0, width: 1, height: 1 })) },
    ]);
    expect(big.warnings.map((w) => w.kind)).toEqual(['resolution']);
  });

  it('すべて透明な PNG は素材にしない', async () => {
    const { assets } = await createImporter().importFiles([
      { name: 'empty.png', data: encodePng(makeImage(1200, 1000, [0, 0, 0, 0])) },
    ]);
    expect(assets).toEqual([]);
  });
});

describe('hash と path', () => {
  it('hash はトリミング後の PNG の SHA-256、path は assets/<id>.png', async () => {
    const png = encodePng(makeImage(1200, 1000, RED, { x: 3, y: 4, width: 5, height: 6 }));
    const psd = writePsdUint8Array({
      width: 1200,
      height: 1000,
      children: [rasterLayer('体', { left: 0, top: 0, width: 4, height: 4 }, { x: 1, y: 1, width: 2, height: 2 })],
    });
    const { assets } = await createImporter().importFiles([
      { name: 'a.png', data: png },
      { name: 'b.psd', data: psd },
    ]);
    expect(assets).toHaveLength(2);
    for (const { asset, png: trimmed } of assets) {
      expect(asset.path).toBe(`assets/${asset.id}.png`);
      expect(asset.hash).toMatch(/^[0-9a-f]{64}$/);
      expect(asset.hash).toBe(await sha256Hex(trimmed));
    }
    expect(assets[0]!.asset.hash).not.toBe(await sha256Hex(png)); // 元のファイルではない
    expect(new Set(assets.map((a) => a.asset.id)).size).toBe(2);
  });

  it('既知の内容の SHA-256 と一致する', async () => {
    // "abc" の SHA-256
    expect(await sha256Hex(new TextEncoder().encode('abc'))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });
});

describe('対応していないファイル', () => {
  it('PNG と PSD 以外があれば名前を挙げてエラーにする', async () => {
    await expect(
      createImporter().importFiles([{ name: 'memo.txt', data: new TextEncoder().encode('hello') }]),
    ).rejects.toThrow('PNG と PSD 以外のファイルは取り込めない: memo.txt');
  });

  it('壊れた PSD はファイル名付きのエラーにする', async () => {
    const broken = new Uint8Array([0x38, 0x42, 0x50, 0x53, 0, 9, 9, 9]);
    await expect(createImporter().importFiles([{ name: 'broken.psd', data: broken }])).rejects.toThrow(
      'PSD を読めない（broken.psd）',
    );
  });
});
