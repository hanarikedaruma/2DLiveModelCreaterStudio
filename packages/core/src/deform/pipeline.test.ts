import type { TargetDeltas } from '@app/contracts';
import type { Model, Part, TransformDelta } from '@app/schema';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBindingEvaluator } from '../eval';
import { delta, pointsBinding, testModel, transformBinding } from '../eval/testModel';
import { createDeformPipeline } from './pipeline';
import { groupPart, imagePart, meshOf, pairs, rectMesh } from './testParts';

afterEach(() => {
  vi.restoreAllMocks();
});

function noDeltas(): TargetDeltas {
  return { transforms: {}, vertices: {}, warpPoints: {} };
}

function deltasWith(transforms: Record<string, TransformDelta>, vertices: Record<string, number[]> = {}): TargetDeltas {
  return {
    transforms,
    vertices: Object.fromEntries(Object.entries(vertices).map(([id, v]) => [id, new Float32Array(v)])),
    warpPoints: {},
  };
}

function modelOf(parts: Part[], patch: Partial<Model> = {}): Model {
  return testModel({
    parts,
    meshes: parts.filter((p) => p.kind === 'image' && p.meshId).map((p) => rectMesh(p.meshId!, 0, 0, 10, 10)),
    drawOrder: parts.filter((p) => p.kind === 'image').map((p) => p.id),
    ...patch,
  });
}

function expectPoints(actual: Float32Array | undefined, expected: [number, number][]) {
  expect(actual).toBeDefined();
  const got = pairs(actual!);
  expect(got).toHaveLength(expected.length);
  got.forEach(([x, y], i) => {
    expect(x).toBeCloseTo(expected[i]![0], 4);
    expect(y).toBeCloseTo(expected[i]![1], 4);
  });
}

describe('createDeformPipeline: 頂点', () => {
  it('差分が無いとき、頂点は基準のまま（祖先が変化なしでも）', () => {
    const mesh = meshOf('m', [
      { x: 12.5, y: 30 },
      { x: 40, y: 30.25 },
      { x: 40, y: 80 },
    ]);
    const parts = [
      groupPart('root', { pivot: { x: 100, y: 100 } }),
      groupPart('g', { parentId: 'root', pivot: { x: 5, y: 5 } }),
      imagePart('p', { parentId: 'g', meshId: 'm', pivot: { x: 20, y: 40 } }),
    ];
    const out = createDeformPipeline().deform(testModel({ parts, meshes: [mesh], drawOrder: ['p'] }), noDeltas());
    expect([...out.byPartId.p!.positions]).toEqual([12.5, 30, 40, 30.25, 40, 80]);
  });

  it('平行移動: Part.position と差分の position を足した分だけ動く', () => {
    const model = modelOf([imagePart('p', { position: { x: 5, y: 7 } })]);
    const out = createDeformPipeline().deform(model, deltasWith({ p: delta({ px: 1, py: -2 }) }));
    expectPoints(out.byPartId.p!.positions, [
      [6, 5],
      [16, 5],
      [16, 15],
      [6, 15],
    ]);
  });

  it('ピボット中心の回転: 90度で時計回り（右 → 下 → 左 → 上）', () => {
    const mesh = meshOf('m', [
      { x: 20, y: 10 }, // ピボットの右
      { x: 10, y: 20 }, // 下
      { x: 0, y: 10 }, // 左
      { x: 10, y: 0 }, // 上
    ]);
    const part = imagePart('p', { meshId: 'm', pivot: { x: 10, y: 10 }, rotation: 30 });
    const out = createDeformPipeline().deform(
      testModel({ parts: [part], meshes: [mesh], drawOrder: ['p'] }),
      deltasWith({ p: delta({ rot: 60 }) }),
    );
    expectPoints(out.byPartId.p!.positions, [
      [10, 20],
      [0, 10],
      [10, 0],
      [20, 10],
    ]);
  });

  it('拡縮はピボットを中心に、Part.scale と差分の scale を掛けた倍率', () => {
    const mesh = meshOf('m', [{ x: 11, y: 11 }]);
    const part = imagePart('p', { meshId: 'm', pivot: { x: 10, y: 10 }, scale: { x: 2, y: 1 } });
    const out = createDeformPipeline().deform(
      testModel({ parts: [part], meshes: [mesh], drawOrder: ['p'] }),
      deltasWith({ p: delta({ sx: 1, sy: 3 }) }),
    );
    expectPoints(out.byPartId.p!.positions, [[12, 13]]);
  });

  it('入れ子の順序: 頂点の差分 → 自身の変形 → 親の変形 → 祖父の変形', () => {
    const mesh = meshOf('m', [{ x: 10, y: 0 }]);
    const parts = [
      groupPart('grand', { rotation: -90 }),
      groupPart('parent', { parentId: 'grand', pivot: { x: 50, y: 50 }, scale: { x: 2, y: 2 } }),
      imagePart('child', { parentId: 'parent', meshId: 'm', position: { x: 5, y: 0 } }),
    ];
    const out = createDeformPipeline().deform(
      testModel({ parts, meshes: [mesh], drawOrder: ['child'] }),
      deltasWith({ child: delta({ rot: 90 }), parent: delta({ px: 100 }) }, { m: [0, 10] }),
    );
    // (10,0) + (0,10) = (10,10) → 自身: 90度で (−10,10)、+(5,0) で (−5,10)
    // → 親: (50,50) を中心に 2倍で (−60,−30)、+(100,0) で (40,−30) → 祖父: −90度で (−30,−40)
    expectPoints(out.byPartId.child!.positions, [[-30, -40]]);
  });

  it('頂点の差分の長さが合わなければ無視して console.warn', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const mesh = meshOf('m', [{ x: 1, y: 2 }]);
    const model = testModel({ parts: [imagePart('p', { meshId: 'm' })], meshes: [mesh], drawOrder: ['p'] });
    const out = createDeformPipeline().deform(model, deltasWith({}, { m: [1, 1, 1, 1] }));
    expect([...out.byPartId.p!.positions]).toEqual([1, 2]);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('バインディングの評価とつないで動く', () => {
    const mesh = rectMesh('m', 0, 0, 10, 10);
    const parts = [groupPart('head', { pivot: { x: 0, y: 0 } }), imagePart('p', { parentId: 'head', meshId: 'm' })];
    const bindings = [
      transformBinding(
        't',
        'head',
        ['FaceAngleZ'],
        [[0, 30]],
        [
          [[0], delta()],
          [[30], delta({ rot: 90 })],
        ],
      ),
      pointsBinding(
        'v',
        { type: 'mesh', id: 'm' },
        ['MouthOpen'],
        [[0, 1]],
        [
          [
            [0],
            [
              { x: 0, y: 0 },
              { x: 0, y: 0 },
              { x: 0, y: 0 },
              { x: 0, y: 0 },
            ],
          ],
          [
            [1],
            [
              { x: 0, y: 0 },
              { x: 0, y: 0 },
              { x: 0, y: 4 },
              { x: 0, y: 4 },
            ],
          ],
        ],
      ),
    ];
    const model = testModel({ parts, meshes: [mesh], drawOrder: ['p'], bindings });
    const deltas = createBindingEvaluator().evaluate(model, { FaceAngleZ: 30, MouthOpen: 0.5 });
    const out = createDeformPipeline().deform(model, deltas);
    // 下の辺が 2 下がってから、頭ごと 90度回る
    expectPoints(out.byPartId.p!.positions, [
      [0, 0],
      [0, 10],
      [-12, 10],
      [-12, 0],
    ]);
  });
});

describe('createDeformPipeline: 不透明度と表示', () => {
  it('自身から祖先までの不透明度を掛け合わせる。不透明度のキーがあるパーツは opacities の値を使う（I-026）', () => {
    const parts = [
      groupPart('grand', { opacity: 0.5 }),
      groupPart('parent', { parentId: 'grand', opacity: 0.8 }),
      imagePart('child', { parentId: 'parent', opacity: 0 }),
      imagePart('root', {}),
    ];
    const out = createDeformPipeline().deform(modelOf(parts), {
      ...deltasWith({ parent: delta({ op: 0.5 }) }), // transforms の opacity は使わない
      opacities: { parent: 0.4, child: 0.5 }, // Part.opacity の代わり（0 からでも上がる）
    });
    expect(out.byPartId.child!.opacity).toBeCloseTo(0.5 * 0.4 * 0.5, 10);
    expect(out.byPartId.root!.opacity).toBe(1);
  });

  it('掛けた結果は 0..1 に収める', () => {
    const out = createDeformPipeline().deform(modelOf([imagePart('p', { opacity: 0.5 })]), {
      ...deltasWith({}),
      opacities: { p: 3 },
    });
    expect(out.byPartId.p!.opacity).toBe(1);
  });

  it('非表示の祖先があると消える（自身が非表示でも消える）', () => {
    const parts = [
      groupPart('hiddenGroup', { visible: false }),
      groupPart('inner', { parentId: 'hiddenGroup' }),
      imagePart('underHidden', { parentId: 'inner' }),
      imagePart('self', { visible: false }),
      imagePart('shown', {}),
    ];
    const out = createDeformPipeline().deform(modelOf(parts), noDeltas());
    expect(out.items.map((i) => i.partId)).toEqual(['shown']);
    expect(Object.keys(out.byPartId)).toEqual(['shown']);
  });
});

describe('createDeformPipeline: 描画順と対象', () => {
  it('items は drawOrder の順（背面 → 前面）。byPartId も作る', () => {
    const parts = [imagePart('a'), imagePart('b'), imagePart('c')];
    const out = createDeformPipeline().deform(modelOf(parts, { drawOrder: ['c', 'a', 'b'] }), noDeltas());
    expect(out.items.map((i) => i.partId)).toEqual(['c', 'a', 'b']);
    expect(out.byPartId.a).toBe(out.items[1]);
  });

  it('drawOrder に無い画像パーツは最前面に parts の順で足し、console.warn。知らない id・グループ・重複は飛ばす', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const parts = [imagePart('x'), imagePart('a'), groupPart('g'), imagePart('y'), imagePart('c')];
    const model = modelOf(parts, { drawOrder: ['c', 'zzz', 'g', 'a', 'c'] });
    const pipeline = createDeformPipeline();
    const out = pipeline.deform(model, noDeltas());
    expect(out.items.map((i) => i.partId)).toEqual(['c', 'a', 'x', 'y']);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toContain('x, y');
    // 同じモデルなら毎フレーム警告しない
    pipeline.deform(model, noDeltas());
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('assetId・meshId の無い画像パーツは描かない。メッシュが無ければ console.warn して描かない', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const parts = [
      imagePart('noAsset', { assetId: null }),
      imagePart('noMesh', { meshId: null }),
      imagePart('lostMesh', { meshId: 'gone' }),
      imagePart('ok'),
    ];
    const model = testModel({
      parts,
      meshes: [rectMesh('mesh-noAsset', 0, 0, 1, 1), rectMesh('mesh-ok', 0, 0, 1, 1)],
      drawOrder: parts.map((p) => p.id),
    });
    const out = createDeformPipeline().deform(model, noDeltas());
    expect(out.items.map((i) => i.partId)).toEqual(['ok']);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toContain('gone');
  });

  it('uvs は mesh.uvs、indices は三角形を平らにしたもの。assetId・blendMode・mask は Part の値', () => {
    const mesh = rectMesh('m', 0, 0, 10, 10);
    const part = imagePart('p', {
      meshId: 'm',
      assetId: 'asset-1',
      blendMode: 'screen',
      mask: { sourcePartIds: ['q'], inverted: true },
    });
    const out = createDeformPipeline().deform(
      testModel({ parts: [part, imagePart('q', { meshId: 'm' })], meshes: [mesh], drawOrder: ['q', 'p'] }),
      noDeltas(),
    );
    const item = out.byPartId.p!;
    expect([...item.uvs]).toEqual([...new Float32Array([0, 1, 0.1, 0.9, 0.2, 0.8, 0.3, 0.7])]);
    expect([...item.indices]).toEqual([0, 1, 2, 0, 2, 3]);
    expect(item).toMatchObject({ partId: 'p', assetId: 'asset-1', blendMode: 'screen' });
    expect(item.mask).toEqual({ sourcePartIds: ['q'], inverted: true });
    expect(item.mask).not.toBe(part.mask);
    expect(out.byPartId.q!.mask).toBeNull();
  });

  it('親が見つからないパーツはルートとして扱う', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const out = createDeformPipeline().deform(modelOf([imagePart('p', { parentId: 'gone' })]), noDeltas());
    expectPoints(out.byPartId.p!.positions, [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ]);
  });
});

describe('createDeformPipeline: 循環の検出', () => {
  it('親の参照が循環していたら、その id を含むエラーを投げる', () => {
    const parts = [
      groupPart('a', { parentId: 'b' }),
      groupPart('b', { parentId: 'a' }),
      imagePart('p', { parentId: 'a' }),
    ];
    const pipeline = createDeformPipeline();
    expect(() => pipeline.deform(modelOf(parts), noDeltas())).toThrow(/a → b → a|b → a → b/);
  });

  it('自分自身を親にしていてもエラー', () => {
    expect(() => createDeformPipeline().deform(modelOf([imagePart('self', { parentId: 'self' })]), noDeltas())).toThrow(
      'self → self',
    );
  });

  it('循環が描かないパーツの中にあってもエラー', () => {
    const parts = [
      groupPart('x', { parentId: 'y', visible: false }),
      groupPart('y', { parentId: 'z' }),
      groupPart('z', { parentId: 'x' }),
      imagePart('ok'),
    ];
    expect(() => createDeformPipeline().deform(modelOf(parts), noDeltas())).toThrow(/x/);
  });
});

describe('createDeformPipeline: 入力を書き換えない', () => {
  it('モデルと差分はそのまま。呼ぶたびに新しい positions を返す', () => {
    const parts = [
      groupPart('g', { rotation: 10 }),
      imagePart('p', { parentId: 'g', mask: { sourcePartIds: [], inverted: false } }),
    ];
    const model = modelOf(parts);
    const deltas = deltasWith(
      { p: delta({ px: 3, op: 0.5 }), g: delta({ rot: 20 }) },
      { 'mesh-p': [1, 1, 1, 1, 1, 1, 1, 1] },
    );
    const before = structuredClone({ model, deltas });
    const pipeline = createDeformPipeline();
    const first = pipeline.deform(model, deltas);
    const second = pipeline.deform(model, deltas);
    expect({ model, deltas }).toEqual(before);
    expect(first.byPartId.p!.positions).not.toBe(second.byPartId.p!.positions);
    expect([...first.byPartId.p!.positions]).toEqual([...second.byPartId.p!.positions]);
  });
});
